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
