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

**Photo and file attachment in the Phase 4 web client.** `AddPlantFromPhoto`, `AttachPlantPhoto`,
`SetPrimaryPlantPhoto`, `ConfirmPlantIdentification`, and `AttachTaskFile` all need a real `media`
record, and — the same gap `media.media_record`'s own module limits already document — this
codebase has no upload flow yet: nothing can produce a `mediaId` for these commands to use. Each of
the five gateway methods (`plant-gateway.ts`, `task-gateway.ts`) is implemented and unit-tested for
contract completeness, but no `features/plants`/`features/tasks` hook or component calls them.
`features/plants/plant-detail.tsx` shows a plain notice explaining the gap instead of a control that
would only fail; `RecordObservation`'s photo support is left off `RecordObservationForm` the same
way, though the contract already lets a note and/or a condition summary stand on their own without a
photo, so recording an observation itself is not blocked. This unblocks with `P6-API-01` (media
registration and upload).

**Photo-identification and photo-analysis ML services.** `plants-inventory`'s `identifyPlantFromPhoto`
and `observations-history`'s `analyzeObservationPhoto` are honest, clearly-labeled placeholders —
always "no suggestion, zero confidence" — not disguised guesses. `AddPlantFromPhoto` and
`RecordObservation` both treat the stub result as exactly that: `plant.taxonomyReferenceId` never
auto-confirms from a photo, and an observation's `suggestedLabel` never claims automated analysis
happened. Building a real service is out of scope for Phase 4 and has no owning work package yet.

**`GET /gardens/{gardenId}/plants` exists but no client calls it.** `P4-SEARCH-01` closed the
backend gap both clients' Phase 4 code had documented (no way to list a garden's plant inventory —
each fell back to create-then-navigate or open-by-id). Neither `apps/web/features/plants/queries.ts`
nor `apps/ios/Sources/FeaturePlants/PlantsHomeView.swift` was updated to call the new endpoint; both
still cite the now-stale "no list operation" rationale in their own comments. A real, if contained,
follow-up: build the list view against an endpoint that already exists and is already tested.

**A fresh environment's first deploy would hit the same class of failure `P4-SEARCH-01` hit for
`pg_trgm`, for `postgis`.** `1784710800000_platform-baseline.sql`'s `CREATE EXTENSION postgis`
needs real elevated privilege (not a Postgres "trusted" extension, unlike `pg_trgm` — confirmed by a
local, non-superuser reproduction while diagnosing the `pg_trgm` failure below), which the automated
deploy pipeline's least-privilege Cloud SQL IAM identity does not have and
`07-iam-database-bootstrap.sh`'s new `GRANT CREATE ON DATABASE ... TO verdery_migration` cannot grant
(that grant only covers trusted extensions). This is currently invisible on `verdery-dev` because
postgis is already installed there from Phase 1, so `CREATE EXTENSION IF NOT EXISTS postgis` is
already a no-op every time this migration re-runs. It would resurface on `verdery-staging` or
`verdery-prod`'s first-ever deploy. No work package owns this yet; the fix, when one of those
environments is actually provisioned, is a one-time privileged `CREATE EXTENSION postgis` run via
the same break-glass-superuser mechanism `07-iam-database-bootstrap.sh` already uses, before the
first automated migration run.

**P5-IOS-03's real `SyncEngine`, and everything downstream of it.** `P5-IOS-02` is now complete
(Stages 4a–4e): `FeatureGardens` (Stage 4a), `FeatureMap` (Stage 4b), `FeaturePlants` (Stage 4c),
`FeatureObservations` (Stage 4d), and `FeatureTasks` (Stage 4e) all route their offline-capable
commands through the local-transaction-plus-outbox pattern — `FeatureObservations`'s own version of it
simplified for `GardenObservation`'s append-only shape (`RecordObservation`/`CorrectObservation` append
a new local row directly, with no "current" record to load first, unlike the other four).
`CoreSynchronization.LocalOnlySyncEngine` remains the only `SyncEngine` implementation, so no outbox
operation any stage so far enqueues is ever actually pushed to the server yet; nothing in the UI claims
otherwise (`GardensListViewModel`/`GardenSettingsViewModel`/`MapEditorViewModel`/`PlantDetailViewModel`/
`ObservationsTimelineViewModel`/`TasksListViewModel` show "Saved locally, waiting to sync", never
"Synchronized"). Conflict recovery (`P5-CONFLICT-01`) and the rest of
architecture/ios-application-design.md section 8's status vocabulary (`Waiting for connectivity`/
`Synchronizing`/`Synchronized`/`Requires attention`/`Upload pending`) are unbuilt until a real engine
exists to report through.

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
