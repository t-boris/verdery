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

Implementation through Phase 9 is now present in the repository. The foundation covers identity,
gardens, the cross-platform 2D editor, plants, observations, tasks, native synchronization, web
continuity, media and plan import, recommendations and Today, notifications, export, deletion, and
hardening. Phase 9 adds operational collaboration, professional-service organizations and garden
assignments, explicit client publication and a read-only portal, client-scoped media/export, and
seasonal/context features on web and iOS.

This is implementation evidence, not a claim that every release approval has passed. G2–G8 remain
owner-controlled gates; G9 is approved. Only `verdery-dev` is live, the worker service is still not
deployed, staging and production do not exist, App Check enforcement remains off, and the provider,
privacy, support, legal, store, and real-device items documented below remain open.

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

Phase 7 now includes P7-ASYNC-01: scheduled weather refresh and recommendation generation through
the established worker-interval → authenticated-internal-endpoint machinery (the P6-RET-01
retention-sweep shape, generalized in `services/workers/src/sweeps/` now that three sweeps share
it). The worker's hourly tick triggers `/internal/weather-refresh/sweep` (active georeferenced
gardens through `RefreshGardenWeather`, least-recently-fetched first, batch-capped, typed quota
exhaustion stops the batch, and the zero-provider reality is a logged no-op); its six-hourly tick
triggers `/internal/recommendation-evaluation/sweep` (`RunRecommendationEvaluationSweep`:
full-drain `EvaluateGardenRecommendations` over eligible gardens — active, with at least one
active-status plant — plus the candidate-expiry phase closing P7-RULE-01's deferred gap).
Duplicate safety is proven at every layer: the overlap-guarded scheduler, the cache-window and
idempotent-per-window sweep re-runs, and the per-garden advisory lock shared by evaluation and
expiry. `EvaluateGardenRecommendations` additionally appends one `recommendation.candidate_created`
outbox event per created candidate in the same transaction — see the recommendation-notification
entry below for why the consumer does not exist yet.

Phase 7 now includes P7-BE-01: the Today surface — the first client-facing recommendation HTTP
surface, under the OpenAPI `Recommendations` tag. `GET /v1/gardens/{gardenId}/today` returns the
capped prioritized presentable set (candidates in `eligible`/`presented` whose validity window
covers now, ordered by the score re-derived from the STORED priority factors — the clamped sum of
`{ contribution, basis }` contributions, the same shared aggregation the engine writes with) and
records first presentation as a read-triggered `eligible → presented` transition under the
per-garden advisory lock. Five commands (each revision-guarded via `If-Match`, idempotent via
`Idempotency-Key`, one transaction each) implement FR-24's controls: complete (feedback `completed`
→ state `completed`), postpone (feedback `postponed` with the optional user horizon → state
`postponed`; the ENGINE re-surfaces later — a NEW candidate referencing the postponed record via
`supersedes_candidate_id`, the postponed record untouched), dismiss (feedback `dismissed` → state
`rejected`), mark-irrelevant (feedback-only, no transition, legal on `presented`/`rejected`), and
convert-to-task (candidate → `completed` + `completed` feedback + a `source: 'suggested'` task
carrying `origin_recommendation_id`, the rule's action title, and the stored explanation as notes,
journaled and sync-recorded like every task). The engine now persists each candidate's rendered
deterministic explanation (migration `1785800000000_recommendation-explanation.sql` — nullable only
on legacy pre-P7-BE-01 rows, which drain through supersession/expiry and are never presentable) and
records the `generated → eligible` transition at persistence time.

