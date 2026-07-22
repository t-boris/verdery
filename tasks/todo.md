# Phase 1 — Engineering Foundation, complete

Scope: every Phase 1 work package, including cloud infrastructure. Infrastructure is provisioned
with idempotent gcloud scripts instead of Terraform, per repository owner direction — see
[ADR-0011](../docs/architecture/decisions/ADR-0011-gcloud-scripts-instead-of-terraform.md).

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 10.

## Phase 0 decisions approved for this scope

| Decision                | Value                                                                          | Work package unblocked |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| Node.js runtime         | 24 LTS "Krypton"                                                               | P0-PLAT-01             |
| PostgreSQL / PostGIS    | 17 / 3.5 (3.5.2 explicitly, see ADR-0009 consequences)                         | P0-PLAT-01             |
| Apple deployment target | iOS/iPadOS 18.0, SDK iOS 26, Swift 6.3                                         | P0-CLIENT-01           |
| Browser baseline        | last 2 Chrome/Edge/Firefox, Safari 17+                                         | P0-CLIENT-01           |
| Local planar space      | PostGIS SRID 0 plus `coordinate_space_id`                                      | P0-MAP-01              |
| Coordinate precision    | round to 1 mm on write                                                         | P0-MAP-01              |
| Curve persistence       | polyline approximation plus retained control points, 10 mm max chord deviation | P0-MAP-01              |
| Geometry tolerances     | vertex 1 mm, polygon 0.01 m², line 0.05 m, coordinate limit 10 km, snap 12 px  | P0-MAP-01              |
| Infrastructure tooling  | idempotent gcloud scripts, not Terraform                                       | P0-PLAT-01             |
| Cloud SQL auth model    | Cloud SQL IAM database authentication, no passwords                            | P1-PLAT-02             |
| billing account         | `011376-3DA0B7-CA8AC5` ("Personal")                                            | P1-PLAT-02             |
| Environment scope       | `verdery-dev` only; staging/production deferred to near G8                     | P1-PLAT-02             |
| Dev resource lifecycle  | left running, not torn down after verification                                 | P1-PLAT-02             |

Recorded as [ADR-0009](../docs/architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md),
[ADR-0010](../docs/architecture/decisions/ADR-0010-local-coordinate-space-and-geometry-tolerances.md),
and [ADR-0011](../docs/architecture/decisions/ADR-0011-gcloud-scripts-instead-of-terraform.md).

## Tasks

### Foundation

- [x] ADR-0009 toolchain and platform version baseline
- [x] ADR-0010 local coordinate space and geometry tolerances
- [x] ADR-0011 gcloud scripts instead of Terraform
- [x] P1-REPO-01 monorepo directory structure
- [x] P1-REPO-02 workspaces, formatting, linting, type checking, file-size enforcement

### Contracts

- [x] P1-CONTRACT-01 OpenAPI `/v1` governance: error envelope, UUIDv7, timestamps, pagination, idempotency, revision headers
- [x] P1-CONTRACT-02 language-neutral geometry fixtures consumed by TypeScript and Swift

### Data

- [x] P1-DATA-01 reviewed SQL migration system, PostGIS extension, roles, migration tests — verified against real Cloud SQL, not only Testcontainers

### Runtime shells

- [x] P1-BE-01 Fastify composition root, config validation, health checks, typed errors, database adapter, module boundaries
- [x] P1-WEB-01 Next.js shell, localization, design-system foundation, error boundaries, typed API gateway
- [x] P1-IOS-01 SwiftUI composition, Core packages, feature template, localization, dependency rules

### Platform (this session)

- [x] P1-PLAT-01 gcloud provisioning scripts for project, network, Cloud SQL, IAM, Artifact Registry (`infrastructure/gcloud/scripts/`)
- [x] P1-PLAT-02 `verdery-dev` GCP project, network, private Cloud SQL, Cloud SQL IAM authentication
- [x] P1-PLAT-03 workload identity federation, Artifact Registry, keyless GitHub Actions deploy (`.github/workflows/deploy-dev.yml`)
- [x] P1-OBS-01 OpenTelemetry traces exported to Cloud Trace, verified against a live request

