# Deferred capabilities

What exists, what was deliberately deferred, and why. This file is corrected each time the boundary
moves — it described a wider gap before `P1-PLAT-02` and `P1-PLAT-03`, and should be trusted only
for its current content, not for history.

## What now exists

A single development environment, `verdery-dev`, provisioned with idempotent gcloud scripts rather
than Terraform (see [ADR-0011](../architecture/decisions/ADR-0011-gcloud-scripts-instead-of-terraform.md)
for why). Concretely:

- A GCP project (`verdery-dev`) linked to a personal billing account, in `us-central1`.
- A VPC network and subnet, with Cloud SQL reachable only over its private IP.
- Cloud SQL for PostgreSQL 17 with PostGIS, no public IP, IAM database authentication enabled. The
  runtime service account authenticates with no password at all — see
  [database-migrations.md](database-migrations.md) and
  `infrastructure/gcloud/scripts/07-iam-database-bootstrap.sh`.
- Two service accounts on the principle of least privilege: a deployer (push images, update the
  Cloud Run service) and a runtime identity (read one secret's worth of nothing, since there is no
  password; write logs, metrics, and traces).
- Workload identity federation trusting GitHub Actions, scoped to this repository and further scoped
  to the `development` GitHub Environment — a workflow run outside that job-level binding cannot
  obtain Google credentials at all, keyless or otherwise.
- Artifact Registry, and a Cloud Run service (`verdery-api-dev`) currently serving the health
  endpoints.
- OpenTelemetry traces exported to Cloud Trace, verified end to end against the live service: a real
  `GET /v1/health/ready` request produced one trace with an HTTP server span and nested `pg-pool` /
  `pg.connect` spans carrying `db.user: verdery-dev-api-runtime@verdery-dev.iam` — the real IAM
  identity, not a placeholder.
- `.github/workflows/deploy-dev.yml`, which builds the image, runs migrations through a Cloud Run
  Job (the only path that can reach Cloud SQL's private IP from outside the VPC), deploys, and
  verifies a live response — using the same `infrastructure/gcloud/scripts/deploy-api.sh` a human
  runs locally, not a separate CI-only path.

Phase 2 is now in progress in the repository. The implemented foundations include:

- A migration for profiles, provider links, account state, gardens, operational memberships, an
  invitation skeleton, consent, audit, revisions, idempotency, sync changes, and the outbox.
- Identity/profile provisioning and Firebase-token/web-session infrastructure in the API.
- Garden create, list, get, rename, archive, and deletion-request contracts and backend behavior,
  with current-membership authorization, revisions, idempotency, and tests.
- Web sign-in/session and garden list/create/settings flows.
- Native authentication, garden gateway, and local garden-store foundations.

This is implementation evidence, not G2 completion evidence. Provider configuration, complete
cross-client integration, App Check monitoring, and the full authentication/authorization/E2E
matrix remain open.

Run `infrastructure/gcloud/README.md` before touching any of this by hand; several steps are only
safe in the order the numbered scripts encode.

Phase 4's web client (`P4-WEB-01`) adds plant inventory, observation history, and manual-task
management to `apps/web/`: `features/plants`, `features/observations`, `features/tasks`, and their
gateways in `apps/web/core/api/`, covering every operation the `Plants`, `Observations`, and `Tasks`
contract tags define except the photo/file-dependent ones — see the next section.

Phase 5 Stage 4a (`P5-IOS-02` pilot) retrofits `FeatureGardens`'s four garden-lifecycle commands
(create, rename, archive, request deletion) to route through one atomic local-projection-plus-outbox
GRDB transaction instead of an online-first network call — see `tasks/todo.md`'s Stage 4a section for
the full account. This is the pattern the rest of Stage 4 copies, not the rest of Stage 4 itself.

Stage 4b retrofits every reachable `FeatureMap` command (create, move, replace geometry, edit vertex,
split/join linework, change properties, assign plant, delete, restore, duplicate) through the same
pattern, gaining its own `garden_object` local table. Stage 4c retrofits `FeaturePlants`'s five
reachable commands (`AddPlant`, `UpdatePlantDetails`, `TransitionPlantLifecycleStage`, `SetPlantStatus`,
`MovePlant`) the same way, gaining its own `plant` local table — `GetPlant`/`SearchTaxonomyReferences`
stay online, gateway-backed reads. `AddPlantFromPhoto`, `AttachPlantPhoto`, `SetPrimaryPlantPhoto`, and
`ConfirmPlantIdentification` gained no offline support: none of the four has a use case wired to any
shipped UI at all (confirmed by grep), for the same media/`identificationId` gap the "Photo and file
attachment" entry below describes. Stage 4d retrofits `FeatureObservations`'s two commands
(`RecordObservation`, `CorrectObservation`) through a simplified append-only variant of the same
pattern, gaining its own `observation` local table. Stage 4e — the work package's last slice —
retrofits `FeatureTasks`'s seven reachable commands (`CreateManualTask`, `EditTask`, `RescheduleTask`,
`CompleteTask`, `DismissTask`, `SkipTask`, `DeleteTask`) the same way, gaining its own `task` local
table; `AttachTaskFile` gained no offline support, for the same reason `AddPlantFromPhoto`/etc. did not
(confirmed unreachable by grep — see the "Photo and file attachment" entry below). With Stage 4e,
`P5-IOS-02` is complete: all five Phase 2–4 iOS features (Gardens, Map, Plants, Observations, Tasks)
now route every reachable offline-capable command through the local-projection-plus-outbox pattern. See
`tasks/todo.md`'s Stage 4a–4e sections for the full account of each.