Phase 7 now includes P7-NOTIF-01: the notification pipeline from domain event to durable in-app
inbox. The workers outbox relay recognizes `recommendation.candidate_created` as its fourth event
type and forwards each claimed row to the API's OIDC-verified
`POST /internal/notifications/events`; `ApplyNotificationPolicy` (the new `notifications` module)
rechecks the candidate's CURRENT state, fans out to the garden's active members, resolves each
recipient's preferences (per-type/per-channel entries with per-garden overrides, default-on),
resolves quiet hours with real IANA time-zone math (DST-proven; preference zone override falling
back to the profile's own `time_zone`), and persists one durable intent per recipient —
per-recipient deduplication enforced by a unique `(recipient, dedup_key)` index so redelivery and
concurrent delivery collapse, expiry tied to the candidate's own validity window, a structured
`gardenToday` deep link, and a stable template key + parameters for client-side locale-late
rendering. A superseding candidate's event closes the prior candidate's pending intents. The
in-app inbox is the intent itself (`GET /notifications` with keyset pagination and durable
read-triggered expiry; idempotent-by-design read/dismiss stamps;
`GET`/`PUT /notification-preferences` guarded by a document revision starting at 0). P7-NOTIF-02
then completed the delivery half: FCM device records with register/refresh/remove contract
operations, the `sent`/`failed`/`skipped` intent vocabulary with append-only delivery-attempt
records, and the scheduled delivery sweep that re-runs the access/preference/freshness rechecks
at send time before each Admin-SDK FCM send — see the P7-NOTIF-02 entry below for what remains
open (client FCM wiring; live-send verification).

Phase 7 now includes P7-AI-01: the bounded Vertex AI explanation embellishment, shipped whole and
switched OFF everywhere. The integrations module gains its third capability — the provider-neutral
AI-explanation port, the `GenerateAiExplanation` call machinery (budget consumed before every call
through the shared `provider_quota_usage` accounting, strict per-call deadline, typed transient
degradations), and the REAL Vertex adapter over `@google/genai` (the current Google Gen AI SDK;
the older `@google-cloud/vertexai` is deprecated by Google) using Application Default Credentials,
a strict JSON response schema, explicit safety settings, and a versioned prompt template.
tasks-recommendations gains the section-10 AI-explanation record
(`tasks_recommendations.recommendation_ai_explanation`, migration
`1786100000000_recommendation-ai-explanation.sql`: one append-only verdict per candidate+locale
carrying provider/model/prompt-template provenance, the packet's evidence fact keys, the generated
text, and the validation outcome), the bilingual bounded validation
(`validateAiExplanationDraft` over en+ru action-concept and prohibited-content lexicons: evidence
references restricted to the packet, action vocabulary restricted to the candidate's OWN
deterministic baseline, numeric fact invention rejected, excluded-category vocabulary always
rejected, hard length bound), the sweep's third phase (`EmbellishRecommendationExplanations` —
async post-generation, never in the Today request path, quota exhaustion stops the batch,
transient failures retry next run, verdicts never retry), and Today serving of accepted
embellishments (`embellishedExplanation` + `explanationSource` on `TodayRecommendation`;
`explanation` stays the deterministic text always). Everything sits behind the
`RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch, off by default: no GenAI client is
constructed, the sweep phase does not exist, the Today read path never touches the verdict table,
and the response is the exact pre-P7-AI-01 baseline — proven end to end by the rollback test in
`tests/integration/recommendation-ai-explanation.test.ts`. The bilingual evaluation harness lives
in `tests/ai-explanation-fixtures/` (the section-16 dataset as runnable fixtures); live enablement
and the human evaluation pass are deliberately deferred — see the P7-AI-01 entry below.

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

**Worker rollout (P6-WORKER-01 operational boundary).** Malware scanning is no longer deferred: it
was DECIDED AGAINST. ADR-0017 (August 6, 2026) removed the `MalwareScanner` port, its placeholder
adapter and the `malwareScanRequired` policy field, because with PDFs unscanned no media class
required a scan and a port with no caller is not a seam. The exposure that decision accepts, and the
preflight refusals now carrying the whole weight, are recorded in the ADR. Before the worker can run in
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
configuration load without it). P7-ASYNC-01 extends that same env list with
`WEATHER_REFRESH_SWEEP_URL` and `RECOMMENDATION_EVALUATION_SWEEP_URL` (both derived from the live
API URL by `deploy-workers.sh` itself, both required at configuration load), in the same
written-not-executed state. P7-NOTIF-01 adds `NOTIFICATION_EVENTS_URL` (same derivation, same
required-at-load posture) to that list, likewise written and syntax-checked but not run against
any real project. P7-NOTIF-02 adds `NOTIFICATION_DELIVERY_SWEEP_URL` (same derivation, same
required-at-load posture; the minute-order interval keeps its configuration default), in the same
state.

**Raw-capture retention enforcement (P6-RET-01 scope boundary).** The 30-days-after-successful-
extraction rule (architecture/media-storage-and-processing.md section 15; garden-capture-and-scan.md
section 10.8) is DECLARED through `GET /media/retention-policy` with an explicit `enforced: false`
flag, and the sweep already processes any record whose `retention_deadline_at` passes — but nothing
sets a raw-capture deadline yet, because the anchoring event (successful extraction) has no producer.
Automated reconstruction is research-only and does not authorize one. If a future ADR and newly
numbered delivery phase introduce production raw capture, that work must stamp
`retention_deadline_at = extraction + 30 days` (or an approved shorter duration) and flip the policy
entry to `enforced: true`; the sweep and deletion workflow need no further change. "Users may delete
raw media sooner" already works: `DeleteGardenMedia` accepts any `available` original, raw capture
included.

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

**PDF page-preview rendering — BUILT (ADR-0017, August 6, 2026).** No longer deferred. The
validation worker renders a plan PDF's FIRST PAGE with `poppler`/`pdftoppm`, behind a
`PdfPageRasterizer` port with one adapter, and the page then takes the ordinary raster path:
thumbnail, screen preview, high-resolution image, tile pyramid. `services/api`'s
`application/derivative-eligibility.ts` now admits `application/pdf` for `imported_plan` — that
exclusion was what made a real surveyor's plat upload, validate, and produce nothing. Pages beyond
the first remain unrendered, and an imported background pointing at one says so.

**PDF plan display in the web client — BUILT (ADR-0017).** The client shows the rendered
screen-preview derivative for a PDF plan exactly as it does for a scan; no client-side PDF renderer
was added, and none is needed. The remaining honest notice is narrow: an imported background
pointing at a page other than the first still shows a placeholder outline.

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
georeference-authoring capability, now assigned explicitly to `P12-GEO-01`, not more calibration
modeling. That work package also owns confirmed reverse-geocoded address metadata, true-north
orientation and manual fallback, accuracy/provenance, privacy, revisioned authoring, and the API and
client flows needed to make the existing read-only model writable.

**Care-category vocabulary (P7-DATA-01 scope boundary).** The recommendation data model
(`1785600000000_recommendations-baseline.sql`) carries a required `care_category` on every
recommendation candidate, but the column is guarded only by a non-blank CHECK, not a CHECK-enumerated
vocabulary: `P0-PROD-03`'s "initial care categories" is a still-undecided product selection, and no
care-category list exists anywhere in this repository's docs or code today — unlike lifecycle stages,
task states, and urgency levels, which have been live since Phase 4 and are reused verbatim.
Freezing the glossary is that product decision's job; when it lands, a follow-up migration adds the
enum CHECK (the same posture `media.processing_job.job_kind` documents for its own not-yet-closed
vocabulary). Related, and deliberately NOT deferred: restricted-safety-tier rules structurally
cannot produce candidates (a CHECK plus a composite FK onto `rule_version`'s own tier), and a
candidate physically cannot exist without evidence (a deferred composite FK checked at COMMIT) —
both enforced in the schema itself, not convention.

**Real weather provider (P7-INT-01 scope boundary).** The weather integration machinery is fully
built and tested in `services/api/src/modules/integrations` — the provider registry with
per-provider license/attribution/timeout/quota metadata, the normalized `integrations.weather_record`
model (SI units with per-field source-unit conversion provenance enforced by CHECK, effective vs.
fetch time, quality, license snapshot, per-garden anchoring at the georeference's WGS84 coordinates),
read-time freshness classification, cache-not-refetch semantics, atomic hour/day quota accounting
(`integrations.provider_quota_usage`), bounded fetch deadlines, and the
`RefreshGardenWeather`/`GetGardenWeather` use cases — but NO real weather vendor exists anywhere in
this repository, deliberately: provider selection is `P0-PROV-01`, an undecided implementation-time
selection (technical-specification.md section 14.2), the exact blocker that deferred P6-PLANT-01's
plant-content provider. The registry has zero production registrations, `activeProviderKey` is null
in every environment, and the honest runtime outcome is the typed `noProviderConfigured`
degradation — the `identifyPlantFromPhoto` posture applied to a whole integration; the only adapter
implementations are the deterministic fakes the provider-contract and replacement tests run. When a
vendor is selected, integrating it is one adapter class implementing `WeatherProviderAdapter`, one
`WeatherProviderRegistration` with its real license/quota/timeout terms, and one configuration key —
proven by the two-fake replacement tests in
`tests/integration/integrations-weather.test.ts`. The freshness windows are no longer unnumbered:
`P7-ASYNC-01` — the implementation-time selection P7-INT-01's own comments deferred to — wires the
use cases into the composition root, so `WEATHER_OBSERVATION_FRESH_FOR_MS` /
`WEATHER_FORECAST_FRESH_FOR_MS` now carry documented reasoned defaults (one hour / six hours,
`configuration-schema.ts`'s own comment) and `WEATHER_ACTIVE_PROVIDER_KEY` is optional environment
configuration, absent everywhere. **`P0-PROV-01`'s weather half is now decided** (2026-07-26,
`docs/implementation-plan.md` §29.1.1): Open-Meteo, models pinned to NOAA, registered in
`compose-integrations.ts` with real license/quota/timeout metadata. Registered is not active —
`WEATHER_ACTIVE_PROVIDER_KEY` still selects nothing, so the sweep's behavior below is unchanged
until that key and a paid-tier API key are configured. Scheduling is closed: the worker's hourly
interval scheduler triggers `/internal/weather-refresh/sweep`, which iterates active georeferenced
gardens through `RefreshGardenWeather` (least-recently-fetched first, batch-capped,
quota-exhaustion stops the batch honestly) — with no active provider a typed, logged, observable
no-op. Related, and NOT deferred:
`tasks_recommendations.recommendation_evidence.source_weather_record_id` — P7-DATA-01's documented
bare-uuid deferral — is now a real foreign key onto `integrations.weather_record`, closed by
`1785700000000_integrations-weather-baseline.sql` at the first moment its target table existed.

**Real plant-content provider (P7-INT-02 scope boundary).** The plant-content integration
machinery is fully built and tested in `services/api/src/modules/integrations` — the
provider-neutral port (`searchTaxa` + `fetchContent`), the `PlantContentProviderRegistry` with
per-provider license/attribution/jurisdiction/presentation/timeout/quota metadata, the
`integrations.plant_taxonomy_mapping` table anchoring provider taxonomies onto the application's
own stable `plants_inventory.taxonomy_reference` catalog (immutable identity triple, explicit
confidence, `unverified`/`verified`/`rejected` verification state, live-uniqueness partial index),
the append-only `integrations.plant_content_record` table (provider record id/version, content
language, licensed description and care-guidance sections, license/attribution/jurisdiction/
presentation snapshot per row), and the `MapPlantTaxonomy`/`RefreshPlantContent`/`GetPlantContent`
use cases with the shared quota/deadline machinery — but NO real plant-content vendor exists
anywhere in this repository, deliberately: provider selection is `P0-PROV-01`, the same undecided
implementation-time selection that bounded the weather integration until its half was decided
(see above) — the plant-content half remains open. The registry has zero production registrations,
the active key is null everywhere, every outcome is a typed `noProviderConfigured` degradation, and
the only adapter implementations are the deterministic fakes the provider-replacement tests run
(`tests/integration/integrations-plant-content.test.ts` — the work package's acceptance
evidence: two fakes through identical machinery; the switch is one adapter class, one
registration, one explicit `MapPlantTaxonomy` run, and one configuration key; both providers'
mappings and content rows coexist with their own license snapshots and the earlier provider's
rows untouched). Also deliberately bounded, each waiting on a named owner: (1) the use cases are
UNWIRED — no composition-root caller exists because no document names a client-facing
plant-content surface this phase and nothing schedules content refresh (weather's sweep exists
because P7-ASYNC-01 named it; the stage that first consumes plant content wires and, if needed,
schedules it); (2) mapping VERIFICATION is repository-and-domain machinery only
(`updateVerificationState` guarded by `validateMappingStateTransition`) — verifying or rejecting
an identity claim is a human judgment and no reviewer-facing surface exists, so every mapping is
honestly `unverified` until a future stage builds that surface; (3) licensed IMAGES are not
modeled — section 8 names them, but storing provider imagery needs the media pipeline
(verification, retention, deletion), and a text-only slice that pretended otherwise would be an
empty column; (4) the two content sections (`description`, `care_guidance`) are the whole
normalized vocabulary until `P0-PROD-03` decides the care-category glossary — a per-category
structure now would freeze a vocabulary no product decision has made; (5) content freshness is a
refetch-window cache rule, not a stored or classified state — no document defines when plant-care
content goes stale, so nothing pretends to know.

**Horticultural sign-off of the launch rule catalog (P7-SAFE-01 scope boundary).** The
deterministic rule engine and its four-rule launch catalog are fully built and tested in
`services/api/src/modules/tasks-recommendations` (rule model, pure engine, idempotent
`rule_version` registration, `EvaluateGardenRecommendations`, and the reviewable fixture suite in
`services/api/tests/rule-fixtures/`), and `P7-SAFE-01`'s implementable half is now delivered:
the consolidated safety catalog at
[recommendation-safety-catalog.md](recommendation-safety-catalog.md) — the reviewer's single
entry point, carrying the tier model with every enforcement point, the ten excluded content
categories with their rule-layer and AI-lexicon enforcement (including the documented and
test-pinned `toxicity → medical` lexicon merge, `domain/ai-explanation-lexicon.test.ts`), the
elevated-risk constraint rules, the per-rule review ledger, the review procedure, and the
sign-off protocol. What remains open is the SIGN-OFF itself: the rules' horticultural CONTENT —
thresholds, stage lists, cadences, stale-weather postures — names a HUMAN review no agent can
self-satisfy. Until a named reviewer lands it, every launch rule carries
`reviewStatus: 'awaiting_horticultural_review'` in its own metadata and
`launch-rule-catalog.test.ts` fails if that marking is dropped without a named reviewer. NOT
deferred, enforced structurally regardless of review: no rule definition can carry the
`restricted` safety tier (the type cannot express it), no rule can declare an excluded content
category (chemical application, toxicity, pest treatment, disease diagnosis, fertilizer
concentration, structural, electrical, medical, legal-boundary, emergency — rejected by
`validateRuleDefinition` in any spelling), the AI-explanation lexicon rejects the same subjects'
vocabulary in both product languages regardless of any baseline (with the two lists' alignment
CI-pinned), and the P7-DATA-01 schema rejects a restricted-tier
candidate again at insert. Also deliberately absent, with a reason: seasonal applicability gating
(no launch rule declares one, and a season honestly needs the garden's hemisphere via its
georeference — the mechanism arrives with the first rule that needs it, not as dead code).
Two deferrals this entry used to carry are now CLOSED by `P7-ASYNC-01`: expiry of never-acted-on
candidates whose window passed between evaluations (the scheduled sweep's expiry phase, using the
already-shipped `expireRecommendationCandidate` transition), and the engine's scheduler
(`RunRecommendationEvaluationSweep` + the internal `/internal/recommendation-evaluation/sweep`
route, wired into `app.ts`); the user-facing HTTP surface remains `P7-BE-01`'s.

**Real Cloud Scheduler for the scheduled sweeps (P7-ASYNC-01 scope boundary).**
architecture/asynchronous-processing.md section 16 names Cloud Scheduler for periodic initiation;
this codebase's established periodic mechanism is the worker's own overlap-guarded interval
scheduler (`services/workers/src/sweeps/interval-sweep-scheduler.ts` — the relay-poller precedent
P6-RET-01 extended and P7-ASYNC-01 generalized), which is what schedules all three sweeps today.
Migrating to real Cloud Scheduler resources is a later operational decision, tied to the same
worker-rollout question already tracked above (the interval model needs the worker's
always-allocated CPU; a Cloud Scheduler → endpoint model would remove that requirement). The
migration is deliberately cheap by construction: each sweep endpoint is already exactly the shape a
Cloud Scheduler HTTP job invokes — an OIDC-verified POST returning a structured summary, duplicate-
and overlap-safe on the API side regardless of what schedules it — so the move is scheduling
infrastructure plus log-heartbeat relocation only, no API or domain change.

**Live Vertex AI enablement and the human evaluation pass (P7-AI-01 scope boundary).** The whole
bounded-explanation path ships dark: `RECOMMENDATION_AI_EXPLANATION_ENABLED` defaults to `false`,
no environment sets it, no Vertex AI API is enabled on `verdery-dev`, and no gcloud script grants
the runtime service account any Vertex role — live enablement follows the session's standing
confirmation gate (the FCM posture). Turning it on is deliberately small and explicitly gated on
TWO things beyond infrastructure: (1) choosing a model — `RECOMMENDATION_AI_MODEL` has no code
default because a model identifier is a section-16 evaluated release decision; (2) the HUMAN
evaluation pass recommendations-and-ai.md section 16 requires — a bilingual review of REAL model
outputs for every launch rule through the shipped validation pipeline, which no agent can
self-satisfy (the launch-rule catalog's own `awaiting_horticultural_review` honesty posture; the
machine-checkable half already exists as `services/api/tests/ai-explanation-fixtures/`, whose
README defines what the human pass adds, and
[recommendation-safety-catalog.md](recommendation-safety-catalog.md) section 6 places this pass
relative to the rule-catalog review it does not replace). Also deliberately not built: Russian RUNTIME generation —
the validation machinery is bilingual and harness-proven, but the stored deterministic baseline is
English rule content and no serving surface negotiates a locale yet, so the runtime locale is a
documented `'en'` constant (`compose-tasks-recommendations.ts`); a locale-negotiated Today (or
localized rule content) is the stage that flips it. Vertex data-retention/abuse-monitoring settings
are project-level configuration reviewed at enablement time, alongside section 8's other approved
AI use cases (observation classification, content extraction, the conversational assistant), none
of which any current work package builds.

**~~Recommendation notification consumer (`recommendation.candidate_created`)~~ — closed by
P7-NOTIF-01.** The workers relay now claims the type as its fourth recognized event and forwards
each row whole to the API's OIDC-verified `POST /internal/notifications/events`
(`ApplyNotificationPolicy` — the `domain event -> notification policy -> persist in-app intent`
steps of notifications.md section 5), marking the outbox row published only after the API's 2xx.
The anticipated safety property held exactly as designed: the policy rechecks candidate freshness
at intent creation, so the accumulated pre-consumer backlog drains as typed suppressions
(`candidate_not_live` / `candidate_window_passed` / `candidate_missing`), never as stale
notifications. What this stage deliberately does NOT build is push DELIVERY — see the next entry.

**~~Push delivery, device tokens, and send-time recheck execution~~ — closed by P7-NOTIF-02.**
The delivery half is real: revocable FCM device-channel records with register/refresh/remove
contract operations (`PUT`/`DELETE /notification-devices/{deviceInstallationId}`), the completed
intent state machine (`sent`/`failed`/`skipped` with typed `close_reason`, append-only
`notification_delivery_attempt` records), and the scheduled delivery sweep
(`POST /v1/internal/notification-delivery/sweep`, the established interval-tick → OIDC-verified
internal-endpoint pattern) that claims due intents under a `FOR UPDATE SKIP LOCKED` lease and
re-runs the send-time rechecks — access, current preference/quiet-hours (deferral when the window
moved), and the Stage 23 freshness classification — before any FCM send through the Admin SDK's
messaging surface. Invalid/unregistered token verdicts disable the device record idempotently;
transients retry under a bounded backoff budget; the P7-NOTIF-01 at-scale `pending -> expired`
close now runs in this sweep. What remains open, honestly:
(1) **Client-side FCM wiring** — no client obtains or registers a token yet: the iOS app needs
APNs entitlements, Firebase Messaging SDK integration, token registration against the new contract
ops, and foreground/background presentation of the data-only payload (the server sends
`content-available` data messages; visible-notification presentation is the client's rendering
decision, locale-late); the web app needs a service worker plus the same registration calls.
(2) **Live FCM send verification** — deliberately unverifiable today: no real device token exists
anywhere (no app installs), so the FCM edge is proven at the port boundary
(`FakePushMessageSender` + the adapter's classification tests over constructed SDK error shapes);
the first client stage that registers a real token is where a live push is first observable.
(3) **Per-intent Cloud Task scheduling** — the minute-order sweep delivers within
`earliest_delivery_at`'s own minute granularity; a per-intent Cloud Task is a recorded refinement
if delivery precision ever needs to be finer (notifications.md section 9).
Still open from P7-NOTIF-01's own list: the one-type vocabulary (`care_recommendation`; P9 brings
publication/invitation types, email, and opt-out classification), digest behavior (not offered),
and the client inbox UI.

**Offline Today actions in the sync protocol — decided by P7-IOS-01: not built.** The P7-BE-01
recommendation commands are deliberately NOT routed through `POST /v1/sync/push`: recommendations
are not a synced record family (candidates are server-generated, and no client replicates them
offline today), so adding `recommendation` operations to the sync contract now would be dead
surface no client consumes — the same "wiring dependencies no caller reaches is dead composition"
posture P7-DATA-01 and P7-INT-01 applied to their own unwired halves. The commands are SHAPED for
that future exactly like the task commands (idempotency key reusable as a sync `operationId`,
`expectedRevision` guards, per-operation conflict semantics), so if a later stage decides Today
actions must work offline, a `route-recommendation-operation.ts` following
`route-task-operation.ts`'s pattern plus the sync payload contracts is the whole gap.
P7-IOS-01 has now made that decision explicitly: the native Today surface is ONLINE-ONLY with
honest degradation (a named "Today needs a connection" state on a first-load transport failure; a
kept, explicitly stale-labeled in-memory set when a refresh fails after a successful fetch this
session; a real empty state) — the calibration flow's established precedent — because first
presentation, expiry, and supersession are server-decided facts a local projection would have to
fabricate. The sync-push routing therefore remains available to a future stage that revisits the
decision, with the gap unchanged. The CONVERTED task, by contrast, is a task — its creation
already writes the `sync_change` row offline clients pull.

**`originRecommendationId` on the iOS task model (P7-IOS-01 scope boundary).** The contract's
`Task` schema gained the additive `originRecommendationId` member in P7-BE-01, and the web client
reads it. The iOS client tolerates it (proven by a gateway decode test) but does not yet model
it: `CoreDomain.GardenTask`, `CoreNetworking.GardenTaskTransport`, the local GRDB `task` table
(`TaskRecord` plus a `LocalDatabase` column migration), and `TaskSyncRecordApplier` would all
need the field, rippling through every `GardenTask` construction site — real, scoped work no
current iOS surface consumes: the conversion flow links by construction (the response carries the
task), and no iOS task UI displays origin lineage yet. The first iOS surface that must
DISTINGUISH a conversion-completion from a manual task on device brings the field through that
whole path with it.

**Garden-area target display names in Today (P7-BE-01 scope boundary).** `targetDisplayName`
resolves the plant's current display name for plant targets and `null` for garden targets (the
client knows its garden). Garden-AREA targets also return `null` this pass, honestly: no launch
rule produces an area-targeted candidate, and map-object display naming lives in category detail
tables no current read path needs — the first area-targeting rule brings the resolution with it.

**Bulk recommendation computation via Cloud Run Jobs (P7-ASYNC-01 scope boundary).** The
recommendation sweep drains ALL eligible gardens per run in bounded keyset pages inside one
HTTP-triggered request — correct and fast at any plausible current garden count, and the honest
alternative to a per-run cap that would starve gardens beyond it (evaluation leaves no durable
ordering key behind when it suppresses everything, so capped rotation has nothing fair to rotate
on). When the eligible-garden count outgrows a single in-request pass,
architecture/asynchronous-processing.md section 7 already assigns "Bulk recommendation computation"
to Cloud Run Jobs with checkpointed progress — that, not a bigger request timeout, is the recorded
growth path.

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

**Consented client-side care-loop analytics (P7-ANALYTICS-01 scope boundary, blocked on
`P0-SEC-01`).** P7-ANALYTICS-01's consented half — architecture/observability-and-analytics.md
section 10's client-emitted product events ("Recommendation presented/completed/postponed/
rejected" and their kin), section 11's consent machinery (versioned consent state, synchronized
opt-out, clients emitting nothing before consent), and any product-analytics SDK (Firebase
Analytics/GA4 per section 2) — is deliberately absent, not half-built: the consent model is
`P0-SEC-01`, still undecided, the exact blocker that deferred `P4-OBS-01`, and building a
consent gate against an invented consent model would be worse than not building one. What the
work package could honestly deliver is built: server-side quality measurement over the server's
own operational records (candidate lifecycle, feedback trail, notification intents, sweep
events) with the consent BOUNDARY pinned by tests — `services/api/tests/analytics/
care-loop-analytics.test.ts` compile-pins every analytics event's field allowlist and closed
reason vocabularies and rejects identity-/content-shaped fields, and the HTTP emission suites
assert the emitted lines' exact key sets — so when `P0-SEC-01` lands, the client half starts
from a catalog whose server-side discipline is already mechanical. See the observability
document's P7-ANALYTICS-01 subsection for the full measure-by-measure account.

**Care-loop dashboards, log-based metrics, and alert policies (P7-ANALYTICS-01).** The same
shape as the sync- and media-dashboard entries above, applied to the care loop: every measure
the work package names (presentation, completion, postponement, rejection, irrelevance,
freshness, fallback) is now a real, test-verified structured log event or a documented SQL
measure over durable rows, and observability-and-analytics.md's P7-ANALYTICS-01 subsection
specifies the log-based metric definitions, the "Recommendations and AI" dashboard widget
compositions, alert candidates with reasoned thresholds, and runbook entries they support —
but no Cloud Monitoring dashboard, log-based metric, or alert policy has been CREATED against
any environment, and the per-rule-version funnel SQL runs as operator queries (a scheduled
BigQuery export needs section 17's explicit cost and privacy review). The P1/P5/P6 "-01"
observability delivery bar, unchanged.

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

**`addFromPhoto`/`confirmIdentification` — closed by ADR-0015's client wiring.**
`app/application/gardens/[gardenId]/plants/add-plant-from-photo-panel.tsx` (a page-local component,
not inside `features/plants`, since it needs `features/media`'s `useMediaUpload` directly — see that
file's own doc comment on the dependency-rule reasoning) now drives the full real flow: upload → real
`AddPlantFromPhoto` → real `GetPlantIdentification` read → review the AI's suggestion → real
`ConfirmPlantIdentification`, or decide later. `features/plants/plant-detail.tsx` also gained a
pending-identification banner (`usePlantIdentification`), so a suggestion left unconfirmed there
stays reachable. `usePlantIdentification` folds the read's `plants_inventory.plant.
identification_not_found` `404` into `null` the same way `useGardenOwnershipTransfer` already does
for an identically-shaped "pending, or nothing to review" resource.

**Still open**: `task-gateway.ts`'s `attachFile` remains implemented and unit-tested for contract
completeness only, with no `features/tasks` component calling it. Adding a photo to an existing
plant and choosing its primary photo are now closed on web: the plant-detail route composes the
shared resumable media upload with `useAttachPlantPhoto`, while `PlantPhotoGallery` calls
`useSetPrimaryPlantPhoto` and offers a screen-fitting lightbox. `RecordObservation`'s photo support
is still left off
`RecordObservationForm` the same way, though the contract already lets a note and/or a condition
summary stand on their own without a photo, so recording an observation itself is not blocked. Each
of these can now reuse `features/media`'s upload machinery directly (the same `useMediaUpload` hook,
parameterized by `mediaClass`, already returns the `mediaId` these commands need) — the remaining
task-file and observation-photo work is UI wiring per attachment point, not new upload
infrastructure. iOS has no such plant-photo gap:
`PlantDetailView`'s "Attach Photo" (`P6-IOS-01`, described above) already attaches an additional
photo to an existing plant on that platform.

**Plant photo gallery, observation-suggestion, and acquisition-date guess client wiring
(ADR-0015 extension).** Following up on live use of the identification/condition-tracking work
above, three related gaps closed together across both clients. (1) **Photo gallery**: a plant's
attached photos (from `AddPlantFromPhoto` or, on iOS, `AttachPlantPhoto`) were never rendered back
anywhere — `listPlantPhotos` (`GET /gardens/{gardenId}/plants/{plantId}/photos`, unpaginated) is a
new read backing a real gallery on both platforms: web's `PlantPhotoGallery`
(`features/plants/plant-photo-gallery.tsx`, resolving each photo's `mediaId` through a
plants-owned `usePlantPhotoAccess`, mirroring `features/map/media-queries.ts`'s "rebuild the read
directly on `core/api`" convention rather than importing `features/media`) and iOS's
`PlantPhotoGalleryController`/`PlantPhotoGalleryView` (resolving each photo's signed URL eagerly via
the existing `MediaGateway.getMediaAccess`, an `AsyncImage` thumbnail row). (2) **Observation
suggestion**: `RecordObservationFromIdentification` (`POST .../identification/{id}/
record-observation`) turns a pending identification's already-computed `suggestedConditionNote`/
`suggestedCareGuidanceNote` into a real `Observation`, independent of and combinable with
`ConfirmPlantIdentification` over the same row — a second "Record as observation" action alongside
"Confirm" on both the add-from-photo review screen and the plant detail page's own pending-
identification banner, shown whenever a condition guess exists regardless of whether the species
guess itself was confident enough to confirm. (3) **Acquisition-date guess**:
`PlantIdentification.suggestedAcquisitionDate` (a calendar date, confidence-gated the same way as
every other suggested field, `VERTEX_PLANT_SPECIES_PROMPT_TEMPLATE_VERSION` bumped to 3) is applied
by `ConfirmPlantIdentification` only when the plant's own `acquisitionDate` is still unset (fill-
blanks-never-overwrite, defaulting `acquisitionDateType` to `'acquired'` when that is also unset),
and shown as a suggestion-detail row on both clients. All three ship alongside a plant-detail-page
visual pass on both platforms: icon-plus-label-plus-value suggestion rows (`PlantSymbols.condition`/
`.careGuidance`/`.acquisitionDateGuess` on iOS; label-above-value-below blocks on web) instead of
single colon-joined lines, and Delete moved into its own clearly-destructive-styled section
(`SecondaryButtonStyle(tone:)`/`SurfaceCard(tone: .negative)` on iOS; `Button variant="destructive"`
inside `Alert tone="danger"`, in a new `PlantDeleteSection`, on web) instead of a plain button at the
bottom of the same panel as unrelated stage/status controls.

**Candidate specimen photos and licensed taxon reference photos — closed 2026-08-06.**
`ConvertCandidate` now copies every candidate-photo association to the resulting plant while
retaining the candidate associations as immutable conversion evidence. The plant detail renders
those user-owned specimen photos separately from `PlantTaxonImage` reference photos. The latter
are fetched cache-aside through the configured global knowledge-provider registry when an
identified taxon has no cached presentable image; the existing server-side commercial-display
license allowlist remains authoritative. A reviewed fact projection is no longer a prerequisite
for imagery: `PlantTaxonProfileResult.profile` is nullable, while licensed images can still be
returned immediately.

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
duplicating the same progress/retry/status UI glue twice. `SetPrimaryPlantPhoto`/`AttachTaskFile`
remain UI-unreached on iOS, the same "implemented and tested at the gateway layer, no real caller"
gap this section already describes for their web counterparts — genuinely separate follow-ups, not
attempted here.

**`AddPlantFromPhoto`/`ConfirmPlantIdentification` on iOS — closed by ADR-0015's client wiring.**
`FeaturePlants.PlantAddFromPhotoSheetView` (a new screen reachable from `PlantsHomeView`'s "Add from
photo" entry point) drives the same real flow web gained: pick/upload a photo (the same
`PhotoAttachmentController`, `mediaClass: .gardenPhoto`) → real `AddPlantFromPhoto` → real
`GetPlantIdentification` read (`FetchPlantIdentification`, narrowing the `404` "nothing pending" case
to `nil` the same way `FetchGardenOwnershipTransfer` already does) → review the suggestion → real
`ConfirmPlantIdentification`, or decide later. `PlantDetailView` also gained a pending-identification
banner for a suggestion left unconfirmed there. Backend note: this closes the gap between the client
and `AddPlantFromPhoto`/`ConfirmPlantIdentification` themselves, which were already real, tested
commands — what was missing was a caller, plus (until this pass) any way for a client to read back
what a suggestion actually named before deciding whether to confirm it (`GetPlantIdentification` is
new).

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

**Photo-identification and photo-analysis ML services — replaced by real Vertex AI/Gemini calls,
ADR-0015.** `plants-inventory`'s `identifyPlantFromPhoto` and `observations-history`'s
`analyzeObservationPhoto` were previously honest, clearly-labeled placeholders — always "no
suggestion, zero confidence." Both are now real: `VertexAiPlantSpeciesIdentificationAdapter`/
`VertexAiPlantConditionAnalysisAdapter` call Gemini with a strict JSON `responseSchema` and a zod
parse that never trusts raw model output, behind independent kill-switches
(`PLANT_SPECIES_AI_ENABLED`/`PLANT_CONDITION_AI_ENABLED`, both default `false` in every environment
except `verdery-dev`, per ADR-0015's own owner-confirmation gate for going further). `AddPlantFromPhoto`
still never auto-confirms `plant.taxonomyReferenceId` from a photo — that invariant is architectural,
not a stub artifact — a caller always calls `ConfirmPlantIdentification` separately, exactly as
before. The client-side gap this used to name (no UI ever wired to either capability) is now also
closed on both platforms — see "`addFromPhoto`/`confirmIdentification`" and its iOS counterpart
above.

**~~`GET /gardens/{gardenId}/plants` exists but no client calls it~~ — now fixed on both platforms.**
`P4-SEARCH-01` closed the backend gap both clients' Phase 4 code had documented (no way to list a
garden's plant inventory — each fell back to create-then-navigate or open-by-id). The web client's
half closed first: `plant-gateway.ts` gained a `search` method against `SearchPlants`,
`features/plants/queries.ts` gained `useSearchPlants`, and a new `plant-list.tsx` (free-text
`displayName` search plus "Load more" cursor pagination, the same stale/loading/error-state
conventions `garden-list.tsx`/`task-list.tsx` use) is wired into the plants page alongside the
existing add/open-by-id forms. Structured filters (`lifecycleStage`/`status`/`groupingKind`) were
left out of this pass as a deliberate, documented scope call — the endpoint accepts them, but no
filter UI was built beyond the text search box. iOS closed the same gap subsequently:
`CoreNetworking.PlantGateway.searchPlants` (mirroring `GardenGateway`'s own cursor-page shape),
`FeaturePlants.SearchPlants`, and a new `PlantsListViewModel`/`PlantsListView` (a manual "Load more"
button, matching the web client's own choice over inventing infinite scroll) are now wired into
`PlantsHomeView`, whose stale "no list operation" comment this closure also corrected — a user can
now actually browse a garden's inventory on either platform, not only create or navigate to a known
id.

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

**Data-export residuals (P8-EXPORT-01 scope boundaries).** The export request/generation/delivery
pipeline is implemented and tested end to end (see `data-export-and-deletion.md` sections 5.1, 7.1,
9.1); what the stage deliberately did NOT build, each with its flip condition:

- **Client UI for requesting exports.** The contract ships (`openapi.yaml`, tag `Exports`); no web
  or iOS surface calls it yet. Flips when a client work package picks it up — the endpoints are
  ready.
- **Editor/viewer garden-export entitlement.** The doc says "Editor and viewer export rights are
  controlled by garden capability"; the capability (`exportGarden`) exists and is owner-only, and an
  account export names non-owned gardens as excluded (`exclusionReason: 'not_owner'`) instead of
  guessing a default no document grants. Flips on a product decision widening the capability matrix.
- **Raw-capture inclusion.** Requires the "separate sensitive-media permission" section 4 names,
  which has no mechanism anywhere yet (the same gap `GetMediaAccess`'s viewer rule documents).
  Excluded entirely — files AND metadata — and disclosed in the package manifest.
- **WGS84-transformed GeoJSON geometry.** The doc calls it "Optional … when a valid georeference
  exists"; the package carries the georeference PARAMETERS (anchors, rotation, scale, accuracy)
  instead of applying the transform server-side. Flips when a stage owns the transform math and its
  accuracy labeling.
- **Email delivery of the export-ready notice, and any push channel.** Section 9's own words are
  in-app baseline, "email may be added through the notification adapter"; the `export_ready` intent
  pins `channelPush` false. Flips with a notification-adapter work package.
- **Per-media-file resume inside one ZIP assembly pass.** Checkpoints freeze the structured
  snapshot; a retried ASSEMBLY restarts and overwrites the same package object. Honest at beta
  media volumes; flips if real package sizes make a restarted assembly expensive (staging media
  copies or composing partial uploads would be the shapes to evaluate). Related bounds, documented
  in the job's own header: media files are buffered per file during assembly, structured sections
  travel in one snapshot response, and packages above ~4 GiB rely on `archiver`'s zip64 support.
- **Stale-running export reclamation.** If Cloud Tasks exhausts its retry budget, a request can
  linger `running` past usefulness; the status endpoint reports it honestly and the one-active
  index keeps it from blocking anyone but its own requester — who is unblocked the moment a new
  attempt completes or an operator fails the request through the completion endpoint. A staleness
  sweep (the retention-sweep shape) is the flip if beta telemetry ever shows this occurring.
- **Worker exports-bucket IAM grant execution.** `10-media-processing-queue.sh` now drafts the
  `roles/storage.objectCreator` grant on the exports bucket (overwrite legality comes from the
  P6-RET-01 delete-only role already bound there); written and reviewed, NOT executed — the
  standing infra boundary.

**Client export handoff-window residual (P9C-EXPORT-01 scope boundary).** The client-entitled
export manifest (`GetClientExportManifest`, `data-export-and-deletion.md` section 4.1) is
implemented and tested end to end; one gap named by the architecture was found genuine, not
invented around:

- **No configured "handoff window."** Section 18 step 3 promises portal/media access survives "the
  configured handoff window" after an engagement ends. No such window is configured anywhere in
  this codebase: `GetClientMediaAccess` requires the entitling engagement to be `active`, full stop,
  so an ended engagement's media becomes unavailable the INSTANT it ends, not after a grace period.
  The manifest's own `media` list is made to behave consistently with that live route rather than
  inventing a different rule for the export copy. Flips when a product decision names an actual
  duration and a mechanism (most likely a scheduled state transition or a grace-period check
  alongside `GetClientMediaAccess`'s own `engagementState !== 'active'` gate) is built for it.

**Deletion residuals (P8-DELETE-01 scope boundaries).** Garden and account deletion — recent-auth
gates, the 30-day recovery window and its restore, ownership resolution, the revocation cascade,
the checkpointed purge, media byte deletion through the P6 workflow, the Firebase identity
deletion, and the surviving completion evidence — are implemented and verified end to end (see
`data-export-and-deletion.md` sections 10.1, 11.1, 13.1). What the stage deliberately did NOT
build, each with its flip condition:

- **Client UI for deletion.** The contract ships (`openapi.yaml`, tags `Account` and `Gardens`); no
  web or iOS surface calls it yet. This is a KNOWN GAP WITH A DEADLINE, not an open-ended
  deferral: the App Store requires an in-app account-deletion path, so P8-STORE-01 cannot ship
  without an iOS screen over `POST /account/deletion`. The endpoints are ready and need no backend
  change.
- **A restored (or newly invited) member's local content.** Restoring a garden (or an account)
  reactivates the membership and emits a `garden` `upsert`, but does NOT re-emit the garden's
  content records — the restored client purged them locally on the revocation tombstone. The
  client's own recovery is the full resynchronization `offline-synchronization.md` section 13
  already prescribes for "authorization partitions changed incompatibly" (drop the cursor, pull
  from the beginning). No server change is required for that; a client-side rule is. `AcceptInvitation`
  (P9A-SYNC-01) emits the identical `garden` `upsert` for a first-time grant and relies on the same
  client-side rule for a member whose own cursor has already advanced past that garden's earlier
  history — not a new case, the same one. Flips into server scope only if per-garden resumable pull
  is ever added.
- **Immediate irreversible deletion** (section 12). The recovery window is unconditional. Section
  12 permits an immediate path "when shared ownership, fraud/security review, and legal obligations
  permit it" — none of those review processes exist, and a destructive path gated on absent
  processes would be a liability, not a feature. Flips with the support/fraud tooling P8-SUPPORT-01
  owns.
- **Ownership TRANSFER as an alternative to deletion.** Section 11's "by transfer or deletion
  policy" is resolved today by whichever branch is representable: a co-owner keeps the garden, a
  sole owner's garden is deleted. Offering a real transfer means naming a recipient, and there is
  no invitation or ownership-transfer flow to name one through. Flips with the collaboration work
  package that adds invitations.
- **Analytics-identifier removal at external providers** (section 11's "Removes analytics
  identifiers where supported and required"). No analytics provider processes end-user identifiers
  today (P7-ANALYTICS-01 measures server-side care-loop quality only), so there is no identifier to
  remove and nothing to call. Flips the moment a provider is introduced.
- **Membership-tombstone pruning.** A `removed` membership row survives its purged garden forever so
  an offline client can still converge. The set grows by one row per (purged garden, member) and is
  tiny, but nothing ever prunes it. The flip is a rule the sync module can decide honestly —
  "every registered installation of this profile has pulled past the tombstone's sequence" — which
  needs per-installation cursor tracking the protocol does not store yet.
- **Backup reapplication of deletions** (section 14). Deletion reaches active systems; nothing yet
  reapplies a deletion record after a restore from an operational backup. Belongs with P8-DB-01's
  backup/PITR work and P8-REL-01's restore runbook, which own the restore procedure this rule
  attaches to.

## What is _not_ deferred

The pnpm workspace and its version pins, the OpenAPI contract and its generated client, shared
geometry semantics, language-neutral fixtures shared between TypeScript and Swift, the SQL migration
system and its tests (including the least-privilege regression test in
`services/api/tests/migrations/platform-baseline.test.ts`), the API composition root and health
endpoints, the web application shell, the Swift package and its targets, formatting, linting, type
checking, the file-size rule, the secret scan, the `verdery-dev` cloud environment, keyless CI
deployment, OpenTelemetry tracing to Cloud Trace, the Phase 2 identity/garden database and backend
foundations, and the current web/native Phase 2 foundations.

**Recommendation history read surface (P7-WEB-01 scope boundary).** The Today endpoint returns only
presentable candidates (`eligible`/`presented` with a window covering now), and no Recommendations
read exposes past or terminal candidates or the append-only feedback trail, although every row
survives in `tasks_recommendations.recommendation_candidate` / `recommendation_feedback`. The web
Today view therefore shows history only where the contract already carries it: an acted-on item
leaves the set, and a converted task renders its `originRecommendationId` provenance on the tasks
list. A "recommendation history" surface (terminal candidates, their feedback, and the
supersession/re-surfacing chain `supersedesCandidateId` already stores) needs a new read operation
under the `Recommendations` tag first — a backend/contract addition no current work package owns.
Until then, clients must not fabricate history from cached Today responses.

**Capacity and unit-cost numbers.** The k6 harness for all seven P8-LOAD-01 scenarios exists and
runs (`tests/load/`, documented in [load-testing.md](load-testing.md)), and its smoke scenario has
been executed against the live `verdery-dev` API. Every capacity number is still deferred, because
`verdery-dev` is not merely smaller than a production environment — it is differently shaped in the
exact dimensions a load test measures. `--max-instances=2` is reached before any interesting
saturation behaviour, so the result is the cap rather than the system; the shared-core `db-f1-micro`
dominates every latency measurement; `services/workers` is not deployed, so four of the seven
scenarios have no server-side counterpart; and there is no rate limiting, load balancer, or Cloud
Armor, so a saturation test would measure the absence of the controls P8-NET-01 exists to add.
Flips with a staging environment.

**Application rate limiting and the storage-quota ceiling.** There is no rate limiting anywhere:
`@fastify/rate-limit` is not a dependency, and the `429` machinery (`quota.rate_limited`,
`QuotaExceededError`) is a translation layer for inbound provider 429s with no producer of its own.
The per-user storage quota is the opposite shape — `media/domain/quota-reservation.ts` implements
reserve → commit/release completely and correctly, and compares the total to nothing, because no
numeric limit has ever been decided. Both are threat-model.md's `T-COST-01`/`-02`/`-03`/`-05`/`-10`,
and both are small application changes once the numbers exist. [service-levels.md](service-levels.md)
section 7 proposes them; approving that section is what flips this. The infrastructure half is
written and unapplied in `12-cloud-armor.sh`.

**Two list endpoints with no pagination.** `ListObservationsForGarden`, `ListObservationsForPlant`,
and `ListTasksForGarden` have no `limit` in the application layer, the transport layer, or the SQL —
a garden with 100,000 observations returns all of them in one response, against a service whose only
backpressure is a 1000 ms event-loop shed. Every other list endpoint is bounded at 100 by the
contract's shared `Limit` parameter. An entity ceiling is not a substitute: a 50,000-row response is
a denial of service against the client even when it is a legal one against the server. Flips with
the quota work above, and belongs with it.

**Pruning for `platform.sync_change` and `platform.idempotency_record`.** Both carry a 30-day
constant (`SYNC_CHANGES_RETENTION_MILLISECONDS`, `SYNC_PUSH_TTL_MILLISECONDS`) and both constants
gate a _client-facing_ decision — whether a cursor is still resumable, whether an operation id may be
replayed — not a row's lifetime. Nothing ever deletes from either table. This is a deliberate record
of an undecided question rather than a bug: it cannot be both a 30-day promise and permanent storage,
and the choice between adding a pruning sweep and accepting unbounded growth is
[service-levels.md](service-levels.md) section 8.1's, not a sweep's to make silently.
`platform.audit_event` sits in the same position with a different answer — nothing prunes it _by
design_, because an audit row must outlive its subject, but "forever" has never been approved as a
policy either.

**Support access as a mechanism.** No administrative role, impersonation, support session, or
time-limited elevation exists anywhere (threat-model.md `T-SUPPORT-01`), so the only way to answer a
support question about a user's data today is a direct, unaudited database session by whoever holds
the credentials. [support-operations.md](support-operations.md) section 6 specifies the buildable
half — a `support_session` record under the existing recent-auth gate, a non-extendable time box,
read-only scope through the `requireCapability` path every route already passes, and an audit row per
read using the `administrator` actor type `platform.audit_event`'s own CHECK constraint already
permits and nothing currently produces. It is deferred rather than built because P8-SUPPORT-01's
establishment half — an inbox, a rota, a person — is an owner gate, and a support-access mechanism
with nobody to use it would be an untested privileged path rather than a feature.