### Quality and documentation

- [x] P1-QA-01 CI gates: lint, typecheck, unit tests, migrations, OpenAPI, generated clients, secrets
- [x] P1-DOC-01 local setup, migrations, contracts, infrastructure, and deferred-capabilities documentation

## Deferred with reason

| Work package                            | Reason                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Staging / production environments       | Deferred to near G8 by repository-owner decision; same scripts, new config    |
| Terraform (`infrastructure/terraform/`) | Superseded by ADR-0011 for this phase; directory kept for a later phase       |
| Container image vulnerability scanning  | No registry existed before this session; scanning arrives with `P8` hardening |

## Review

Every Phase 1 work package, including cloud infrastructure, is implemented and verified against
real systems — not mocked, not assumed.

### Verified evidence

| Check                                                 | Result                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm check:all`                                      | passes: format, lint, typecheck, 600-line rule, 168 tests                                              |
| `swift build && swift test` (apps/ios)                | passes: 49 tests                                                                                       |
| `pnpm --filter @verdery/web build`                    | passes: production build, 3 routes                                                                     |
| Migration tests, Testcontainers                       | passes: 8 tests, including a least-privilege-role regression test                                      |
| Migration, real `verdery-dev` Cloud SQL, IAM identity | passes: `appliedCount: 0` on a database already migrated — correctly idempotent                        |
| `infrastructure/gcloud/scripts/verify.sh dev`         | passes: 10/10 checks against live infrastructure                                                       |
| Live request: `GET /v1/health/ready`                  | `200`, `{"status":"ready", ..., "dependencies":[{"name":"database","status":"available"}]}`            |
| Live trace in Cloud Trace                             | one trace, 3 spans: HTTP server → `pg-pool.connect` → `pg.connect`, `db.user` is the real IAM identity |

### Defects found and fixed during this session

1. **Curve densification exceeded its own tolerance** (found reviewing P1-CONTRACT-02). Adaptive
   de Casteljau subdivision with a convex-hull flatness test replaced an unfounded inverse-square
   step-count formula.
2. **The down migration could not run**, **migration tests passed only with Docker stopped**, **an
   idle database connection killed the process**, and **CI could never run and would have reported
   success anyway** — found reviewing P1-BE-01/DATA-01/QA-01, all fixed same session.
3. **`db-f1-micro` requires `--edition=ENTERPRISE` explicitly.** Cloud SQL now defaults new
   instances to Enterprise Plus, which rejects shared-core tiers.
4. **Cloud SQL's default PostGIS version is 3.6.0, not the pinned 3.5.** The migration now requests
   `VERSION '3.5.2'` explicitly rather than trusting the platform default — confirmed to have
   already drifted once between Cloud SQL and the local test image.
5. **Two IAM permissions are required for Cloud SQL IAM database auth, not one:**
   `roles/cloudsql.client` (Cloud SQL Admin API calls) and separately `roles/cloudsql.instanceUser`
   (`cloudsql.instances.login`, checked by Postgres itself at connection time). Missing either
   produces a different, equally opaque error.
6. **`node-pg-migrate`'s tracking table needs schema-level `CREATE`, which the migration's own
   `REVOKE CREATE ON SCHEMA public FROM PUBLIC` denies to every role but a superuser** — invisible
   to the test suite because it only ever connected as the Testcontainers superuser. Fixed with a
   narrow, documented `GRANT CREATE ON SCHEMA public TO verdery_migration` (not `PUBLIC`), and a new
   regression test that runs migrations as an ordinary least-privilege role.
7. **Cloud Run's freeze-between-requests model silently drops batched traces.** The default
   `BatchSpanProcessor`'s background flush timer never fires between requests once Cloud Run freezes
   the instance's event loop. Spans were created and logged but never reached Cloud Trace until
   `SimpleSpanProcessor` (synchronous, per-span export) replaced it.
8. **A multi-platform Docker build on Apple silicon produces an arm64 image Cloud Run rejects.**
   `docker buildx build --platform linux/amd64` is required explicitly.
9. **The workload identity binding keyed off the wrong `sub` format, and it took three attempts to
   find.** GitHub's actual OIDC `sub` claim for this repository is
   `repo:t-boris@508098/verdery@1308715947:environment:development` — it embeds immutable numeric
   owner and repository IDs the binding did not anticipate. Two earlier, plausible-looking fixes
   (removing `docker/setup-buildx-action`, minting a direct access token for `docker login`) were
   real improvements but did not touch the actual cause; only decoding a real token from a live run
   found it. The binding now targets `principalSet://.../attribute.environment/development` instead
   of an exact subject string, immune to that class of formatting difference. A fresh binding also
   does not take effect instantly — the first deploy after the fix still failed; the next succeeded.