`P5-OBS-01` instruments push/pull without payloads: `POST /sync/push` logs one `sync.push.completed`
structured line per batch (aggregate accepted/duplicate/rejected/conflict/blockedByDependency/
retryLater counts, plus `protocolVersion`); `GET /sync/changes` logs `sync.pull.completed` (page size,
cursor freshness, a computed pull-lag proxy) on success and `sync.pull.rejected` (`errorCode`) on the
two full-resync triggers or any other typed rejection. On iOS, `RemoteSyncEngine` logs the oldest
pending outbox operation's age through `CoreObservability.DiagnosticLog` at the start of every
`pushPending()` call — the one sync metric only the device can observe. See
[observability-and-analytics.md](../architecture/observability-and-analytics.md)'s own "Synchronization
dashboard and alert candidates" subsection for the concrete Cloud Logging queries, log-based metrics,
dashboard widgets, and alert thresholds this data supports.

Phase 6 now includes the real P6-WORKER-01 media validator in `services/workers`: private GCS
streaming with SHA-256 and byte ceilings, MIME magic and extension checks, bounded pure-JS image/PDF
parsers (`file-type`/`image-size`, no native decoding dependency), structured metadata and failure
outcomes, authenticated Cloud Tasks input, authenticated worker-to-API results, signed-access gating,
and malicious fixtures. The former direct Cloud Tasks → API fixed-success placeholder no longer
exists. Video/raw-capture is explicitly out of scope (needs `ffprobe`, a native binary dependency,
deliberately deferred) and stays at its pre-existing declared-metadata-trusted level — see the
malware-provider/worker-rollout entry below.

Phase 6 also now includes P6-RET-01: the real, end-to-end media-deletion workflow (a user command
`DeleteGardenMedia`, prefix-scoped Cloud Storage deletion executed by a new `media_deletion` worker
job with absence verification, `deletion_scheduled -> deleted` driven by the authenticated result
callback, derivative-row fan-out, processing-job cancellation, quota release on confirmed deletion,
and audit events at both ends), the hourly retention sweep (worker-triggered, API-executed —
`verdery_worker` gains zero new database access), the enforced export-package 7-day retention
deadline, stale-upload orphan reconciliation (7-day window), the user-visible retention policy
endpoint (`GET /media/retention-policy`, raw-capture declared but honestly `enforced: false`), and
attach-versus-delete race guards across every attachment command. See
architecture/media-storage-and-processing.md sections 15.1/16.1 for the implemented profile and the
entries below for what this stage deliberately leaves open.

Phase 6 also now includes P6-OBS-01: structured, queryable log events across the whole media
pipeline — `media.upload.registered`/`media.upload.completed`/`media.deletion.scheduled` at the
API's media transport, one `media.processing.result_recorded` event per worker result callback
(validation, derivative, and deletion outcomes split by `jobKind`, with worker duration, full
requested-to-completed pipeline latency, and the computed `deletion_scheduled -> deleted` lag on a
confirmed deletion), the relay's `oldestClaimedEventAgeMs` outbox-publication-lag figure, the
worker HTTP target's retryable-failure event corrected to cover all three job kinds
(`media_processing.job_failed_retryable`, with `jobKind`), and the hourly
`retention.sweep_completed` heartbeat now emitted on every run — plus the documented dashboard/
alert/runbook writeup in
[observability-and-analytics.md](../architecture/observability-and-analytics.md)'s "Media
dashboard, alert candidates, and runbook" subsection. See the media-dashboard entry below for what
deliberately remains undeployed.

Phase 6 also now includes real P6-WORKER-02 derivative generation in `services/workers/src/derivatives`:
`sharp`-based thumbnail/screen-preview/high-resolution/tile production for garden photos and raster
(non-PDF) imported plans, unconditional EXIF stripping (GPS location included) with orientation
normalized into the pixels first, a direct GCS write to the derived bucket using the worker's own
identity, and idempotent registration of each produced derivative as its own new `media.media_record`
row through `services/api`'s extended result-recording path — enforced by a real, partial-unique-index
database constraint, not just application-layer checking. A successful validation for a raster-eligible
media class now triggers this automatically via a second outbox event
(`media.derivative_generation_requested`), reusing the same relay/Cloud Tasks machinery. `sharp` is
now a real production dependency of `services/workers` (moved out of `devDependencies`, where
P6-WORKER-01 deliberately confined it) — see the PDF-page-preview entry below for what this stage still
does not build.

## What remains deferred, and why

**Staging and production.** Only `verdery-dev` exists. Creating `verdery-staging` and `verdery-prod`
is mechanical — the same scripts, a new `config/<environment>.env` — but is deferred until closer to
`P8` (foundation hardening), so that idle staging/production infrastructure is not accruing cost or
drifting before there is a product to run on it.

