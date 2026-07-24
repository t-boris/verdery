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
`deploy-dev.yml` step builds or deploys the workers image yet either.

**Video/raw-capture deep validation (P6-WORKER-01 scope boundary).** Duration, codec, and frame-rate
validation (architecture/media-storage-and-processing.md section 10) needs `ffprobe`, a native binary
dependency not yet in this stack — the same class of dependency P6-WORKER-01 deliberately avoided for
images too (picking pure-JS `file-type`/`image-size` over a native decoder). A `raw_capture` manifest
is short-circuited to an accepted, clearly-labeled result before any byte is downloaded, preserving
exactly the declared-metadata-trusted level P6-API-01 already established. No video parser exists
anywhere in this codebase; a future stage builds one.

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

**Photo and file attachment in the Phase 4 web client.** `AddPlantFromPhoto`, `AttachPlantPhoto`,
`SetPrimaryPlantPhoto`, `ConfirmPlantIdentification`, and `AttachTaskFile` all need a real `media`
record. `P6-API-01` (media registration, authorized resumable upload session, completion
verification, status, and authorized short-lived access — `packages/api-contracts/openapi.yaml` tag
`Media`) has now landed, so a `mediaId` can be produced end to end against the real backend and real
Cloud Storage buckets. What remains is purely the web client's own wiring: each of the five gateway
methods (`plant-gateway.ts`, `task-gateway.ts`) is still implemented and unit-tested for contract
completeness only, and no `features/plants`/`features/tasks` hook or component calls the new `Media`
endpoints yet. `features/plants/plant-detail.tsx` still shows a plain notice explaining the gap
instead of a control that would only fail; `RecordObservation`'s photo support is still left off
`RecordObservationForm` the same way, though the contract already lets a note and/or a condition
summary stand on their own without a photo, so recording an observation itself is not blocked. This
resolves with `P6-WEB-01` (direct resumable upload, recoverable browser metadata where allowed,
progress, retry, and authorized previews).

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
  `Upload pending` (media transfer) also stays unmodeled — no media-upload flow exists anywhere in this
  codebase yet.
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