10. **The Cloud SQL connector needs longer than 5 seconds on a cold Cloud Run revision.** Once
    authentication succeeded, the next deploy failed its startup probe: the readiness ping timed out
    fetching the connector's ephemeral certificate and negotiating mTLS within the default
    `DATABASE_CONNECTION_TIMEOUT_MS`. `deploy-api.sh` now sets 15000ms for the deployed environment.

**End-to-end proof:** after all ten fixes, the fully automated pipeline — push to `master` → CI →
keyless WIF authentication → build → push → migrate via Cloud Run Job → deploy → live health check
— completed successfully with no manual intervention, confirmed by a real GitHub Actions run
(`Deploy to development`, all steps green) and a live `200` from both health endpoints afterward.

### Known limitations

- Node 24 is required by ADR-0009; this machine runs 22.22.3, so every pnpm command prints an
  engine warning. Everything builds and tests regardless.
- `--allow-unauthenticated` on `verdery-api-dev` is a deliberate development-only choice — the
  service exposes nothing but health checks today. Revisit before any endpoint carries real data.
- The Postgres superuser break-glass password rotates on every `07-iam-database-bootstrap.sh` run
  and lives only in Secret Manager (`verdery-dev-pg-postgres-superuser-password`), labeled
  `used-by=none`. No scheduled rotation or incident procedure exists yet for using it.

# Phase 2 — Identity and First-Garden Vertical Slice, implementation complete

Scope: every Phase 2 work package, P2-DATA-01 through P2-QA-01. Firebase Authentication (Apple,
Google, and email magic link) as identity provider, PostgreSQL as the authoritative store for
permissions, gardens, and their lifecycle, delivered across the API, the authenticated Next.js web
shell, and the native iOS app.

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 11.

## Tasks

### Data and backend

- [x] P2-DATA-01 profiles, Firebase identity links, account state, gardens, memberships, roles,
      invitations skeleton, consent, audit, revisions, idempotency, sync-change, and outbox tables
- [x] P2-BE-01 identity-access and gardens-mapping modules with explicit
      domain/application/persistence/transport layers
- [x] P2-AUTH-01 Firebase ID token verification, actor context, idempotent profile provisioning,
      revocation and account-state handling
- [x] P2-AUTH-02 web sign-in exchange, HTTP-only Firebase session cookie, CSRF controls, logout,
      server-side session verification
- [x] P2-SEC-01 owner/editor/viewer capability evaluation; unauthorized resources are concealed,
      not just rejected
- [x] P2-API-01 garden list/create/get/rename/archive/delete-request, idempotency, revisions

### Clients

- [x] P2-WEB-01 authenticated Next.js shell, garden list/create/settings flows, TanStack Query
      ownership, accessible error handling
- [x] P2-IOS-01 per-profile GRDB store, authentication flow, garden list/create screens, local
      read model, sign-out cleanup
- [x] P2-AUTH-03 Apple, Google, and email magic-link sign-in implemented on both web and iOS.
      Firebase's Apple identity provider is configured with the repository owner's Team ID, Key ID,
      `.p8` key, and Services ID (`com.verdery.app.web`), via the Identity Toolkit Admin API. Not
      verified end to end on a real device — see Known limitations

### Observability and quality