**Regional and production hardening.** `verdery-dev` uses a zonal Cloud SQL instance
(`db-f1-micro`), `--allow-unauthenticated` at the Cloud Run network/IAM layer, and no Cloud Armor or
load balancer. Public health endpoints remain open, while product endpoints still require the API's
Firebase/session authentication and server-side authorization. ADR-0007 explicitly allows simpler
connectivity for non-production environments. Regional HA and the production networking topology
are `P8-DB-01` and `P8-NET-01`.

**`infrastructure/terraform/` stays empty.** This environment is provisioned by
`infrastructure/gcloud/scripts/`, not Terraform, by deliberate choice — see ADR-0011. The directory
is not deleted because a later multi-environment, multi-operator phase may still want Terraform's
state model.

**Container image scanning.** Images build and push through the deploy workflow, but no
vulnerability scan runs against them yet. This unblocks with the security hardening work in `P8`.

**Media malware provider and worker rollout (P6-WORKER-01 operational boundary).** The validation
worker has a real `MalwareScanner` port but no provider has been evaluated or selected. Its default
adapter returns `unavailable`; PDF tasks fail retryably and are never represented as clean. Raster
plans remain supported by the constrained image decoder. Before the worker can run in
`verdery-dev`, the already-documented `verdery_worker` Cloud SQL IAM membership/connection path must
be completed (including a real `DATABASE_URL` Secret Manager secret —
`infrastructure/gcloud/scripts/deploy-workers.sh` references one that does not exist yet), the queue
and Cloud Run service must be deployed, and the interval relay must receive always-allocated CPU (or
move to a scheduler-triggered execution model). The image, Dockerfile, and deploy script are ready,
but none of those live-infrastructure actions was performed as part of P6-WORKER-01, and no
`deploy-dev.yml` step builds or deploys the workers image yet either. P6-WORKER-02 adds one more
not-yet-executed prerequisite to this same list: `10-media-processing-queue.sh` now also grants
`roles/storage.objectCreator` on the derived bucket to the worker service account (the write access
its own derivative-generation job needs — see that script's own updated comment), written and
syntax-checked but not run against any real project. P6-RET-01 adds two more, in the same
written-not-executed state: the custom `verderyMediaObjectDeleter` role (`storage.objects.delete`
only — no predefined role grants delete without also granting create/overwrite) created and bound
per bucket by `10-media-processing-queue.sh`, and `deploy-workers.sh`'s new
`MEDIA_RETENTION_SWEEP_URL` environment variable (the worker's hourly sweep trigger fails loudly at
configuration load without it).

**Raw-capture retention enforcement (P6-RET-01 scope boundary).** The 30-days-after-successful-
extraction rule (architecture/media-storage-and-processing.md section 15; garden-capture-and-scan.md
section 17) is DECLARED through `GET /media/retention-policy` with an explicit `enforced: false`
flag, and the sweep already processes any record whose `retention_deadline_at` passes — but nothing
sets a raw-capture deadline yet, because the anchoring event (successful extraction) has no producer
until Garden Scan lands (Phase 10). When that stage records an extraction outcome, its one remaining
job here is to stamp `retention_deadline_at = extraction + 30 days` (the constant already exists in
`domain/media-retention.ts`) and flip the policy entry to `enforced: true`; the sweep and deletion
workflow need no further change. "Users may delete raw media sooner" already works: `DeleteGardenMedia`
accepts any `available` original, raw capture included.

**Rejected-upload byte cleanup (P6-RET-01 scope boundary).** A `rejected` record (declared/actual
mismatch at completion, or a failed validation) may hold real bytes, and the deletion workflow never
touches it: `rejected` is a terminal state carrying evidence of what was rejected, section 6's
diagram draws no outgoing edge from it, and no document names a retention duration for that evidence
(section 3's "retained only long enough for recovery and support policy" names a policy that does
not exist yet). Sweeping those bytes needs a product/policy decision first — recorded here rather
than a number invented.

**Bucket-side orphan listing (P6-RET-01 scope boundary).** Section 15's orphan pairing has two
directions; this stage implements "metadata without objects" (stale registrations reconciled through
the deletion workflow). The reverse — Cloud Storage objects with no `media_record` row at all —
would need a bucket-listing reconciler comparing object inventories against the database, which no
current component is placed to run (the API deliberately never lists buckets; the worker
deliberately never reads `media.media_record`). The prefix-scoped deletion design prevents the known
ways such objects arise (late derivative writes are re-covered by cleanup re-emits), so what remains
is a defense-in-depth audit job for a future operational stage, not a correctness gap this stage
knows how to produce.

**iOS/web deletion UI (P6-RET-01 scope boundary).** The contract and backend are complete
(`deleteGardenMedia`, `getMediaRetentionPolicy`), but no client calls either yet — the same
"gateway-tested, no UI caller" posture the attachment entries above already document. The web
client's `GardenPhotoUpload`/`MediaPreview` surfaces would be the natural first wiring point.

**Video/raw-capture deep validation (P6-WORKER-01 scope boundary).** Duration, codec, and frame-rate
validation (architecture/media-storage-and-processing.md section 10) needs `ffprobe`, a native binary
dependency not yet in this stack — the same class of dependency P6-WORKER-01 deliberately avoided for
images too (picking pure-JS `file-type`/`image-size` over a native decoder). A `raw_capture` manifest
is short-circuited to an accepted, clearly-labeled result before any byte is downloaded, preserving
exactly the declared-metadata-trusted level P6-API-01 already established. No video parser exists
anywhere in this codebase; a future stage builds one.

**PDF page-preview rendering (P6-WORKER-02 scope boundary).** Architecture/media-storage-and-
processing.md section 11 names "Page previews" as something plan-document processing may produce;
P6-WORKER-02 does not build this for a PDF-classed `imported_plan`. Rasterizing a PDF page needs
either `poppler`/`pdftoppm` (a native binary dependency — the same class already deferred for
video/`ffprobe`, and for the identical "no native binary dependency in this stack" reason) or a
heavier `pdf.js`+canvas WASM stack; neither has been evaluated or added. A PDF-classed `imported_plan`
is therefore never derivative-eligible (`services/api`'s `application/derivative-eligibility.ts`
excludes `application/pdf` from its raster-content-type allowlist) — it gets no thumbnail, screen
preview, high-resolution image, or tile pyramid yet, only the real byte-level validation P6-WORKER-01
already performs. Raster (non-PDF) plans are fully supported by this stage's real derivative pipeline,
tile pyramid included. A future stage builds PDF page rendering once a rasterizer dependency is
evaluated and approved.

**PDF plan display in the web client (P6-PLAN-01 scope boundary).** Downstream of the same gap: a
PDF-classed `imported_plan` uploads, validates, and can be placed on the map as an
`importedBackground`, but the web client shows an explicit "PDF pages cannot be previewed yet"
notice and a placeholder outline instead of imagery — there is no derivative to display and no
client-side PDF renderer (adding `pdf.js` client-side was rejected as half-building around the
documented server deferral). Unblocks automatically once PDF page rendering (above) exists.

**Plan tile consumption (P6-PLAN-01 scope boundary).** P6-WORKER-02's XYZ tile pyramid exists
server-side for every raster plan, but no client consumes it yet: the web map editor displays a
plan background through its single screen-preview derivative (`Media.derivatives` +
`GetMediaAccess`), "contain"-fit inside the background object's placeholder polygon. A tile layer
needs a URL-template story a signed-per-object download flow does not provide — MapLibre's raster
source expects a stable `{z}/{x}/{y}` template it can fetch many tiles through, while
`GetMediaAccess` signs one object per authorized call — and an uncalibrated background has no
meaningful geographic placement for a tile layer anyway. A future stage (with or after P6-PLAN-02's
calibration) picks the mechanism: a bounded tile-access endpoint issuing short-lived signed URLs
per tile, or an authenticated tile proxy route.

**Perspective correction of photographed plans (P6-PLAN-01 scope boundary).** "Perspective
handling" beyond server-side EXIF orientation normalization (P6-WORKER-02 already applies
orientation to derivative pixels) does not exist: keystone/perspective correction of a photographed
plan has no server capability, and no client-side warping was half-built around that gap. A future
capture-quality stage owns it if product need materializes.