- [x] P2-OBS-01 `platform/audit` and `platform/telemetry` are wired into profile provisioning and
      every garden lifecycle use case; integration tests now assert an audit row for every one of
      them (create, rename, archive, delete-request), not only create
- [x] P2-APPCHK-01 App Check monitor-only mode on the backend (Fastify plugin, never blocks, logs
      valid/missing/invalid classification), web (`ReCaptchaEnterpriseProvider`), and iOS
      (`AppAttestProvider` on device, `AppCheckDebugProviderFactory` in `DEBUG` builds). No
      dashboard view was built over the classification telemetry — see Known limitations
- [x] P2-QA-01 Playwright E2E suite (`apps/web/e2e/`) against a real stack — Postgres, the Firebase
      Auth emulator, the real API, and the real web app, not mocks: email-link register and create
      first garden, sign-in again and see it, sign-out with protected-route redirect, Google via
      the Auth emulator's fake IDP, and a provider-outage scenario. 5/5 passing, run independently
      three times to rule out flakiness. Does not run in CI yet — see Known limitations

## Deferred with reason

| Item                            | Reason                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Check dashboard             | Classification telemetry is logged; no dedicated view was built over it. Enforcement (rollout stage 3) stays disabled                                                               |
| E2E suite in CI                 | Needs Docker and the Firebase CLI on the runner and is noticeably slower than the existing gates — same cost/benefit reasoning already applied to the narrowly-filtered `swift` job |
| Native (iOS) end-to-end sign-in | This development machine cannot run the app on a simulator or device (CoreSimulator/Xcode version mismatch); `swift build`/`swift test` and code review are what stands behind it   |
| G2 dogfood approval             | A repository-owner decision, not an automatic consequence of implementation and test evidence — see Review below                                                                    |

## Review

Every Phase 2 work package is implemented and verified against real systems: a real local Postgres,
a real Firebase project (Apple/Google identity providers actually configured, not stubbed), a real
browser driving the real web app end to end, and Swift built and tested for iOS. Nothing here is
mocked at the boundary that matters. G2 approval itself is a decision for the repository owner to
record, not something this session claims on its own.

### Verified evidence

| Check                                                                     | Result                                                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                              | passes: all workspace packages, including the Next.js production build (7 routes)                                                                                                 |
| `pnpm check:all`                                                          | passes: format, lint, typecheck, 600-line rule, 244 tests across 6 workspace packages                                                                                             |
| `pnpm --filter @verdery/api-contracts lint:contract`                      | passes: OpenAPI document valid                                                                                                                                                    |
| `pnpm --filter @verdery/api-contracts generate:check`                     | passes: generated client matches the committed OpenAPI document                                                                                                                   |
| `swift build && swift test` (apps/ios)                                    | passes: 58 tests in 15 suites                                                                                                                                                     |
| `services/api` migration, integration, and App Check tests                | included in the 244: `tests/migrations/*.test.ts`, `tests/integration/gardens-mapping.test.ts`, `tests/http/garden-routes.test.ts`, `platform/app-check/app-check-plugin.test.ts` |
| `apps/web/e2e/run-e2e.sh` (real Postgres + Auth emulator + API + web app) | 5/5 Playwright scenarios pass, run independently three times                                                                                                                      |
| Firebase Apple identity provider, live config                             | `defaultSupportedIdpConfigs/apple.com`: `enabled: true`, `clientId: com.verdery.app.web`, Team ID and Key ID set, confirmed by a live `GET` after creation                        |
| CI on `master` (`f43eec4`)                                                | passes: all 6 gates, including the new `swift` job on a macOS 26 / Xcode 26.6 runner                                                                                              |
| `.github/workflows/deploy-dev.yml`, real run                              | passes end-to-end after the sequence-grant fix: build, push, migrate, deploy, live health check, no manual intervention                                                           |
| Live request: `GET /v1/health/ready` on `verdery-api-dev`                 | `200`, `{"status":"ready", ..., "dependencies":[{"name":"database","status":"available"}]}`, with `FIREBASE_PROJECT_ID` now set                                                   |

### Defects found and fixed during this session

1. **A bigint garden revision column round-tripped as a string, not a number.** `pg` returns
   PostgreSQL `bigint` as a JS string by default; the optimistic-concurrency `If-Match` comparison
   needs a number. Fixed with a global `pg.types.setTypeParser` registration
   (`platform/database/pg-bigint-parser.ts`) rather than a per-query cast, so every current and
   future bigint column is affected once, in one place.
2. **`deploy-api.sh` never set `FIREBASE_PROJECT_ID` for the deployed Cloud Run service.** Phase 2
   made it a required configuration variable (`loadConfiguration()` fails startup validation
   without it) for `deploy-migration-job.sh`, but the equivalent line was missing from
   `deploy-api.sh` — the next deploy would have crash-looped the API service on startup. Found and
   fixed before pushing, by the same pattern already applied to the migration job script.
3. **The live `verdery-dev` migration job failed on its first real Phase 2 run**: `permission denied
for sequence pgmigrations_id_seq`. `07-iam-database-bootstrap.sh` already granted
   `verdery_migration` row privileges on the pre-existing `pgmigrations` tracking table, but a
   sequence is its own relation with its own ACL — `GRANT INSERT` on a table never implies `USAGE`
   on the sequence backing one of its serial columns, so `node-pg-migrate`'s own bookkeeping insert
   (which runs after every successful migration file) failed. Fixed by adding
   `GRANT USAGE, SELECT ON public.pgmigrations_id_seq TO verdery_migration` to the same
   already-idempotent grant block, then re-running the bootstrap script against the live database
   (temporary public IP, superuser password rotation — both already-established, self-reverting
   behaviors of that script) and re-executing the migration job, which then succeeded. Confirmed by
   re-running the full `.github/workflows/deploy-dev.yml` pipeline from a clean state afterward: it
   built, migrated, deployed, and verified live health with no manual intervention.
4. **Every cross-origin `PATCH` (rename garden) and `DELETE` (sign-out) request from a real browser
   was silently rejected.** `@fastify/cors` defaults `methods` to `GET,HEAD,POST` when not given
   explicitly; the CORS registration in `app.ts` never set it. The preflight succeeded, but Chromium
   then refused the actual request. `app.inject()`-based HTTP tests never perform a real browser's
   CORS preflight, so all 111 of them stayed green while this was broken — only a real-browser E2E
   sign-out caught it. Fixed with one line (`methods: ['GET', 'POST', 'PATCH', 'DELETE']`),
   confirmed by reproducing the failure first, then rerunning the same request after the fix, then
   the full test suite. Reviewed and approved explicitly before being kept in this change set, since
   it goes beyond the E2E work package that found it.

### Known limitations

- App Check has no dashboard view over its classification telemetry; only structured logs exist.
  Enforcement (App Check rollout stage 3) is not enabled anywhere, by design.
- The E2E suite does not run in CI yet — it needs Docker and the Firebase CLI on the runner and is
  slower than the existing gates. It has only been run locally (by two different sessions/agents,
  independently, always 5/5).
- Whether `services/api`'s `firebase-admin` initialization works with zero Application Default
  Credentials provisioned (a from-scratch CI runner, as opposed to this development machine's own
  `gcloud auth application-default login` session) is unverified.
- Sign in with Apple is wired on both clients and Firebase's Apple provider is configured, but has
  not been exercised on a real device or simulator — see the next limitation. The web path is
  exercised only implicitly (E2E does not include an Apple scenario: Apple's own sign-in flow cannot
  be emulated the way Google's can).
- This machine runs Node 22.22.3 against a toolchain pinned to Node 24 (ADR-0009); CI's `swift` job
  is also the first time this session's iOS work was validated by a macOS runner matching the
  pinned Xcode 26.6 toolchain rather than this local machine's own Xcode installation.
- This development machine's CoreSimulator is version-mismatched with Xcode, so no change in
  `apps/ios` was verified on a simulator or device this session — only `swift build`/`swift test`
  and `xcodebuild -list`, per `apps/ios/README.md`, "Known environment gap". This includes App
  Attest and native Apple/Google sign-in, which are code-reviewed and unit-tested but not run.