**iOS plan import and calibration — resolved by the P6-PLAN iOS parity follow-up.** The iOS client
now implements the full flow the contract carried since P6-PLAN-01/-02: document selection
(Photos + Files), local safety validation, private upload with `media_class: 'imported_plan'`
through the P6-IOS-01 upload machinery (`FeatureGardens.GardenPlanUploadView`), background
placement/visibility/removal and derivative rendering with honest calibration badges
(`FeatureMap`'s background panel and canvas underlay), and the calibration session itself
(`MapEditorViewModelCalibration.swift`). The Swift half of `derivePlanCalibration`
(`CoreDomain/Geometry/PlanCalibration.swift`) reproduces the shared
`geometry/calibration.json` fixtures byte-identically — all five success and four rejected cases,
exact comparison — and the wire model was already brought to parity by Stage 10's coordinator
correction. One deliberate divergence from the web, documented at the source: `upsertCalibration`
submits online-only (the offline projection keeps refusing it) — the server derives the transform
revision in one transaction, and a calibration session needs the signed-URL plan image anyway, so
a device that can calibrate is online by construction. What remains open on iOS is exactly the
system-wide deferrals recorded elsewhere in this document: PDF page rendering (so PDF backgrounds
cannot display or calibrate — the UI states this), plan tile consumption, and geographic anchors.

**Geographic anchors as calibration inputs (P6-PLAN-02 scope boundary).** Section 16 lists
"optional geographic anchors" among the calibration inputs — pinning a plan point directly to a
WGS84 coordinate. This is genuinely blocked, not skipped: entering a geographic anchor requires
AUTHORING the garden's local→WGS84 georeference, and no `upsertGeoreference` command exists
anywhere in the system (`georeference-repository.ts` documents the read-only posture; the
history-preserving `gardens_mapping.georeference` table has no writer). Once a garden CAN be
georeferenced, plan→geographic placement already composes for free — plan→local is this stage's
calibration transform and local→WGS84 is the georeference — so the missing piece is the
georeference-authoring capability, its own future work package, not more calibration modeling.

**Break-glass credential rotation procedure.** `07-iam-database-bootstrap.sh` rotates the Postgres
superuser password on every run and stores it in Secret Manager, but there is no scheduled rotation
or documented incident procedure for using it. `P8-REL-01` owns operational runbooks generally.

**Staging/production database procedure.** Migrations are proven twice over now — against a
throwaway Testcontainers instance in CI, and against the real `verdery-dev` Cloud SQL instance
through the least-privilege IAM identity, including the exact permission gaps that only appear
outside a superuser connection. What remains unrehearsed is the staged rollout procedure across
environments: expand-phase migration on staging before production, traffic shifted only after
success. See [database-migrations.md](database-migrations.md).

**G2 approval itself.** Every implementation and E2E evidence item Phase 2's exit criteria name is
now recorded — see `tasks/todo.md`'s Phase 2 section. G2 is nonetheless a repository-owner decision,
not an automatic consequence of passing tests, and is not claimed by this document.

**App Check dashboard.** The backend, web, and iOS clients integrate Firebase App Check in
monitor-only mode (P2-APPCHK-01): every request's classification (valid, missing, invalid) is
recorded as structured backend telemetry, but no dedicated dashboard view was built over that
telemetry. Enforcement (rollout stage 3) is separately and deliberately not enabled anywhere.

**Sync dashboard, alert policies, and Crashlytics (P5-OBS-01).** The same shape as the App Check
dashboard entry above, applied to synchronization: `sync.push.completed`/`sync.pull.completed`/
`sync.pull.rejected` are real, verified structured backend log lines (see the "What now exists"
section above), but no Cloud Monitoring dashboard or alert policy was deployed over them — this
matches Phase 1's own `P1-OBS-01` delivery bar (real traces verified against one live request, not a
deployed dashboard/alerting artifact), not a shortfall specific to this stage. Separately, and for a
different reason: `apps/ios/Package.swift` declares no `FirebaseCrashlytics`/`FirebasePerformance`
dependency (only `FirebaseAuth`/`FirebaseAppCheck`/`FirebaseCore`), so architecture/observability-and-
analytics.md section 8's Crashlytics destination for native telemetry is not wired at all yet, for
any signal, not only the new outbox-age one — adding either dependency needs its own ADR under this
repository's third-party-dependency rule. The outbox-age metric itself is real and logged locally
(`RemoteSyncEngine` → `CoreObservability.DiagnosticLog`), just not exported anywhere a dashboard could
read it yet. `platform.sync_client_installation.revoked_at` has no telemetry either, for a third,
distinct reason: no command anywhere in this codebase writes it at all (see the `P5-SEC-01` entry
below), so there is no event to log a metric about, not merely an unbuilt dashboard.

**Media dashboards, log-based metrics, and alert policies (P6-OBS-01).** The same shape as the
sync-dashboard entry above, applied to media: every media-pipeline signal named by
architecture/media-storage-and-processing.md section 19 is now a real, test-verified structured
log event or a documented database/built-in-metric query, and observability-and-analytics.md's
media subsection specifies the exact log-based metric definitions, dashboard widget compositions,
alert thresholds, and runbook entries they support — but no Cloud Monitoring dashboard, log-based
metric, or alert policy has been CREATED against any environment. That is a live-infrastructure
action gated on its own approval (and on the worker service actually being deployed, which the
malware-provider/worker-rollout entry above still tracks), matching the P1-OBS-01/P5-OBS-01
delivery bar for a "-01" observability work package.

**Stuck-deletion automatic re-drive (P6-OBS-01 audit finding, deliberately not built).** A
`deletion_scheduled` record whose `media_deletion` job exhausts Cloud Tasks' bounded retries
(10 attempts / 1 hour) has no automatic re-drive: the outbox event is already published, the
retention sweep deliberately skips records already in the deletion pipeline, and nothing re-emits
the event on its own. The record stays honestly `deletion_scheduled` (user-visible deletion
remains pending — the designed conservative posture), and the documented operator remediation is
re-emitting the standard idempotent `media.deletion_requested` event (see the deletion runbook
entry in observability-and-analytics.md — the same re-emit `RecordMediaProcessingResult` already
performs for late derivative bytes). An AUTOMATIC re-drive (for example, the sweep re-emitting for
stale `deletion_scheduled` rows) would change retention semantics and needs its own approved
change; recorded here rather than built inside an observability work package.

**Photo and file attachment in the Phase 4 web client — partially fixed by `P6-WEB-01`.**
`AddPlantFromPhoto`, `AttachPlantPhoto`, `SetPrimaryPlantPhoto`, `ConfirmPlantIdentification`, and
`AttachTaskFile` all need a real `media` record. `P6-API-01` (media registration, authorized
resumable upload session, completion verification, status, and authorized short-lived access —
`packages/api-contracts/openapi.yaml` tag `Media`) landed first, so a `mediaId` could already be
produced end to end against the real backend and real Cloud Storage buckets; what was missing was
the web client's own wiring. `P6-WEB-01` now builds that wiring as a real, reusable capability —
`core/api/media-gateway.ts`, a real browser-side Cloud Storage resumable-upload driver
(`features/media/resumable-upload-driver.ts`, `gcs-resumable-transport.ts`) with real chunked
progress, pause, retry, and IndexedDB-backed resume-after-reload
(`indexed-db-pending-upload-store.ts`), completion verification, processing-state polling, and an
authorized preview (`MediaPreview`) — and wires ONE concrete attachment point end to end:
`GardenPhotoUpload` (`media_class: 'garden_photo'`), mounted on the garden settings page
(`app/application/gardens/[gardenId]/page.tsx`). Garden photo needs no further "attach" step the way
plant/task/observation photos do (registering the upload against a `gardenId` already is the
attachment), which is exactly why it was chosen as the first, fully-working target rather than
spreading thin across several partial ones.

**Still open**: `plant-gateway.ts`'s `attachPhoto`/`setPrimaryPhoto`/`addFromPhoto`/
`confirmIdentification` and `task-gateway.ts`'s `attachFile` remain implemented and unit-tested for
contract completeness only, with no `features/plants`/`features/tasks` hook or component calling
them — `features/plants/plant-detail.tsx` still shows its plain gap notice instead of a control that
would only fail. `RecordObservation`'s photo support is still left off `RecordObservationForm` the
same way, though the contract already lets a note and/or a condition summary stand on their own
without a photo, so recording an observation itself is not blocked. Each of these can now reuse
`features/media`'s upload machinery directly (the same `useMediaUpload` hook, parameterized by
`mediaClass`, already returns the `mediaId` these commands need) — the remaining work is UI wiring
per attachment point, not new upload infrastructure.

**Photo and file attachment on iOS — resolved by `P6-IOS-01`.** The iOS half of the same gap this
section describes for web is now closed. `CoreMediaTransfer` (new Core module) provides: durable
local-file-first capture (`LocalMediaFileStore`/`FileManagerLocalMediaFileStore` — the file and its
`CoreDomain.MediaTransfer` row are both written before any network call, reusing
`CorePersistence.LocalDatabase`'s own per-profile `Application Support` root); a real Cloud Storage
resumable-upload client (`GCSResumableUpload`, implementing the actual wire protocol — a whole-object
`Content-Range` `PUT` for the normal case, a zero-byte status-check `PUT` plus a sliced remaining-range
`PUT` to resume after an interruption); a genuinely background-capable transport
(`URLSessionBackgroundUploadTransport`, a real `URLSessionConfiguration.background(withIdentifier:)`
session with `sessionSendsLaunchEvents = true`, wired to `VerderyApp`'s new `AppDelegate` for
`application(_:handleEventsForBackgroundURLSession:completionHandler:)`); and the coordinator tying it
together (`MediaUploadCoordinator`, an actor) — registration, upload, `CompleteMediaUpload`, a bounded
`GetMediaStatus` poll for `processingState`, real byte-progress, retry-category gating reusing
`CoreSynchronization.SyncErrorCategory.isEligibleForAutomaticRetry`/`SyncBackoff` directly (now `public`
for this reuse) rather than re-deriving the same policy, and relaunch recovery (a `.uploading` transfer
whose OS-tracked task survived is left alone; one that did not is resumed through the real status-check
path; a `.verifying` transfer re-confirms completion, idempotently). `media_transfer` — scaffolded in
`P5-IOS-01` with no real caller (see `CoreSynchronization.SyncEngineStatus`'s doc comment above) — gained
the columns this coordinator needs via an additive migration, and `CoreDomain.MediaTransfer`'s own `id`
doc comment is corrected: it is this row's LOCAL identity, never the same value as the server-assigned
`mediaId` (`RegisterMediaUploadRequest` has no client-suppliable id field at all — the prior doc comment
was simply wrong, not yet exercised by any real caller). Two concrete attachment points now have real
upload capability: `FeaturePlants.PlantDetailView` ("Attach Photo", calling the previously-gateway-only-
tested `AttachPlantPhoto` once the upload reaches `available`) and `FeatureObservations
.ObservationsTimelineView`'s record-observation form (`RecordObservation`/`CorrectObservation` now
accept real `photoMediaIds`, submit disabled while a picked photo is still mid-upload). Both use a
shared `PhotoAttachmentController`/`PhotoAttachmentStatusLocalization` (English/Russian) rather than
duplicating the same progress/retry/status UI glue twice. `AddPlantFromPhoto`/`SetPrimaryPlantPhoto`/
`ConfirmPlantIdentification`/`AttachTaskFile` remain UI-unreached on iOS, the same "implemented and
tested at the gateway layer, no real caller" gap this section already describes for their web
counterparts — genuinely separate follow-ups, not attempted here.

Known, deliberately scoped gaps this stage leaves open: (1) photo ACQUISITION is library selection
(`PhotosPicker`) only — no live camera capture UI; architecture/ios-application-design.md section
"12. Capture Architecture" describes a separate `Core/PlatformCapabilities`+`Features/GardenCapture`
investment this work package's own title (registration/upload/verify COORDINATION) does not require
building. (2) The single, app-lifetime `MediaUploadCoordinator` resolves its local database from
whichever profile is current at `AppCompositionRoot` construction, not re-resolved on a later
sign-in/sign-out within the same process — every `local*Store()` factory re-reads the current profile
per call specifically to stay correct across a switch, which this coordinator cannot do without either
tearing down its one background session (losing an OS-tracked in-flight transfer) or giving
`MediaTransfer` its own profile column and a runtime rebind path; narrow in practice (a single
signed-in profile per device, already restored by the time any screen reachable behind
`sessionObserver.isSignedIn` could invoke it) but a real, undismissed edge case, not silently ignored.
(3) An offline-recorded observation cannot reference a still-uploading photo's media id — architecture/
offline-synchronization.md section "18. Media Coordination"'s `mediaPending`/dependency-blocked concept
is not implemented; the UI itself blocks submission until the photo resolves `ready` instead, an honest
narrower behavior, not a silent drop. (4) A `.retained` transfer whose `processingState` was still
`processing` when the app last quit does not resume its bounded poll automatically on relaunch — only
`PhotoAttachmentController.refreshStatus()`'s manual re-check reaches it. (5) Real background-transfer
behavior (the app actually suspended or killed mid-upload, the OS relaunching it to deliver a finished
transfer) could only be reasoned about, not executed, in this environment — see this stage's own report.

**Photo-identification and photo-analysis ML services.** `plants-inventory`'s `identifyPlantFromPhoto`
and `observations-history`'s `analyzeObservationPhoto` are honest, clearly-labeled placeholders —
always "no suggestion, zero confidence" — not disguised guesses. `AddPlantFromPhoto` and
`RecordObservation` both treat the stub result as exactly that: `plant.taxonomyReferenceId` never
auto-confirms from a photo, and an observation's `suggestedLabel` never claims automated analysis
happened. Building a real service is out of scope for Phase 4 and has no owning work package yet.

**~~`GET /gardens/{gardenId}/plants` exists but no client calls it~~ — fixed for web, still open for
iOS.** `P4-SEARCH-01` closed the backend gap both clients' Phase 4 code had documented (no way to
list a garden's plant inventory — each fell back to create-then-navigate or open-by-id). The web
client's half is now closed: `plant-gateway.ts` gained a `search` method against `SearchPlants`,
`features/plants/queries.ts` gained `useSearchPlants`, and a new `plant-list.tsx` (free-text
`displayName` search plus "Load more" cursor pagination, the same stale/loading/error-state
conventions `garden-list.tsx`/`task-list.tsx` use) is wired into the plants page alongside the
existing add/open-by-id forms — a user can now actually browse a garden's inventory, not only create
or navigate to a known id. Structured filters (`lifecycleStage`/`status`/`groupingKind`) were left
out of this pass as a deliberate, documented scope call — the endpoint accepts them, but no filter UI
was built beyond the text search box. `apps/ios/Sources/FeaturePlants/PlantsHomeView.swift` still
carries the now-stale "no list operation" comment and was explicitly out of scope for this (web-only)
follow-up; the iOS half of this gap remains open.

**Fixed (Phase 6).** `1784710800000_platform-baseline.sql`'s `CREATE EXTENSION postgis` needs real
elevated privilege (not a Postgres "trusted" extension, unlike `pg_trgm`), which the automated deploy
pipeline's least-privilege Cloud SQL IAM identity does not have. `07-iam-database-bootstrap.sh` now
installs `postgis VERSION '3.5.2'` defensively via its own break-glass superuser session — the exact
mechanism this entry used to describe as the eventual fix, now actually written (prompted by hitting
the identical privilege-class failure for `CREATE ROLE verdery_worker` during P6-ASYNC-01, which
confirmed the same root cause and made writing this fix immediate rather than deferred). Verified as a
real no-op against `verdery-dev` today (postgis already installed there since Phase 1); not yet
exercised against a genuinely fresh environment, since none exists yet.

**`P5-IOS-02`/`P5-IOS-03`/`P5-SEC-01`/`P5-CONFLICT-01` are all now complete** — `CoreSynchronization
.RemoteSyncEngine` is the real, network-backed push/pull engine (no longer `LocalOnlySyncEngine` only);
same-object conflicts are durably recorded and, as of `P5-CONFLICT-01`, resolvable through
`RemoteSyncEngine.resolveConflict(_:action:)` (keep server version, reapply the local intent where safely
replayable, duplicate as a new object for `gardenObject`), reachable through a real `FeatureSyncConflicts`
screen from `GardenSettingsView`; a `garden`/`delete` pull change cascades to remove every registered
applier's local rows and drains pending outbox operations for the garden. What remains genuinely deferred
from this line of work:

- Per-feature UI status labels (`GardensListViewModel`/`GardenSettingsViewModel`/`MapEditorViewModel`/
  `PlantDetailViewModel`/`ObservationsTimelineViewModel`/`TasksListViewModel`'s own "Saved locally, waiting
  to sync") are still session-scoped placeholders, not reconciled with `SyncEngineStatus`'s engine-wide
  view — a real design question spanning every `Feature*` module's view models, left as a separate
  follow-up since Stage 5b.
- `SyncEngineStatus.requiresAttention` is still not wired into any UI — `FeatureSyncConflicts` reads the
  durable open-conflict list directly instead (a different, more robust signal for "does this garden need
  attention" than a live engine instance's own last-cycle outcome; see that feature's own reasoning).
  `Upload pending` (media transfer) also stays unmodeled — this is specifically about
  `CoreSynchronization.SyncEngineStatus`, an iOS-only concept, which `P6-IOS-01` deliberately left
  untouched: iOS now has a real media-upload flow of its own
  (`CoreMediaTransfer.MediaUploadCoordinator`), but its per-attachment status
  (`PhotoAttachmentStatus`) is a separate, purpose-built vocabulary surfaced directly by the screen
  driving one photo's upload (`PlantDetailView`/`ObservationsTimelineView`), the same "shown by the
  widget driving the upload, not through a separate engine-wide status concept" shape `P6-WEB-01`
  already chose for the identical reason — reconciling it into `SyncEngineStatus`'s own engine-wide
  view remains exactly the unbuilt reconciliation the bullet above already names for every other
  feature's session-scoped status label. The web client has an equivalent real flow
  (`P6-WEB-01`, `apps/web/features/media`).
- Connectivity-change (`NWPathMonitor`) and background-processing-opportunity (`BGTaskScheduler`) sync
  triggers remain unbuilt; only app-foreground (`scenePhase`) and explicit calls trigger a push/pull cycle
  today.
- If a conflict's own resolution operation later conflicts or is rejected in turn, the original conflict
  record is never re-opened or otherwise unwound — it stays resolved-but-not-removed indefinitely, while
  the resolution operation's own new conflict (if any) is recorded separately, unlinked to the first. No
  product decision yet exists for how deep a retry chain should go.
- Account-level revocation (a session going invalid should clear that account's local sync database) has
  no sign-out flow to trigger it from anywhere in this codebase — a real, separate, understood gap
  documented in `tasks/todo.md`'s `P5-SEC-01` entry, distinct from the per-garden membership revocation
  that stage does handle.

**`P5-WEB-01` is also now complete** — the web client's bounded counterpart to the native offline work
above, scoped by `architecture/web-application-design.md` section 9 to a stale/disconnected indicator over
already-loaded data, schema-versioned recoverable local drafts, and disabling (not queuing) mutations while
offline, explicitly excluding any web-side outbox/local-database/push-pull mechanism. `core/connectivity/`
(`useIsOnline`, reusing TanStack Query's own `onlineManager`) and `shared/ui/stale-indicator.tsx` cover
detection and display, wired into every garden/plant/observation/task list-or-detail view and the map
editor — which also fixed a real pre-existing defect where a failed background refetch replaced already-
loaded data with a full error screen instead of keeping it visible. `core/drafts/` (schema-versioned
`localStorage` envelopes, one version constant per draft type, mirroring the iOS client's own
`commandVersion` convention) backs recoverable drafts for the three primary create forms
(`AddPlantForm`/`RecordObservationForm`/`CreateManualTaskForm`) and the map editor's in-progress
`draftPoints`/`pendingGateGeometry`. See `tasks/todo.md`'s `P5-WEB-01` entry for the full account,
including what stayed deliberately out of scope at the time (every remaining mutation surface — task
actions, plant lifecycle/move, `garden-settings.tsx` — kept the same offline behavior it had before
this stage, a real, documented, narrow follow-up rather than a silently missed gap).

**That narrow follow-up is now closed.** `garden-settings.tsx` was fixed identically to
`garden-list.tsx`'s own `isLoadingError`/`isRefetchError` distinction (a failed first load replaces
the view with a full failure state; a failed background refetch instead keeps the already-loaded
garden visible with `StaleIndicator` layered on top), proven by a new `garden-settings.test.tsx`
mirroring `garden-list.test.tsx`'s own three cases. `task-row.tsx`'s complete/skip/dismiss/delete
actions and `features/plants/plant-lifecycle-controls.tsx`/`plant-move-form.tsx`'s save-stage/
save-status/delete/move actions all gained the same `disabled={!isOnline}` gate
`create-manual-task-form.tsx` already used, with no new local-draft persistence (each is a simple
state-transition command, not free-text input) — the parent list/detail view in each case already
renders a `StaleIndicator`, so no second one was added per row. `garden-settings.tsx`'s own
rename/archive/request-deletion mutations, `create-garden-form.tsx`, `task-edit-form.tsx`,
`task-reschedule-form.tsx`, and `plant-details-form.tsx` were found, during this pass, to have the
identical missing-offline-gate shape but were not part of this documented follow-up's named scope and
were deliberately left untouched — a real, adjacent, still-open gap, flagged here rather than fixed
unilaterally.

**The Phase 2 E2E suite does not run in CI.** `apps/web/e2e/` (Playwright against a real Postgres,
the Firebase Auth emulator, the real API, and the real web app, orchestrated by
`apps/web/e2e/run-e2e.sh`) is verified locally but not wired into `.github/workflows/ci.yml`: it
needs Docker and the Firebase CLI on the runner and takes noticeably longer than the existing gates,
the same cost/benefit reasoning already applied to the `swift` job's narrow path filter. Also
unverified: whether `services/api/src/main.ts`'s `firebase-admin` initialization
(`initializeApp({ credential: applicationDefault() })`) still works with no Application Default
Credentials provisioned at all, which a from-scratch CI runner may not have — this was only proven
against this development machine's own `gcloud auth application-default login` session.

## What is _not_ deferred

The pnpm workspace and its version pins, the OpenAPI contract and its generated client, shared
geometry semantics, language-neutral fixtures shared between TypeScript and Swift, the SQL migration
system and its tests (including the least-privilege regression test in
`services/api/tests/migrations/platform-baseline.test.ts`), the API composition root and health
endpoints, the web application shell, the Swift package and its targets, formatting, linting, type
checking, the file-size rule, the secret scan, the `verdery-dev` cloud environment, keyless CI
deployment, OpenTelemetry tracing to Cloud Trace, the Phase 2 identity/garden database and backend
foundations, and the current web/native Phase 2 foundations.
