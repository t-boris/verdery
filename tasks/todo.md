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

# Phase 3 — Canonical 2D Map and Manual Editors, implementation complete, G3 pending

Scope: every Phase 3 work package, P3-DATA-01 through P3-PERF-01. Users create and edit an
approximate, scaled, or georeferenced 2D garden on iPhone, iPad, and web. The two renderers consume
the same semantic geometry, commands, validations, provenance, measurements, and revisions.

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 12.

## Tasks

### Data and contracts

- [x] P3-DATA-01 coordinate spaces, optional georeference, garden objects, specialized detail
      tables, provenance, measurements, current revisions, immutable revision journal
- [x] P3-DATA-02 GiST spatial index, geometry validity constraints, viewport queries, semantic
      validation query ports
- [x] P3-CONTRACT-01 GeoJSON envelopes with coordinate-space metadata, 13 object categories,
      measurement uncertainty, and provenance — OpenAPI, TypeScript, and Swift agree, including an
      explicit discriminator `mapping:` fix so generated TypeScript types actually narrow on the
      real wire enum values instead of schema names
- [x] P3-MAP-01 the 13-command canonical editor model (create, move, replace geometry, edit vertex,
      split/join linework, change properties, assign plant, calibrate, decide proposal, delete,
      restore, duplicate) — language-neutral fixtures pass on TypeScript and Swift alike
- [x] P3-MAP-02 undo/redo as inverse or compensating commands (deterministic; split/join linework
      and calibration/proposal decisions are correctly non-invertible by design, not a gap — every
      editor surfaces this as "undo unavailable," never an error), gesture preview boundaries,
      snapping (existing vertices, edge projections, horizontal/vertical alignment, configurable
      angle increments, round measurement distances — advisory, temporarily disableable per
      gesture), constraint metadata free of Konva/Core Graphics/MapLibre/MapKit types

### Backend

- [x] P3-BE-01 map queries and the revision-aware `POST .../map/commands` endpoint: authorization,
      idempotency, validation, history, sync change, outbox event
- [x] P3-BE-02 lot, structure, fence/gate, path, bed/zone, tree, and plant placement behaviors —
      every creatable category's specialized detail table and constraints

### Clients

- [x] P3-WEB-01 Konva scene: viewport culling, selection, tool state, gesture preview, keyboard
      shortcuts, accessible object list, property panel. 12 of 13 categories creatable
      (`importedBackground` excepted — see Deferred with reason); vertex-level reshape,
      whole-shape resize/rotate, duplicate, dedicated plant assignment, and fence/path split/join
      all wired to real commands, not placeholder UI
- [x] P3-WEB-02 MapLibre provider adapter (OpenFreeMap — free, no API key, swappable by design),
      attribution, cache limits, local/geographic transform. **OpenFreeMap confirmed as the final
      provider choice by the repository owner (2026-07-23)**, not just a reversible default
- [x] P3-IOS-01 SwiftUI Canvas/Core Graphics scene: immutable render snapshots, selection, gestures,
      commands, properties, measurement overlays — the same category and command coverage as web
- [x] P3-IOS-02 optional MapKit context; canonical garden geometry stays provider-independent

### UX and quality

- [x] P3-UX-01 layer visibility/locking (4 user-toggleable layers over the 13 categories, enforced
      at every mutating entry point on both platforms), scale/accuracy presentation, a persistent
      saving/saved/save-failed indicator (explicitly not an offline queue — see Deferred with
      reason), a real warnings UI for `validationSummary` (tested against constructed data — see
      Deferred with reason for why it is empty against the live API today), and a persistent
      non-survey disclosure
- [x] P3-QA-01 small, ordinary, large, pathological, and accessibility map fixtures spanning all 13
      object categories (`packages/test-fixtures/fixtures/geometry/map-documents.json`), decoded
      independently by the web and iOS test suites and checked against the same expected
      projection, plus the existing 17-case cross-platform command-inverse fixture
- [x] P3-PERF-01 real instrumentation-free measurement against a live local stack at a "large"
      (66-object) scale — map open, command-commit round trip, and JS heap usage all measured
      directly, not estimated. A scored pass/fail against "Phase 0 budgets" is not yet possible —
      see Deferred with reason and Known limitations

## Deferred with reason

| Item                                                                                               | Reason                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upsertCalibration`/`decideProposal` client UI; `importedBackground` creation                      | Fully implemented at the domain/contract/backend layers, but neither app can produce the data these need: `upsertCalibration` needs an existing imported plan (Phase 6, "Media, Photos, and Property-Plan Import"), `decideProposal` needs a generated proposal (Phase 10, gated behind an explicit research decision the plan has not made). Building client UI for either now would have nothing real to operate on. |
| Cross-object validation (unexpected overlaps, a plant inside a blocked structure, a detached gate) | `services/api`'s `GetGardenMap` honestly returns `validationSummary: []` — real geometry/topology queries are out of scope for P3-BE-01/02, documented in place. P3-UX-01's warnings UI is fully built and verified against constructed fixtures; it becomes live with zero further client work once this separate backend effort lands.                                                                               |
| P3-PERF-01 scored against Phase 0 performance budgets                                              | P0-QA-01 ("Define measurable budgets for core latency, map interaction, sync convergence...") has not been completed — no numeric budgets exist to score against yet. This is a Phase 0 product/ops decision, not an engineering gap; see Review for what was measured instead.                                                                                                                                        |
| G3 approval                                                                                        | A repository-owner decision, not an automatic consequence of implementation and test evidence — see Review below                                                                                                                                                                                                                                                                                                       |

## Review

Every Phase 3 work package with a real producer today is implemented and verified against real
systems: real PostgreSQL/PostGIS (migrations and integration tests), a real running API/web/iOS
stack driven by a real browser through a real email magic-link sign-in, and Swift built and tested
for iOS. Nothing here is mocked at the boundary that matters. G3 approval itself is a decision for
the repository owner to record, not something this session claims on its own.

### Verified evidence

| Check                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check:all`                                                                    | passes: format, lint, typecheck, 600-line rule, 511 tests across 6 workspace packages                                                                                                                                                                                                                                                                                                                                                |
| `swift build && swift test` (apps/ios)                                              | passes: 266 tests in 38 suites                                                                                                                                                                                                                                                                                                                                                                                                       |
| CI on `master` (`5cc3bb3`)                                                          | passes: all gates, including the formatting and file-size gates that caught two real mistakes mid-session (see Defects below)                                                                                                                                                                                                                                                                                                        |
| Live manual verification: categoryDetails wire shape                                | real stack (Postgres, Firebase Auth emulator, API, web dev server); signed in via a real email magic-link flow, drew a `structure` polygon, edited its properties, and confirmed the raw API response and the database both carry the flat wire shape, not the nested domain shape                                                                                                                                                   |
| Live manual verification: P3-PERF-01                                                | real stack seeded with 66 objects (1 lot-scale polygon pair plus 64 plants, matching the "large" P3-QA-01 fixture scale) via direct SQL, driven by a real signed-in browser session — see performance findings below                                                                                                                                                                                                                 |
| Live performance measurements (this development machine, dev-mode build, localhost) | map open (API fetch, 66 objects): **~115 ms**. Full page load (unminified Next.js dev bundle — not representative of a production build): **~568 ms**. Command-commit round trip (a real `moveObject`): **~146–150 ms** success, **~77 ms** on a rejected command. JS heap with 66 objects rendered: **~47 MB used / ~56 MB total**. No visual corruption or unresponsiveness observed panning, selecting, or editing at this scale. |

### Defects found and fixed during this session

1. **`GardenObjectDetails` response serialization did not match the request-parsing wire shape.**
   `application/map-object-view.ts` serialized the nested domain shape (`{category, details: {...}}`)
   directly onto the wire instead of flattening it back to `{category, ...fields}`, the shape
   `openapi.yaml` declares and the request parser already required in the other direction. Found and
   fixed before the asymmetry could reach either client; confirmed by a live `GET` round trip against
   a real running server and the database.
2. **OpenAPI 3.1 discriminators without an explicit `mapping:` type a `oneOf` branch's discriminator
   property as the referenced schema's name, not the real wire enum value** — `openapi-typescript`'s
   generated types were unusable for real narrowing on `Geometry`, `GardenObjectDetails`, and
   `MapCommandPayload` until `mapping:` blocks were added to all three.
3. **A closed polygon ring's shared start/end vertex silently opens the ring if moved or removed
   through `editVertex` alone.** `services/api`'s `applyVertexOperation` touches exactly one stored
   array position per operation and never mirrors the ring's stored closing duplicate. The iOS
   vertex-edit work found this first (fixed by routing that one vertex's move through
   `replaceGeometry` with both copies updated, and disabling its removal in the UI); reviewing both
   platforms together during integration found the identical latent bug on web, which had no
   equivalent guard — fixed the same way, with matching new tests (`isRingClosureVertex`,
   `canRemoveVertexAt`, `movedRingClosureGeometry`).
4. **A pre-existing bug in `MapCanvasView`'s drag gesture**: `.onEnded` reset `dragObjectId` to `nil`
   _before_ reading it as `classifyDragEnd`'s `selectedObjectIdAtStart` argument, so a real
   object-drag gesture could never actually classify as a move — only view-model-level tests, which
   bypass the view, ever exercised the move path. Found and fixed by the P3-MAP-02 snapping work
   while restructuring that same gesture handler for vertex-drag snapping; confirmed by a new test
   asserting a real gesture commits exactly one `moveObject` command.
5. **`packages/test-fixtures`'s fixture loader broke the first time it was imported into a
   jsdom-environment Vitest project** (`apps/web`, for the new P3-QA-01 cross-platform fixture test).
   `fileURLToPath(new URL('../fixtures/', import.meta.url))` threw "The URL must be of scheme file":
   Vite's SSR module runner resolves a `new URL(relative, import.meta.url)` construction through its
   own dev-server virtual filesystem under jsdom, returning an `http://localhost/@fs/...` URL instead
   of a real `file:` one. `import.meta.url` read directly (no relative-URL construction against it)
   was unaffected in every environment tested. Fixed by resolving the fixture root via
   `dirname(fileURLToPath(import.meta.url))` instead — every existing Node-environment consumer
   (`geometry-contracts`, `services/api`) kept passing unchanged.
6. **A new Swift test file pushed `MapEditorViewModelTests.swift` to 609 lines**, one over this
   repository's 600-line file-size gate — caught by CI, not by either implementing agent's own local
   verification (`swift build`/`swift test` do not check line counts). Fixed by splitting the file
   along the same task-scoped lines its own `// MARK:` comments already used, matching this
   package's established `MapEditorViewModel*.swift` splitting convention.
7. **A generated JSON fixture and a hand-edited test file were not run through Prettier before
   committing**, caught by CI's formatting gate on the first push, not local verification. Fixed with
   `pnpm format`; both were pure whitespace changes, confirmed by re-running the full test suite
   afterward.

### Known limitations

- **P3-PERF-01 cannot be scored against numeric budgets that do not exist yet.** P0-QA-01 has not
  set them. Real measurements were taken instead (see Verified evidence) as an honest baseline, not
  a pass/fail scorecard — Metal-vs-Canvas and equivalent client-side performance decisions the
  architecture defers to "representative profiling" should use real budgets once P0-QA-01 sets them,
  not this baseline alone.
- The dev-mode page-load figure above (~568 ms) reflects an unminified, unbundled Next.js
  development server, not a production build (`next build && next start`) — re-measure against a
  production build before treating any number here as budget-relevant.
- No frame-rate (FPS) profiling was obtained. `requestAnimationFrame` sampling through the browser
  automation surface used for this session's live checks did not register frames reliably (likely a
  background-tab/focus artifact of that automation layer, not the application) — real frame-budget
  verification needs an interactive Chrome DevTools Performance recording or, on iOS, Xcode
  Instruments on real hardware or a matched simulator, neither available in this environment. This is
  the same class of gap as the pre-existing CoreSimulator/Xcode mismatch already documented for
  Phase 2.
- iOS device/simulator verification remains blocked by the same CoreSimulator/Xcode mismatch
  documented in Phase 2 and `apps/ios/README.md` — every Phase 3 iOS change was verified by
  `swift build`/`swift test` and code review only, never run on a simulator or device.
- The warnings UI (P3-UX-01) renders nothing against the real API today, by design — see Deferred
  with reason. Do not read an empty warnings panel during manual testing as evidence the feature is
  broken.
- Snapping's angle-increment (45°) and round-distance (0.5 m) constants, and the layer panel's exact
  category-to-layer assignment for `waterFeature`/`utilityExclusion` (not named explicitly in
  architecture doc section 12), are this session's reasonable defaults, not decisions recorded
  anywhere else — easy to change (each is a single named constant or a one-line mapping) if a
  designer wants different values.

# Phase 4 — Plants, Observations, History, and Manual Work, implementation complete, G4 pending

Scope: every Phase 4 work package, P4-DATA-01 through P4-QA-01. The garden becomes useful care data
rather than only a drawing: users manage plants and plant groups, record condition updates, see
chronological history, and create and complete manual work on both product surfaces.

Basemap provider question resolved by the repository owner: OpenFreeMap (see Phase 3's Deferred with
reason, now closed).

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 13.

## Tasks

### Data, contracts, and a new module

- [x] P4-DATA-01 plant instances, taxonomy references (system-catalog or user-defined), varieties,
      groups/rows with quantity, placements, orthogonal `lifecycleStage`/`status`, and a
      `plant_revision` journal mirroring `garden_object_revision`'s pattern exactly
- [x] P4-DATA-02 append-only observations — no revision column, no UPDATE path anywhere, corrections
      are new rows pointing backward via `corrects_observation_id`, never mutation — the single
      largest structural divergence from every other aggregate in this codebase
- [x] P4-DATA-03 manual tasks with a polymorphic `garden | garden_area | plant` target, gated status
      transitions (`requireEditableStatus`: only `planned`/`suggested` are editable-from), a
      `recurrenceRule` stored opaquely (never parsed or expanded — no expansion engine exists), and
      their own revision journal
- [x] A minimal, deliberately-scoped `media` module (`media.media_record`) stood up to unblock the
      three sibling modules above — not the full future Media module architecture section 6.6
      describes: no upload authorization, verification, derivatives, or retention state. A genuine
      architecture decision, made with the repository owner's explicit sign-off mid-session
- [x] P4-CONTRACT-01 named resource-shaped REST endpoints (not one command envelope, unlike Phase
      3's map) across `Plants`/`Observations`/`Tasks` OpenAPI tags — 24 operations, hand-written
      transport validation matching `gardens-mapping/transport/garden-routes.ts`'s established style

### Backend

- [x] P4-BE-01 `plants-inventory`: 9 commands (add, add-from-photo, attach/set-primary photo, update
      details, confirm identification, transition lifecycle stage, set status — the only "delete"
      mechanism — move) plus taxonomy search and (added this session) `SearchPlants`
- [x] P4-BE-02 `observations-history`: record, correct (append-only, backward-pointing), list for
      garden/plant, a narrow cross-module `PlantOwnershipRepository` read port (a genuine, documented
      judgment call, not a mirrored pattern)
- [x] P4-BE-03 `tasks-recommendations`: create, edit/reschedule (factored through
      `applyTaskDetailChanges`), complete/dismiss/skip/delete (factored through
      `transitionTaskToTerminalStatus`), list, attach-file — every status-changing command gated by
      `requireEditableStatus`
- [x] P4-SEARCH-01 `pg_trgm` trigram search: `SearchPlants` (garden-scoped, `lifecycleStage`/
      `status`/`groupingKind` filters, cursor pagination), `SearchTaxonomyReferences` upgraded from
      plain `ILIKE` to trigram similarity, a `nameQuery` filter added to `ListGardens` — closes the
      previously-documented "no plant list" gap on the backend (clients don't call it yet — see
      Deferred with reason)

### Clients

- [x] P4-WEB-01 web plant/observation/task management: gateways, TanStack Query hooks, forms and
      lists for every operation not blocked on file upload, English/Russian localization
- [x] P4-IOS-01 the same coverage natively: `FieldUpdate` for PATCH semantics (omitted/explicit-null/
      set), `GardenObservation`/`GardenTask` naming (avoiding a real collision with Swift's own
      `Observation` module and `@Observable` macro), the same always-fresh-from-server architecture
      as `FeatureMap` on both platforms (not GRDB's local-cache pattern), chosen because a stale
      cached revision would turn every `expectedRevision`-guarded command into a 409/412 lottery

### UX and quality

- [x] P4-DESIGN-01 validated all six required scenarios (unknown plant, incomplete data, group/row,
      dormant/dead/removed, correction, empty-history) against both clients' actual rendering code,
      not just type shapes — found and fixed three real, contained iOS-only gaps (see Defects below);
      web's own quantity-validation gap was independently found and fixed by the repository owner in
      the same window (`plant-details-form.tsx`'s `editPlantSchema` now gates on `groupingKind`)
- [x] P4-QA-01 assessed the existing 425-test backend suite against all six named concerns before
      writing anything new — filled two genuine gaps (a foreign-garden `plant` task target, and
      timezone-boundary round-trips for `acquisitionDate`/`dueDate`), added the one legitimate
      recurrence test (opaque round-trip, not expansion — no expansion engine exists to test),
      correctly left concurrent-edits/locale-units/cross-client-consistency untouched since each was
      already genuinely covered — 425 → 430 tests

## Deferred with reason

| Item                                                                | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-OBS-01 (privacy-safe product events)                             | Blocked on `P0-SEC-01`, still "Partially decided" — no consent model exists to build a consent-gated analytics event catalog against. No product-analytics/consent infrastructure exists anywhere in this codebase either (`platform/audit` is a compliance audit trail, `platform/telemetry` is operational tracing — neither is a consumer-analytics system). Building one with an invented consent model would be worse than not building it; this is a documented deferral, not an oversight. |
| `GET /gardens/{gardenId}/plants` client wiring                      | The backend gap is closed (P4-SEARCH-01), but neither `apps/web/features/plants/queries.ts` nor `apps/ios/Sources/FeaturePlants/PlantsHomeView.swift` was updated to call it — both still carry the now-stale "no list operation" comment from before this endpoint existed. Real, contained follow-up work against an already-tested endpoint, not a design gap.                                                                                                                                 |
| Photo-identification and photo-analysis ML services                 | `identifyPlantFromPhoto` and `analyzeObservationPhoto` are honest, clearly-labeled placeholders (always "no suggestion, zero confidence") — no real ML service exists for either. `AddPlantFromPhoto`/`RecordObservation` never treat the stub as a real signal. Building a real service is out of scope for Phase 4 and has no owning work package yet.                                                                                                                                          |
| Photo-attachment and file-attachment client UI                      | Same media-upload gap `docs/development/deferred-capabilities.md` documents for Phase 3/6: five gateway methods are implemented and tested at the contract layer, but nothing produces a real `mediaId` for them to use yet (`P6-API-01`).                                                                                                                                                                                                                                                        |
| `postgis` on a fresh (non-`verdery-dev`) environment's first deploy | Diagnosing the real `pg_trgm` deploy failure (see Defects below) found that `postgis` — not a Postgres "trusted" extension, unlike `pg_trgm` — needs real elevated privilege the least-privilege migration identity does not have and this session's fix does not grant. Currently latent because `verdery-dev` already has postgis installed from Phase 1; would resurface on `verdery-staging`/`verdery-prod`'s first deploy. No owning work package yet.                                       |
| G4 approval                                                         | A repository-owner decision, not an automatic consequence of implementation and test evidence — see Review below                                                                                                                                                                                                                                                                                                                                                                                  |

## Review

Every Phase 4 work package with a real producer today is implemented and verified against real
systems: real PostgreSQL (migrations and integration tests via Testcontainers), Swift built and
tested against CI's pinned toolchain, and — for the one defect that reached it — the real
`verdery-dev` Cloud SQL instance itself, not just a local approximation of it. P4-OBS-01 has no
producer this session by deliberate, documented choice, not a gap in verification. G4 approval itself
is a decision for the repository owner to record, not something this session claims on its own.

### Verified evidence

| Check                                                                                 | Result                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:all`                                                                      | passes: format, lint, typecheck (6/6 workspace projects), the 600-line file-size rule, 861 tests across 111 files in 6 workspace packages (`services/api` 430, `apps/web` 298, `geometry-contracts` 96, `test-fixtures` 18, `api-contracts` 15, `services/workers` 4) |
| `swift build && swift test` (apps/ios)                                                | local: `swift test --skip FeatureMapTests` passes (161 tests, 31 suites) — the pre-existing, CI-confirmed-benign `FeatureMapTests` SIGBUS flake (see Phase 3's Known limitations) is unrelated to any Phase 4 change                                                  |
| CI on `master` (`b51c1d1`, "Swift package" job)                                       | passes the full, unfiltered suite: **352 tests in 49 suites** — the authoritative signal, per the established "CI's pinned toolchain, not local repro" precedent                                                                                                      |
| CI on `master` (`b51c1d1`, all gates)                                                 | passes: secret scan, formatting/file-size, lint/types/tests, Swift package, all-gates summary                                                                                                                                                                         |
| Live deploy verification: `Deploy to development` (run `30000970389`)                 | real, full pipeline against `verdery-dev` — build, migrate, deploy, and a live-request check — all green end to end, including the migration this session's own defect fix unblocked                                                                                  |
| Live migration verification (Cloud Run job execution `verdery-api-dev-migrate-lqp6w`) | `1784950000000_search-indexes` applied for real against the real `verdery-dev` database — confirmed via Cloud Logging: `pg_trgm` installed, all four trigram GIN indexes created                                                                                      |

### Defects found and fixed during this session

1. **Neither client had a plants list.** `SearchPlants` (P4-SEARCH-01) closes the backend gap; both
   clients' own code comments had documented the absence, and both fell back to create-then-navigate
   or open-by-id. Client wiring itself is left open — see Deferred with reason.
2. **`pg_trgm` extension creation ordering.** `CREATE EXTENSION pg_trgm` after `SET ROLE
verdery_migration` fails: `ERROR: permission denied to create extension "pg_trgm" — Must have
CREATE privilege on current database`, since the least-privilege migration role only holds
   schema-level `CREATE`, never database-level. Fixed in the migration by moving extension creation
   before the role switch, mirroring how PostGIS is installed in the platform baseline — confirmed
   via a real failing-then-passing Testcontainers test run.
3. **The same `pg_trgm` failure reproduced against the real `verdery-dev` database**, even after fix
   #2 above: the migration's own comment claiming this ordering was "confirmed directly against a
   real Postgres 17 instance" was true for Testcontainers (which connects as an actual superuser) but
   not for the automated pipeline's real least-privilege Cloud SQL IAM identity — a gap Testcontainers
   structurally cannot catch. Confirmed via Cloud Logging on a real failed deploy. Root-caused (`pg_trgm`
   is a Postgres "trusted" extension — needs database-level `CREATE`, not superuser — confirmed with a
   local, non-superuser reproduction before touching live infrastructure) and fixed by extending
   `infrastructure/gcloud/scripts/07-iam-database-bootstrap.sh` with a targeted `GRANT CREATE ON
DATABASE ... TO verdery_migration`, applied for real against `verdery-dev` and verified by
   re-executing the previously-failed migration job (succeeded) and a full manual `Deploy to
development` run (green end to end). A mistake made while applying this fix — running the bootstrap
   script against the wrong service account (`verdery-dev-deployer`, the CI/CD caller identity, instead
   of `verdery-dev-api-runtime`, the identity that actually connects to Postgres) — granted
   `verdery-dev-deployer` an unnecessary Cloud SQL IAM database user and role membership; the core fix
   still worked (granted at the role level, inherited by the correct identity), but the mistake itself
   was found, reported, and cleaned up (the extra IAM user fully removed) in the same session, confirmed
   by listing the instance's users afterward.
4. **A latent, unrelated bug in the same infrastructure script**: an unescaped backtick pair around
   `` `id` `` in an existing SQL comment triggered real bash command substitution (the enclosing
   heredoc is unquoted) — silently replacing that comment's text with the local `id` command's output
   on every run. Cosmetic only (never reached the SQL Postgres actually executed), but a real bug,
   found and fixed while already editing this exact file.
5. **Three genuine iOS UX gaps**, found by P4-DESIGN-01's validation pass and fixed the same session:
   an existing plant's taxonomy identification was completely invisible outside the creation flow
   (`PlantDetailView` never read `taxonomyReferenceId`); the edit form's quantity field was not gated
   by `groupingKind`, unlike web and unlike iOS's own creation flow, so an individual plant's edit form
   let a user type a quantity the server would then reject; observation corrections never surfaced
   which observation they corrected (`correctsObservationId` existed on the model but nothing read it),
   unlike web. Verified via new tests plus a real CI run (352/49, including these).
6. **Two genuine backend test gaps**, found and filled by P4-QA-01: `tasks-recommendations` had no
   integration test rejecting a foreign-garden `plant` task target (only `garden_area` was covered,
   despite the enforcement code already covering both); `GetPlant`'s documented "wrong garden = 404,
   same as no such plant" security shape had zero test coverage (only "doesn't exist at all" was
   tested).
7. **A pre-existing fixture bug** in `plants-inventory-photos-identification.test.ts` — two rows
   sharing one low-entropy id suffix — found and fixed by the search agent as a side effect of
   unrelated work.

### Known limitations

- P4-OBS-01 has no implementation this session — see Deferred with reason. This is a deliberate,
  documented choice tied to `P0-SEC-01`, not an oversight.
- Neither client lists a garden's plant inventory yet, despite the backend now supporting it — see
  Deferred with reason.
- Photo-identification and photo-analysis are honest placeholders, not real ML services — see
  Deferred with reason.
- Photo-attachment and file-attachment commands exist at the gateway layer on both clients but have
  no UI — the same media-upload gap already documented for Phase 3/6.
- A fresh (non-`verdery-dev`) environment's first deploy would still fail installing `postgis` for
  the same class of reason `pg_trgm` did, unfixed by this session's grant (`postgis` is not a
  trusted extension) — currently invisible only because `verdery-dev` already has it installed.
- The local `swift test` SIGBUS flake (root-caused and CI-confirmed benign in Phase 3/4, see
  `apps/ios/README.md`) remains present and unrelated to any Phase 4 change; use
  `swift test --skip FeatureMapTests` locally, and trust CI's full-suite run as authoritative.
- `Task.recurrenceRule` is stored opaquely and never parsed, expanded, or validated — by design, not
  a gap this phase owns. No recurrence-expansion engine exists anywhere in this codebase yet.

# Phase 5 — Native Offline Synchronization and Web Continuity, planning

Scope: every Phase 5 work package, P5-DATA-01 through P5-QA-01. Native user changes survive
disconnection and process termination, synchronize idempotently, and expose recoverable conflicts.
Web stays online-first, preserves approved drafts, and shares authoritative revisions and conflict
semantics rather than building its own sync path.

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 14;
[architecture/offline-synchronization.md](../docs/architecture/offline-synchronization.md);
[architecture/ios-application-design.md](../docs/architecture/ios-application-design.md) sections
7-9, 21; [architecture/web-application-design.md](../docs/architecture/web-application-design.md)
section 9; [ADR-0004](../docs/architecture/decisions/ADR-0004-application-owned-offline-sync.md).

This is substantially larger than any prior phase — a real distributed-sync protocol (outbox,
idempotent push, incremental pull, conflict categories, tombstones, protocol versioning, revocation,
fault-injection testing), not a CRUD feature. Two research passes ran before any implementation to
ground the plan in what already exists, not assumption:

- **Backend**: `platform.sync_change` and `platform.outbox_event` are real Phase 2 skeleton tables,
  unused by any module until `gardens-mapping` added a first, incomplete, module-local
  `SyncChangeWriter`/`KyselySyncChangeWriter` — wired into most of its 12 map commands but not its 4
  Garden-lifecycle commands (`create-garden`, `rename-garden`, `archive-garden`,
  `request-garden-deletion`). The generic `platform/outbox/{outbox-appender.ts,
kysely-outbox-appender.ts}` port+adapter is the right model to mirror — module-local was the wrong
  call for something with zero module-specific typing. `record_revision` is straightforward for every
  aggregate with a real revision field (`Plant`, `Task`, `GardenObject`, `Garden`); `Observation` has
  no revision at all (append-only) and uses the same sentinel `1` every aggregate already uses at
  creation-time, since it's never touched again. `media.media_record` has no `garden_id` and, per
  architecture doc section 18 ("Record sync contains media IDs and state, not binary data"), does not
  need its own sync_change entries at all — media state travels inline in the _referencing_ Plant/
  Observation/Task record's own payload, not as a separate synced record type.
- **iOS**: `FeatureGardens`'s existing `GardenDatabase`/`LocalGardenStore`/`GardenRecord` GRDB setup
  is a write-through cache of server-confirmed state (its own doc comment says so explicitly) — 0% of
  outbox/cursor/conflict/checkpoint/backoff/connectivity-monitoring concepts exist anywhere in
  `apps/ios/Sources` today, confirmed by grep, not assumed. It must be replaced, not extended.
  `ios-application-design.md` section 4 already names the target destination —
  `Core/Persistence` and `Core/Synchronization` — as planned but not-yet-created Core targets, sibling
  to the existing `CoreNetworking`/`CoreDomain`/`CoreAuthentication`. `FeaturePlants`/
  `FeatureObservations`/`FeatureTasks`/`FeatureMap` currently have zero GRDB dependency; Phase 5 adds
  it for the first time. `GardenDatabase.open` keys its local database by Firebase UID; section 7 of
  the same doc specifies one database per signed-in _profile_ — a real mismatch to resolve, not a
  style nit. No retry/backoff/jitter exists anywhere in `CoreNetworking` today despite section 9
  already requiring it generally (not just for sync) — Phase 5's transport hardening should close
  this for all networking, not only the new sync engine.
- **Web**: section 9 of `web-application-design.md` explicitly defers full record synchronization in
  the browser — P5-WEB-01 is bounded to a stale/disconnected indicator plus schema-versioned
  recoverable local drafts for selected forms and map sessions, reusing server revisions and conflict
  rules rather than inventing a separate last-write-wins path. Substantially smaller than the native
  work.

## Planned stages (dependency-ordered, matching the work package table)

1. **Sync log foundation** (P5-DATA-01 continued, backend): promote `SyncChangeWriter` to
   `platform/sync/` mirroring `platform/outbox/`; finish wiring `gardens-mapping`'s 4 missing
   commands; wire `plants-inventory`, `observations-history`, `tasks-recommendations`; fix
   `record_type` naming convention across modules (currently an unenforced free-text column); decide
   and document the media-state-travels-inline approach concretely against `AttachPlantPhoto`/
   `AttachTaskFile`/observation photo commands.
2. **Sync API contracts and backend engine** (P5-API-01, P5-BE-01, P5-BE-02): versioned push/changes/
   acknowledge/snapshot/registration/upgrade-state endpoints; dependency-aware batch push processing
   with the six per-operation outcomes; deterministic incremental pull, initial snapshot, partition
   reset, full resync, revocation, mobile-version policy.
3. **iOS local foundation** (P5-IOS-01): new `CorePersistence`/`CoreSynchronization` targets — local
   read models, `sync_outbox`, `sync_cursor`, `sync_conflict`, `sync_operation_result`,
   `media_transfer`, `local_draft`; a real GRDB migrator continuing from (not destructively replacing)
   `FeatureGardens`'s existing single-table database; re-key local storage by profile ID.
4. **iOS mutation routing and engine** (P5-IOS-02, P5-IOS-03): route every existing offline-capable
   mutation (Garden, Map, Plant, Observation, Task — a retrofit across Phases 2-4's own iOS code, not
   only new code) through atomic local-projection-plus-outbox transactions; the bounded push/pull
   engine itself with backoff, checkpointing, and foreground/background/explicit-retry triggers.
5. **Conflict recovery and revocation** (P5-CONFLICT-01, P5-SEC-01): durable conflict UI/recovery
   flows; protected local partition removal and stale-push rejection after membership/account
   revocation.
6. **Web continuity** (P5-WEB-01): stale/disconnected states and recoverable drafts, bounded scope
   per the architecture doc.
7. **Observability** (P5-OBS-01): outbox age, push/pull rates, resync frequency, revocation cleanup,
   version distribution — no payloads.
8. **Cross-cutting QA** (P5-QA-01): the specific scenarios that don't fall out of ordinary per-stage
   testing — randomized convergence, clock skew, large bounded-memory backlog, schema upgrade with a
   pending outbox, process termination at every checkpoint. Ordinary unit/integration coverage is
   written alongside each stage above, matching every prior phase's pattern, not deferred to the end.

Each stage will be committed, pushed, and CI-confirmed-green independently, matching the pattern
established in Phases 3 and 4 — not one single end-of-phase commit.

## Stage 4a — P5-IOS-02 pilot: `FeatureGardens` offline mutation routing, implementation complete

Scope: the first slice of P5-IOS-02 only — `CreateGarden`/`RenameGarden`/`ArchiveGarden`/
`RequestGardenDeletion` retrofitted as the pilot the rest of Stage 4 (Map, Plants, Observations, Tasks)
copies. Not the rest of P5-IOS-02 (those four features are still online-first/gateway-backed and
untouched), not P5-IOS-03 (the real push/pull `SyncEngine` — `LocalOnlySyncEngine` remains the only
implementation, so nothing pushed by this stage ever actually reaches the server yet).

### What changed

- `FeatureGardens.GardensUseCases`'s four commands stop calling `GardenGateway` synchronously. Each now
  validates locally (name non-empty and ≤120 characters — the contract's own limit, already described
  by the previously-declared-but-unwired `gardens.name.required` catalogue string; garden-must-exist-
  locally for rename/archive/delete), builds the optimistic local projection, and enqueues a `gardens.*`
  outbox operation — all inside one GRDB transaction
  (`LocalGardenStore.commitOfflineMutation(gardenId:command:)`, new). `GardenGateway` itself is
  untouched and stays in use by `ListGardens`/`GetGarden`.
- Atomicity: `GRDBGardenStore.commitOfflineMutation` opens exactly one `dbQueue.write` block that loads
  the current row, runs the caller's validation/projection closure, saves the `garden` row, and inserts
  the `sync_outbox` row through a new shared helper
  (`CorePersistence.SyncOutboxTransactionWriter`, which `GRDBSyncOutboxStore.enqueue(_:)` itself now
  also calls) — one real SQLite transaction, not two independent writes, matching
  architecture/offline-synchronization.md section 6 exactly.
- `GRDBGardenStore.replaceAll(with:)`/`save(_:)` (and `InMemoryGardenStore`'s mirrors) now skip
  overwriting a garden that still has a pending `sync_outbox` operation. Without this, the very next
  online list refresh or `GetGarden` call would silently clobber an unsynced local mutation with the
  server's (necessarily stale) prior state — a necessary companion fix, not scope creep: the outbox
  pattern this stage builds does not actually hold "saved locally until the server accepts it" without it.
- UI: `GardenSummary`/`GardenSettingsSummary` gained `syncStatusLabel: String?`, shown as "Saved
  locally, waiting to sync" (`gardens.status.savedLocally`, en+ru) for a garden mutated locally this
  session. Deliberately session-scoped, not derived from a persisted outbox query — the full status
  vocabulary (`Synchronizing`/`Synchronized`/etc.) needs a real `SyncEngine` to report through, which is
  P5-IOS-03's job; this is the honestly-scoped "Saved locally" slice only.
- Outbox payload shape (`OutboxOperation.payload`, new `GardenSyncCommandPayload`/`GardenSyncCommand`
  types) mirrors `packages/api-contracts/openapi.yaml`'s `SyncGardenOperationPayload`/`SyncGardenCommand`
  field for field, including the exact discriminator strings (`gardens.create`, `gardens.rename`,
  `gardens.archive`, and — not the guessable `gardens.requestDeletion` — `gardens.delete_request`), so a
  later stage's real push call can decode it without another local migration.

### Tests

- [x] Termination-at-boundary fault test: forces a real `sync_outbox` primary-key violation on the
      second write inside `commitOfflineMutation`'s transaction and proves the first write (the garden
      projection) rolls back with it — real GRDB behavior, not a mock
      (`GardenOfflineMutationTests.outboxFailureRollsBackProjection`), plus the positive case that both
      writes are durably present together after a successful commit.
- [x] All four commands covered offline — no test configures a `GardenGateway` at all, so a passing
      suite is itself proof no network call happens — including local-only validation failures, and
      each outbox row's stored payload decoded against a contract-shaped mirror type.
- [x] `replaceAll`/`save` pending-preservation covered for both `GRDBGardenStore` (real database) and
      `InMemoryGardenStore` (fallback).
- 196 → 218 tests, 41 → 43 suites (`swift test --skip FeatureMapTests`, the pre-existing, root-caused,
  unrelated local flake).

### Judgment calls (for later stages to inherit or reconsider)

- A garden created offline gets local `revision = 0` — below the contract's `Revision` minimum of 1, so
  it can never be mistaken for a real server revision. `Garden.revision` stays a plain `Int` rather than
  `Int?` across the whole feature for this one local-only case.
- `OutboxOperation.profileId` reuses the same Firebase-UID-based identifier `LocalDatabase.open` already
  scopes the local database by. It is local bookkeeping only — the contract's `SyncOperation` has no
  profile field; the server fills it from the authenticated caller — so this does not create a
  wire-format mismatch, and avoids inventing a second identifier this client cannot fetch without a
  network call it does not yet make.
- `GardensListViewModel.load()`/`GardenSettingsViewModel.load()` now re-render from local storage after
  a network refresh (`listGardens.cached()` / an `isSavedLocally` guard) rather than the raw network
  response, so a pending mutation's optimistic state cannot be visually reverted by a stale server
  response arriving after it. A minimal, targeted view-model change, not a new status-tracking system.

Not done, deliberately: Map/Plants/Observations/Tasks retrofits (rest of P5-IOS-02), the real push/pull
engine and full status vocabulary (P5-IOS-03), conflict recovery UI (P5-CONFLICT-01).

## Stage 4b — P5-IOS-02 second slice: `FeatureMap` offline mutation routing, implementation complete

Scope: the second slice of P5-IOS-02 — every reachable map-object command (create, move, replace
geometry, edit vertex, split/join linework, change properties, assign plant, delete, restore,
duplicate) retrofitted through the same atomic local-projection-plus-outbox pattern Stage 4a
established for `FeatureGardens`. Not the rest of P5-IOS-02 (Plants/Observations/Tasks, still
online-first), not P5-IOS-03 (no real push/pull engine yet), not `upsertCalibration`/`decideProposal`
(still no real client UI producer — see "Deferred with reason").

### What's different about Map, confirmed against the real code before building anything

- Map already had one generic command dispatch (`CoreDomain.MapCommandPayload`, 13 cases) rather than
  Gardens' four separate command types, and that type is already fully `Codable`
  (`MapCommandCoding.swift`) and already mirrors `packages/api-contracts/openapi.yaml`'s own
  `MapCommandPayload` schema field-for-field — confirmed directly against the YAML, not assumed. So
  this stage needed no new 13-branch payload type the way Gardens needed a new `GardenSyncCommand`;
  only a thin wrapper (`GardenObjectSyncOperationPayload`) adding the contract's `recordType`/`gardenId`
  envelope around the existing type.
- `MapEditorViewModelEditing.swift`'s own prior doc comment said plainly: "this pass has no optimistic
  local mutation" — every command previously waited for the server's confirmed response before
  touching local state at all. The premise that Phase 3 had already built local command-application
  logic reusable for this stage was only partially true: gesture-preview geometry math already existed
  (`MapShapeTransform` resize/rotate, `MapVertexEditCommands.movingVertex`), but nothing computed what
  _applying_ `editVertex(.insert/.remove)`, `splitLinework`, `joinLinework`, or `assignPlant` produces
  without a round trip. This stage added that missing piece (`MapCommandProjection`), mirroring the
  backend's own geometry primitives and per-command handlers
  (`services/api/.../domain/geometry-edit.ts`, `services/api/.../application/*.ts`) exactly rather than
  inventing new semantics — including the corrected discovery that `splitLinework`/`joinLinework` each
  affect **three** objects (the soft-deleted source(s) plus the new piece(s)), not the two
  `CoreDomain.MapCommandResult`'s own pre-existing doc comment suggested.
- Judgment call on local durability mechanism: `FeatureMap` gained its own durable GRDB table
  (`garden_object`, via a new `CorePersistence.LocalDatabase+MapObjectMigration.swift` migration and a
  new `FeatureMap.GRDBMapStore`), the same table-per-feature shape Gardens used — not a thinner
  "replay the outbox to reconstruct state" mechanism. architecture/ios-application-design.md, section
  "11. Garden Map Feature" already specifies the target shape ("a read-only base document derived from
  SQLite"), and section "6. State Ownership" classifies map data as ordinary "durable garden and plant
  data" (SQLite-owned), not local-bookkeeping-only. A table-less design would also have made
  `commitOfflineMutation`'s multi-object case (`joinLinework` needs both source objects' current state
  in the same transaction) unworkable without re-deriving state by replaying every prior local command
  in order — real complexity with no corresponding benefit given the outbox's own row already exists
  for the durability the "just replay it" idea was trying to get for free.
- `FeatureMap` gained a `CorePersistence`/GRDB dependency in `Package.swift` it did not have before —
  the same shape `FeatureGardens` already has, and covered by `ArchitectureTests.DependencyRuleTests`
  (Feature → Core, never Feature → Feature).

### What changed

- `MapEditorViewModelEditing.submit`/`MapEditorViewModelUndoRedo.submitUndoRedo` stop calling
  `SubmitMapCommand`/`MapGateway` synchronously. Each now commits through
  `FeatureMap.ApplyMapCommandOffline` — one method for every reachable command type, matching the
  online `SubmitMapCommand`'s own already-generic shape, not one method per command the way Gardens'
  four separate commands needed. `SubmitMapCommand`/`MapGateway` are untouched and stay in use by
  `LoadGardenMap` and, unused for now, for a later stage's real push engine — exactly `GardenGateway`'s
  Stage 4a treatment.
- Atomicity: `GRDBMapStore.commitOfflineMutation` opens exactly one `dbQueue.write` block that loads
  every current `garden_object` row for the garden, runs the caller's validate-and-project closure
  (`MapCommandProjection.apply`, in `ApplyMapCommandOffline`), upserts every projected object, and
  inserts the `sync_outbox` row through the same shared `CorePersistence.SyncOutboxTransactionWriter`
  Stage 4a built — one real SQLite transaction covering N projection writes plus the outbox insert, not
  independent writes.
- `GRDBMapStore.replaceAll(gardenId:with:)` (and `InMemoryMapStore`'s mirror) skip overwriting an
  object with a pending outbox operation — the same "do not let a stale server response clobber an
  unsynced local mutation" guard Stage 4a added for Gardens, generalized: since a map command's
  affected object ids live inside `sync_outbox.targetRecordIds` (a JSON array, because
  `splitLinework`/`joinLinework` name more than one), not a scalar `gardenId` column match, the guard
  decodes that column instead of a single comparison. `LoadGardenMap` now persists every `GET .../map`
  response into this table via `replaceAll`, which the offline commit path depends on for a durable
  "current object state" to apply against — `MapEditorViewModel` itself stays always-fresh-from-server
  for reads (the reasoning in its own doc comment — exact revision needed for every command — still
  holds); the local table exists for durability, not to make loading feel instant.
- Outbox payload shape (`FeatureMap.GardenObjectSyncOperationPayload`) mirrors
  `packages/api-contracts/openapi.yaml`'s `SyncGardenObjectOperationPayload` field for field, including
  the exact discriminator string (`recordType: "gardenObject"`, not the guessable `"mapObject"`) — this
  stage's own version of Stage 4a's `gardens.delete_request` catch. `command` encodes through
  `CoreNetworking.MapCommandWireCoding` (made `public` for this — see judgment calls below), the same
  flat wire shape `SubmitMapCommand`'s live online request already uses, not `MapCommandPayload`'s own
  domain-shaped `Codable` conformance (which stays nested-`categoryDetails`-shaped for
  `InverseCommandTests`' fixture). `OutboxOperation.commandType` uses `"map.<type>"` (e.g.
  `"map.createObject"`), verified against the backend's own internal operation-naming convention in
  `services/api/.../application/*.ts` (`const OPERATION = 'map.createObject'`), not invented.
- UI: `MapSaveStatus` gained `.savedLocally`, shown as "Saved locally, waiting to sync"
  (`map.saveStatus.savedLocally`, en+ru) — the exact same copy Stage 4a used for Gardens. `.saved`
  (server-confirmed) stays declared but unused by any code path today, the same "left in place for a
  later stage" treatment `SubmitMapCommand`/`MapGateway` get, rather than removed or repurposed to mean
  something weaker than its name claims.

### Tests

- [x] Termination-at-boundary fault test: forces a real `sync_outbox` primary-key violation on the
      second write inside `commitOfflineMutation`'s transaction and proves every projection write rolls
      back with it, including the multi-object case
      (`MapOfflineMutationTests.outboxFailureRollsBackProjections`), plus the positive case that every
      write is durably present together after a successful commit.
- [x] Offline coverage via `ApplyMapCommandOffline` (`MapUseCasesOfflineTests`) for create, move,
      delete, and split specifically (this stage's own minimum bar, since split/join carry real
      structural complexity), plus join and a local-validation failure — none of these tests configure
      a `MapGateway` at all, so a passing suite is itself proof no network call happens. Each outbox
      row's stored payload is decoded as loose JSON and checked against the contract's field names,
      including the flat (not nested) `categoryDetails` shape for `createObject`.
- [x] `replaceAll` pending-preservation covered for the multi-target-per-operation case specifically
      (a pending `splitLinework`/`joinLinework`-shaped operation must protect exactly the object ids it
      names, not the whole garden), not only the single-target case Gardens' equivalent test covers.
- [x] Every pre-existing `FeatureMapTests` assertion that depended on the now-removed online round trip
      (gateway-mediated stale-revision rejection, `gateway.submittedCommands` inspection) was rewritten
      to test the actual new behavior, not deleted outright — see "Judgment calls" below.
- 218 tests, 43 suites unaffected (`swift test --skip FeatureMapTests`); `FeatureMapTests` itself
  191 → 206 tests, 18 → 20 suites (`swift test --filter FeatureMapTests`), run clean twice with no
  SIGBUS flake encountered.

### Judgment calls (for later stages to inherit or reconsider)

- `CoreNetworking.MapCommandWireCoding` (previously module-internal, encode-only) was made `public` so
  `FeatureMap.GardenObjectSyncOperationPayload` could reuse its exact ~150-line wire-shaping switch
  instead of duplicating it a second time. Judged the better call than the duplication, since a future
  drift between two independently-maintained copies of the same encoding would be a real correctness
  risk (the outbox payload must match the wire exactly for a future push engine to forward it
  unmodified); flagging here since it widens a Core module's public surface, which this repo's
  CLAUDE.md asks to be called out explicitly rather than done silently.
- A map object created or cloned offline gets local `revision = 0` — the exact same sentinel and
  reasoning as Stage 4a's `unconfirmedGardenRevision`. A locally-applied command never bumps `revision`
  for an _existing_ object either (stays exactly `current.revision`): the next command chained locally
  against the same object must still quote the last server-confirmed revision as its own
  `expectedRevision`, since that is what the server still has until a real push engine confirms this
  one — bumping it locally would make every subsequent locally-queued command against that object
  guaranteed to conflict once actually pushed. This was not a concern Stage 4a had to reason about
  explicitly (Gardens has no `expectedRevision`-bearing command chained against the same record within
  one offline session in the same way), so it is called out here for later stages to inherit.
- `OutboxOperation.expectedRevision` (a single optional `Int`, local bookkeeping only — never repeated
  on the wire for `gardenObject` operations, which carry their revision(s) inside `payload` itself) has
  no single correct value for `joinLinework`, which carries two (`firstExpectedRevision`/
  `secondExpectedRevision`). Chose the first object's, documented in `MapCommandProjection
.primaryExpectedRevision(for:)` as a deliberate simplification of a purely observational field, not a
  wire-format decision.
- Existing `FeatureMapTests` assertions built around the pre-Stage-4b online round trip (a "stale
  revision" test relying on `FakeMapGateway` rejecting a conflicting command, several
  `gateway.submittedCommands` inspections) were rewritten rather than deleted: the stale-revision test
  became a local-commit-failure test (a `LocalMapStore` that always throws), since a stale server
  revision can no longer be what causes `submit` to fail from this call path at all — that discovery is
  now the server's job once a real push engine exists (P5-CONFLICT-01), not this transaction's, exactly
  mirroring the local-only-validation stance Stage 4a already took for Gardens' four commands.

Not done, deliberately: Plants/Observations/Tasks retrofits (rest of P5-IOS-02), the real push/pull
engine and full status vocabulary (P5-IOS-03), conflict recovery UI (P5-CONFLICT-01),
`upsertCalibration`/`decideProposal` offline support (still no real client UI producer — see "Deferred
with reason": `upsertCalibration` needs an imported plan, Phase 6; `decideProposal` needs a generated
proposal, Phase 10 — confirmed by grep that neither command is referenced anywhere in `FeatureMap`
outside its own domain/coding types).

## Stage 4c — P5-IOS-02 third slice: `FeaturePlants` offline mutation routing, implementation complete

Scope: the third slice of P5-IOS-02 — the five reachable plant commands (`AddPlant`,
`UpdatePlantDetails`, `TransitionPlantLifecycleStage`, `SetPlantStatus`, `MovePlant`) retrofitted
through the same atomic local-projection-plus-outbox pattern Stage 4a established and Stage 4b
generalized. Not the rest of P5-IOS-02 (Observations/Tasks, still online-first), not P5-IOS-03 (no real
push/pull engine yet), not the four media-dependent plant commands (`AddPlantFromPhoto`,
`AttachPlantPhoto`, `SetPrimaryPlantPhoto`, `ConfirmPlantIdentification` — see below for why four, not
the three the work-package brief named).

### What's different about Plants, confirmed against the real code before building anything

- `FeaturePlants` had zero local persistence before this stage — `PlantDetailViewModel`/
  `PlantsHomeViewModel` always called `PlantGateway` directly, an explicit Phase 4 choice (`Package.swift`'s
  own doc comment on the `FeaturePlants` target: a stale cached revision would turn every
  `expectedRevision`-guarded command into a `409`/`412` coin flip). This stage does not undo that
  choice for reads — `GetPlant`/`SearchTaxonomyReferences` stay online, gateway-backed, exactly the way
  `ListGardens`/`GetGarden` stayed online after Stage 4a and `LoadGardenMap` stayed online after
  Stage 4b. It adds a new `plant` GRDB table (`PlantRecord`/`LocalPlantStore`/`GRDBPlantStore`/
  `InMemoryPlantStore`, mirroring `GardenRecord`'s pattern, one row per plant like Gardens rather than
  Map's "N rows per garden") solely so the five offline commands have a durable "current record" to
  load, validate against, and project forward.
- **Local table field set: the plant's full field set, not a narrower projection** — decided, not
  assumed. Every offline command except `AddPlant` (whose `current` is always `nil`) must return a
  complete, correct `Plant` the view model renders directly with no network re-fetch to patch over a
  gap; `UpdatePlantDetails` changes only a handful of fields while every other field, including ones no
  other part of this table's own logic touches (`careGuidanceNote`, `acceptedIdentificationId`, ...),
  must still come out exactly as it was. A local row missing any field could not build a correct
  projection for whichever command does not touch that field, so the _minimal correct_ set turns out to
  equal `Plant`'s full set — the same reasoning `GardenRecord` already documents, not a new judgment
  call specific to Plants. `revision` is carried, confirmed present, and is the one field every
  non-create command's `guard let current` check depends on existing at all.
- **The five `plants.*` discriminator strings and payload shapes, verified directly against
  `packages/api-contracts/openapi.yaml`, not guessed** (`SyncPlantCommand`'s discriminator `mapping`,
  lines ~4259-4281, and each command's own schema): `plants.addPlant`
  (`SyncAddPlantCommand` — `plantId` + `AddPlantRequest`), `plants.updateDetails` — not the guessable
  `plants.updatePlantDetails` — (`SyncUpdatePlantDetailsCommand` — `plantId` + `expectedRevision` +
  `UpdatePlantDetailsRequest`), `plants.transitionLifecycleStage` (`SyncTransitionPlantLifecycleStageCommand`
  — `plantId` + `expectedRevision` + `TransitionPlantLifecycleStageRequest { stage }`),
  `plants.setStatus` (`SyncSetPlantStatusCommand` — `plantId` + `expectedRevision` +
  `SetPlantStatusRequest { status }`), `plants.movePlant` (`SyncMovePlantCommand` — `plantId` +
  `expectedRevision` + `MovePlantRequest`). The whole family wraps in `SyncPlantOperationPayload`
  (`recordType: "plant"`, `gardenId`, `command`) — the contract's own `plant`, not a guessable
  `plants`/`plantRecord`. Feature-local wire structs (`AddPlantRequestPayload`,
  `UpdatePlantDetailsRequestPayload`, `MovePlantRequestPayload`, `PlantSyncCommand`) mirror these
  field-for-field rather than reusing `CoreNetworking`'s own (module-internal) transport structs —
  judged the better call than Stage 4b's `MapCommandWireCoding` reuse, since these request bodies are
  small flat structs with no ~150-line encoding switch worth not duplicating.
- **Confirmed by grep, not assumed: FOUR plant commands are unreachable from any shipped UI today,
  not the three the work package brief named.** `AddPlantFromPhoto`, `AttachPlantPhoto`, and
  `SetPrimaryPlantPhoto` all need a `mediaId`, which — per `docs/development/deferred-capabilities.md`'s
  "Photo and file attachment" entry — this codebase has no upload flow to produce anywhere yet.
  `ConfirmPlantIdentification` was expected, going in, to be reachable (it takes an
  `identificationId`, not a `mediaId`) — but `grep -rn "ConfirmPlantIdentification\|identificationId"
apps/ios/Sources/` turned up nothing outside `PlantGateway.swift` itself, and
  `PlantsUseCases.swift`'s own pre-existing doc comment already groups all four together: an
  `identificationId` only ever comes from a prior `plant_identification` suggestion, which only
  photo-based identification (`AddPlantFromPhoto`) produces — there is no separate, non-photo path to
  one, so `ConfirmPlantIdentification` is transitively blocked by the exact same missing media pipeline,
  confirmed by `docs/development/deferred-capabilities.md`'s own "Photo and file attachment" entry
  listing all five gap-affected commands (`AddPlantFromPhoto`, `AttachPlantPhoto`,
  `SetPrimaryPlantPhoto`, `ConfirmPlantIdentification`, `AttachTaskFile`) together already. None of the
  four gained a use case here, matching Stage 4b's identical treatment of
  `upsertCalibration`/`decideProposal`.
- **The taxonomy-search reasoning held, with no change needed.** `AddPlant`/`UpdatePlantDetails` carry
  whatever `taxonomyReferenceId` the user already picked via `TaxonomyReferencePickerView`
  (`SearchTaxonomyReferences`, still online) while the device is online — an offline-mode payload field
  carrying an already-decided value, the same way every other field does. No new offline taxonomy
  search was needed or built.

### What changed

- `PlantsUseCases.swift`'s `AddPlant`/`UpdatePlantDetails`/`TransitionPlantLifecycleStage`/
  `SetPlantStatus`/`MovePlant` stop calling `PlantGateway` synchronously. Each now validates locally
  (display name non-empty and ≤200 characters — the contract's own limit, previously enforced only up
  to "non-empty" by `AddPlantFormValidation`; plant-must-exist-locally for the four non-create
  commands), builds the optimistic local projection, and enqueues a `plants.*` outbox operation — all
  inside one GRDB transaction (`LocalPlantStore.commitOfflineMutation(plantId:command:)`, new, mirroring
  `LocalGardenStore`'s single-record shape). `GetPlant` gained a `localStore: any LocalPlantStore`
  dependency and now writes through to it (`localStore.save(_:)`) after every successful online fetch —
  the mechanism that gives an _existing_ plant a local row for the four non-create commands to load,
  mirroring `GetGarden`'s identical Stage 4a addition. `PlantGateway` itself is untouched and stays in
  use by `GetPlant`/`SearchTaxonomyReferences`.
- Atomicity: `GRDBPlantStore.commitOfflineMutation` opens exactly one `dbQueue.write` block that loads
  the current `plant` row, runs the caller's validate-and-project closure, saves the row, and inserts
  the `sync_outbox` row through the same shared `CorePersistence.SyncOutboxTransactionWriter` Stage 4a
  built. `GRDBPlantStore.save(_:)` (and `InMemoryPlantStore`'s mirror) skip overwriting a plant with a
  pending outbox operation — the same "do not let a stale server response clobber an unsynced local
  mutation" guard Stage 4a/4b added, decoding `sync_outbox.targetRecordIds` (a plant's own id, not
  `gardenId`, the _owning_ garden shared by every plant in it) the same way `GRDBMapStore` does for
  `garden_object`, not Gardens' simpler scalar `gardenId` comparison.
- **A necessary companion fix `PlantDetailViewModel.load()` needed that neither Gardens nor Map's own
  UI shape required**: `PlantsHomeViewModel.performAdd()` navigates straight to the newly (now
  offline-only) created plant's detail screen, and `PlantDetailViewModel.load()` was a hard
  network-first `getPlant` call — which would simply fail (no server copy exists yet) for exactly the
  plant the user just added while offline, making it impossible to view or edit. Fixed by giving
  `GetPlant` a `cached(plantId:)` method (`localStore.fetch(plantId:)`, the single-plant counterpart to
  `ListGardens.cached()`) and having `load()` try it first, then the network fetch — the identical
  cache-first-then-refresh shape `GardenSettingsViewModel.load()` already uses, including its
  `isSavedLocally` guard against a stale network response reverting a pending local edit. Called out
  explicitly here per this repo's CLAUDE.md, since it is new reasoning this stage had to work out for
  itself, not a straight copy of Stage 4a/4b's precedent.
- UI: `PlantDetailSummary` gained `syncStatusLabel: String?`, shown as "Saved locally, waiting to sync"
  (`plants.status.savedLocally`, en+ru) — the exact same copy Stage 4a/4b used. Session-scoped exactly
  like `GardenSettingsViewModel.isSavedLocally`: set only by an offline command this `PlantDetailViewModel`
  instance itself commits (`saveDetails`/`transitionLifecycleStage`/`setStatus`/`submitMove`), so a
  plant just created via `PlantsHomeViewModel` and navigated to shows its correct locally-projected data
  immediately (via the cache-first `load()` above) but not the "Saved locally" label itself until the
  user makes an edit on the detail screen — an honest, minor UX gap inherited from Plants' create-then-
  navigate flow crossing a view-model boundary Gardens'/Map's own UI shapes never had to cross, not
  fixed to keep this stage matching Stage 4a/4b's own "session-scoped, not derived from a persisted
  outbox query" precedent exactly rather than building something more capable than either of them.

### Tests

- [x] Termination-at-boundary fault test: forces a real `sync_outbox` primary-key violation on the
      second write inside `commitOfflineMutation`'s transaction and proves the projection write rolls
      back with it — real GRDB behavior, not a mock
      (`PlantOfflineMutationTests.outboxFailureRollsBackProjection`), plus the positive case that both
      writes are durably present together after a successful commit.
- [x] All five commands covered offline (`PlantsUseCasesOfflineTests`) — no test configures a
      `PlantGateway` at all, so a passing suite is itself proof no network call happens — including
      local-only validation failures (`invalidDisplayName`, `localRecordNotFound`) and each outbox
      row's stored payload decoded as loose JSON and checked against the contract's field names,
      including the `.set(nil)`-encodes-explicit-`null`-not-omission distinction for `UpdatePlantDetails`.
- [x] `save` pending-preservation covered for both `GRDBPlantStore` (real database, including that it is
      scoped per-plant via `targetRecordIds`, not the whole owning garden) and `InMemoryPlantStore`.
- [x] View-model-level coverage (`PlantDetailViewModelTests`, `PlantDetailViewModelSyncStatusTests`,
      `PlantsHomeViewModelTests`) rewritten, not just extended, for the tests that depended on the
      now-removed online round trip: the pre-existing "stale revision surfaces an action error" test
      (which relied on a `FakePlantGateway` 409) became a local-commit-failure test (a `LocalPlantStore`
      that always throws), mirroring Stage 4b's identical rewrite for the exact same reason; two
      `revision == 2`-after-edit assertions (the old proxy for "did the mutation apply") were replaced
      with the revision-stays-unchanged assertion the new local-only-projection rule actually produces,
      or with a `syncStatusLabel != nil` check where no other observable field existed. New coverage
      added: a plant created offline and never touching the gateway (`FakePlantGateway.getPlant`
      confirmed to 404 for it), and the local-store-only-row `load()` scenario described above.
- 454 tests, 67 suites (`swift test`, full and unfiltered, run clean twice with no SIGBUS flake
  encountered); 248 tests, 47 suites with `--skip FeatureMapTests`. `FeaturePlantsTests` itself:
  62 tests across 7 suites (4 new: `PlantOfflineMutationTests`, `PlantsUseCasesOfflineTests`,
  `InMemoryPlantStoreTests`, `PlantDetailViewModelSyncStatusTests`).

### Judgment calls (for later stages to inherit or reconsider)

- A plant created offline gets local `revision = 0` and, for every other command, the projection keeps
  exactly `current.revision` — the identical `unconfirmedGardenRevision`/Map `revision: 0` sentinel and
  "never advance locally" rule, restated here rather than reused as a shared constant across features
  (each feature's own private `unconfirmedFooRevision` constant, matching how Stage 4a's and Stage 4b's
  own versions are each feature-private too — not consolidated into `CoreDomain`, since nothing else
  needs them to be shared and this pilot-through-Stage-4c series has consistently kept each feature's
  offline-commit code self-contained).
- `plants.updateDetails`, not the more obviously-guessable `plants.updatePlantDetails` — this stage's
  own version of Stage 4a's `gardens.delete_request` catch and Stage 4b's `recordType: "gardenObject"`
  catch. Every one of the nine `plants.*` `commandType` strings in the contract was read directly from
  `openapi.yaml` before being typed into `PlantSyncCommandPayload.swift`, not inferred from the REST
  operation names.
- `MigrationIntegrityTests.allTables` was not extended to include `plant` — mirrors Stage 4b's own
  choice to leave `garden_object` off that same list (confirmed neither table was ever added there).
  The test still passes either way (it only checks membership among the tables it names, not exhaustive
  equality against every table that exists), so this is a pre-existing gap in that test's own
  exhaustiveness this stage chose to leave exactly as Stage 4b left it, not a new gap introduced here.

Not done, deliberately: Observations/Tasks retrofits (rest of P5-IOS-02), the real push/pull engine and
full status vocabulary (P5-IOS-03), conflict recovery UI (P5-CONFLICT-01), offline support for
`AddPlantFromPhoto`/`AttachPlantPhoto`/`SetPrimaryPlantPhoto`/`ConfirmPlantIdentification` (all four
confirmed unreachable from any shipped UI — see above).

## Stage 4d — P5-IOS-02 fourth slice: `FeatureObservations` offline mutation routing, implementation complete

Scope: the fourth slice of P5-IOS-02 — the two observation commands (`RecordObservation`,
`CorrectObservation`) retrofitted through the atomic local-projection-plus-outbox pattern Stage 4a
established, Stage 4b generalized, and Stage 4c reused — deliberately NOT a mechanical copy of any of
the three, since `GardenObservation` is structurally the odd one out among every aggregate this codebase
synchronizes (see below). Not `FeatureTasks` (the last remaining P5-IOS-02 stage), not P5-IOS-03 (no real
push/pull engine yet), not conflict recovery UI (P5-CONFLICT-01), not any backend change.

### What's different about Observations, confirmed against the real code before building anything

- **Append-only by explicit domain design — the single largest structural divergence from Gardens/Map/
  Plants.** `observation` has no revision column and no UPDATE path at all
  (`observations-history/domain/observation.ts`'s own header comment): `RecordObservation` is a pure
  insert with nothing to conflict with, and `CorrectObservation`
  (`observations-history/application/correct-observation.ts`) inserts an entirely NEW row
  (`createCorrectionObservation`) rather than loading-and-mutating the one it corrects — confirmed by
  reading `record-observation.ts`/`correct-observation.ts`/`domain/observation.ts` directly, not assumed
  from the work package brief. `services/api/src/platform/sync/sync-record-type.ts`'s own
  `recordRevision: 1` at both call sites is a genuine constant (the aggregate's first-and-only revision),
  never a placeholder for something that later changes — matching this stage's brief exactly.
- **Neither command carries `expectedRevision` at all**, confirmed directly against
  `packages/api-contracts/openapi.yaml`: `SyncRecordObservationCommand`/`SyncCorrectObservationCommand`
  (lines ~4283-4319) have no such property, and `RecordObservationRequest`/`CorrectObservationRequest`
  have none either — not merely "always nil" the way `AddPlant.expectedRevision` chooses to be, but
  structurally absent from the schema, matching the domain reality that an observation is never updated
  in place.
- **`CorrectObservation` has two distinct ids, not one**: `correctedObservationId` (the existing row being
  corrected) and `observationId` (the new, client-generated correction row's own id) —
  `SyncCorrectObservationCommand`'s own description states this explicitly. The wire request body
  (`CorrectObservationRequest`) carries neither `plantId` nor `gardenObjectId`: the server derives both
  from `correctedObservationId` (`createCorrectionObservation` copies `original.plantId`/
  `original.gardenObjectId`), so this client's own local projection copies the same association from
  whatever the caller already has, not from a wire field that does not exist.
- **`commitOfflineMutation(id:command:)`'s load-a-`current`-then-project shape does not fit, and was not
  force-fit.** Neither command has a "current" local record to load: `RecordObservation` has nothing to
  load (a pure insert, the same as `AddPlant`'s always-`nil` `current`, but with no OTHER command in the
  same feature that ever needs a non-`nil` one), and `CorrectObservation` does not load-and-mutate the row
  it corrects the way `UpdatePlantDetails` loads-and-mutates a plant. Built the simplest correct method
  instead — see "What changed" below.

### What changed

- **`LocalObservationStore.commitOfflineAppend(_:operation:)`, new — simpler than, not a copy of,
  `commitOfflineMutation(id:command:)`.** Takes the already-fully-built `GardenObservation` projection and
  `OutboxOperation` directly, not a closure that receives a `current` neither command would ever use:
  `RecordObservation`/`CorrectObservation` validate content and build both values entirely from data their
  own caller already has, before ever touching the store, so there is nothing left for a closure running
  inside the transaction to still decide. What atomicity still requires — the projection write and the
  outbox insert commit or roll back together — is identical to every sibling store's guarantee; only the
  "load current first" step (1 of architecture/offline-synchronization.md section 6) is genuinely absent,
  not merely skipped. `GRDBObservationStore.commitOfflineAppend` opens one `dbQueue.write` block that calls
  `ObservationRecord(observation).insert(db)` — a genuine INSERT, not `GardenRecord`/`PlantRecord`/
  `GardenObjectRecord`'s `.save(db)` upsert, since an observation row is never legitimately re-written once
  appended — then `SyncOutboxTransactionWriter.enqueue(operation, in: db)`, the same shared helper Stage 4a
  built. No `save(_:)`/`replaceAll(with:)` method exists on `LocalObservationStore` at all, and no
  "pending" guard against a stale server response either: nothing ever overwrites an observation row in
  place, so there is no clobbering risk to protect against — confirmed correct, not merely convenient,
  by the fact that `ObservationsTimelineViewModel` never calls anything resembling `save(_:)` on this
  store.
- **New `observation` GRDB table (`ObservationRecord`/`LocalObservationStore`/`GRDBObservationStore`/
  `InMemoryObservationStore`), holding ONLY rows this device appended itself, purely offline** — not a
  full mirror of every server field the way `plant`/`garden`/`garden_object` are. Columns: `id`,
  `gardenId`, `plantId`, `gardenObjectId`, `noteText`, `conditionSummary`, `correctionKind`,
  `correctsObservationId`, `observedAt`, `recordedAt`. `actorType` (always `.user` for anything this
  client creates), `createdByProfileId`, and `photos` (always `[]` — no photo-attachment flow yet) are
  reconstructed as constants in `domainValue`, not stored columns — narrower than `PlantRecord`'s "same as
  the domain type's full field set" precedent, and correctly so: that precedent exists specifically
  because `UpdatePlantDetails` must preserve fields it does not touch, and neither observation command
  ever partially updates anything (every row is a complete, from-scratch insert). `isCorrected` is not
  stored at all — it is not a property of one row in isolation but a fact about whether some OTHER row
  points back to it, so it is recomputed at merge time (see below), never written back to an append-only
  table that has no row to write it back to.
- **`RecordObservation`/`CorrectObservation` stop calling `ObservationGateway` synchronously.** Each
  validates locally (at least a note or a condition summary, mirroring the domain's own
  `requireObservationContent` restricted to the note/condition half of its three-way rule, since
  `photoMediaIds` is always `[]` from this client), builds the local projection and an `observations.*`
  outbox operation, and commits both through `LocalObservationStore.commitOfflineAppend`.
  `ListObservationsForGarden`/`ListObservationsForPlant` are untouched and stay online, gateway-backed
  reads. `ListObservationsForGarden` gained one new method, `pending(gardenId:)` — the garden-scoped
  counterpart to `ListGardens.cached()`/`GetPlant.cached(plantId:)` — wrapping
  `LocalObservationStore.fetchPending(gardenId:)`; `ListObservationsForPlant` gained nothing, since the
  local pending set for one garden is expected to stay small enough that an in-memory filter over the
  unfiltered per-garden read costs nothing a second, plant-scoped store method would save.
- **Outbox payload** (`ObservationSyncCommandPayload`/`ObservationSyncCommand`) mirrors
  `packages/api-contracts/openapi.yaml`'s `SyncObservationOperationPayload`/`SyncObservationCommand` field
  for field: `recordType: "observation"` (singular, not the guessable `"observations"` — matches
  `sync-record-type.ts`'s own `Observation: 'observation'`), `observations.record`, `observations.correct`.
  `targetRecordIds` for `CorrectObservation` names only the new correction row's own id, not
  `correctedObservationId` — the same "id(s) this operation writes to, not every id it references" reading
  `AddPlant.targetRecordIds` already gives for `gardenAreaMapObjectId`/`placementMapObjectId`. `observedAt`
  is a pre-formatted RFC 3339 string on the wire, not a raw `Date` — the first outbox payload across
  Gardens/Map/Plants/Observations to need one at all (`FeaturePlants`'s own `acquisitionDate` is a
  calendar-date string throughout its whole domain model, never a `Date`); formatted by a small
  five-line `ObservationTimestampFormatting` helper local to `FeatureObservations`, duplicating
  (deliberately, not by oversight) `CoreNetworking.ISO8601DateFormatter.withFractionalSeconds`'s exact
  format options, since that extension is `internal` to `CoreNetworking` and not reachable from here —
  widening its access level for one caller was judged not worth it against a five-line, no-domain-logic
  local copy.
- **UI/merge**: `ObservationsTimelineViewModel.load()` now reads `listObservationsForGarden.pending
(gardenId:)` alongside the network call and MERGES the two — not the cache-first-then-overwrite shape
  `GardensListViewModel.load()`/`PlantDetailViewModel.load()` use, and not a "protect a pending row from
  being clobbered" guard either, because neither applies to an append-only feed: a locally-appended row is
  never "the same row, now stale" as anything the server could return, so the correct action is to include
  it exactly once (deduplicated by id, server winning any collision — not expected to occur this stage,
  since no push engine exists yet, but a safe default for if one someday does), not choose between two
  versions of one row. `isCorrected` is recomputed across the WHOLE merged set rather than trusted verbatim
  off either source, so a locally-pending correction of a server-confirmed observation marks that
  observation "Corrected" immediately, before the correction has any chance to sync. On a network failure,
  `load()` falls back to the pending set alone ONLY when it is non-empty — an empty pending set on a
  transport failure still means "unknown," never "confirmed empty," so `.failed` is still shown in that
  case, mirroring `GardensListViewModel.load()`'s identical `hadCachedResult` reasoning applied to
  "pending" instead of "cached."
- **No `GetObservation.cached(id:)`-style fix was needed, unlike Stage 4c's `GetPlant.cached(plantId:)`.**
  Checked explicitly, per this stage's own brief: `PlantsHomeViewModel.performAdd()` navigates to a
  separate detail screen for the plant it just created, which is why `PlantDetailViewModel.load()` needed
  a cache-first read to show it. Observations have no equivalent "navigate to the thing I just created"
  flow — recording or correcting an observation appends directly into the SAME timeline screen already on
  screen, so the fix this shape actually needed was the merge in `load()` above, not a cache-first single-
  record read.
- **UI**: `ObservationRow` gained `plantId`/`gardenObjectId` (not rendered — carried through so
  `submitCorrection` can propagate them onto a correction's local projection, since `CorrectObservation`
  has nowhere else to read them from) and `isPendingSync: Bool`, shown as a "Saved locally, waiting to
  sync" badge (`observations.status.savedLocally`, en+ru) next to the existing "Corrected" badge — the
  same copy Stage 4a/4b/4c used for their own single-record `syncStatusLabel`, here per-row instead of
  per-screen since every row, not one edited record, is independently either confirmed or pending.
  `submitCorrection` now looks up the row being corrected from `state` itself (by id) rather than only
  holding `correctingObservationId`, since `CorrectObservation` needs `target.plantId`/
  `target.gardenObjectId` and `gardenId` (this timeline's own, always the correction's garden — the
  contract's outer envelope needs it even though `CorrectObservationRequest` itself does not) to build a
  locally-coherent projection.

### Tests

- [x] Termination-at-boundary fault test: forces a real `sync_outbox` primary-key violation on the second
      write inside `commitOfflineAppend`'s transaction and proves the projection insert rolls back with it
      — real GRDB behavior, not a mock (`ObservationOfflineMutationTests.outboxFailureRollsBackProjection`),
      plus the positive case that both writes are durably present together after a successful commit.
- [x] `commitOfflineAppend performs a genuine insert, not an upsert — reusing an id fails` — the concrete
      proof that `ObservationRecord.insert(db)`, not `.save(db)`, is what this table's append-only
      semantics require.
- [x] Both commands covered offline (`ObservationsUseCasesOfflineTests`) — no test configures an
      `ObservationGateway` at all, so a passing suite is itself proof no network call happens — including
      local-only validation failures (`invalidContent`), each outbox row's stored payload decoded as loose
      JSON and checked against the contract's field names (including the omitted-not-null distinction for
      a plain `nil` optional — this request has no `FieldUpdate`-style "omission means something different
      from null" case the way `UpdatePlantDetailsRequestPayload` does, so Swift's default synthesized
      `Encodable` omitting the key is correct here, not a gap), and `CorrectObservationRequestPayload`
      confirmed to carry no `plantId`/`gardenObjectId` keys at all.
- [x] Timeline-rendering test proving an offline-pending correction still displays its "corrects
      observation X" relationship correctly before syncing
      (`correctionOfOfflineObservationDisplaysRelationshipWhileOffline`) — combined with the network-
      unreachable fallback path in the same test, since a correction routes through local storage
      unconditionally in this stage (there is no "online" path left to differ from). A second test
      documents the honest boundary of a no-cache-of-confirmed-rows design: correcting a server-confirmed
      observation while offline shows the correction (with its relationship intact) but not the original,
      since nothing caches confirmed rows for the network failure to fall back to
      (`correctionOfServerObservationWhileOfflineOmitsUncachedOriginal`).
- [x] `load()`'s pending-fallback behavior covered for both the "something pending" case (shows it) and the
      "nothing pending" case (still fails, not a false empty state), plus the saved-locally badge clearing
      once a row's id also appears in a (simulated future) server response.
- [x] `fetchPending` scoping by `gardenId` covered for both `GRDBObservationStore` (real database) and
      `InMemoryObservationStore` (fallback).
- 476 tests, 70 suites (`swift test`, full and unfiltered, run clean with no SIGBUS flake encountered).
  `FeatureObservationsTests` itself: 29 tests across 4 suites (3 new: `ObservationOfflineMutationTests`,
  `ObservationsUseCasesOfflineTests`, `InMemoryObservationStoreTests`), up from 7 tests in 1 suite before
  this stage.

### Judgment calls (for later stages to inherit or reconsider)

- `CorrectObservation.callAsFunction` takes `correctedPlantId`/`correctedGardenObjectId` as plain
  caller-supplied parameters rather than looking them up from local storage by `correctedObservationId` —
  the deliberate consequence of there being no "current" record for this command to load at all. The
  caller (`ObservationsTimelineViewModel.submitCorrection`) always has this data anyway (the row is on
  screen, being corrected), so requiring the store to hold it too would only add a second source of truth
  for the exact same value.
- `gardenId` is now a required parameter of `CorrectObservation.callAsFunction`, unlike the pre-Stage-4d
  gateway-backed version (which read it from the URL path via `correctedObservationId` alone). The outer
  `SyncObservationOperationPayload`/`OutboxOperation.gardenId` envelope needs one even though
  `CorrectObservationRequest`/`SyncCorrectObservationCommand` do not — `ObservationsTimelineViewModel`
  already has its own `gardenId` (this screen is always scoped to one garden), so this is a straight
  pass-through, not a new value the view model has to discover.
- A locally-pending row's `isPendingSync` clears the moment its id also appears in a server response —
  tested with a hand-seeded fake gateway row standing in for what a real push-then-pull round trip would
  eventually produce (P5-IOS-03, not yet built), since no such round trip can actually happen this stage.
- `MigrationIntegrityTests.allTables` was not extended to include `observation` — mirrors Stage 4b's choice
  to leave `garden_object` off that list and Stage 4c's identical choice for `plant` (confirmed neither
  was ever added there); the same pre-existing, non-exhaustive-by-design gap this stage inherits rather
  than introduces.

Not done, deliberately: `FeatureTasks` retrofit (the last remaining P5-IOS-02 stage), the real push/pull
engine and full status vocabulary (P5-IOS-03), conflict recovery UI (P5-CONFLICT-01), any backend change.

## Stage 4e — P5-IOS-02 fifth and final slice: `FeatureTasks` offline mutation routing, implementation complete

Scope: the fifth and LAST slice of P5-IOS-02 — the seven reachable task commands (`CreateManualTask`,
`EditTask`, `RescheduleTask`, `CompleteTask`, `DismissTask`, `SkipTask`, `DeleteTask`) retrofitted through
the same atomic local-projection-plus-outbox pattern Stage 4a established, Stage 4b generalized to a
garden-scoped list, Stage 4c reused for a single-record mutable aggregate, and Stage 4d simplified for an
append-only one. Not `AttachTaskFile` (confirmed unreachable — see below). Not P5-IOS-03 (no real
push/pull engine yet), not conflict recovery UI (P5-CONFLICT-01), no backend change. With this stage,
P5-IOS-02 itself is complete — see the closing note below.

### What's different about Tasks, confirmed against the real code before building anything

- **`AttachTaskFile` confirmed unreachable by grep, exactly as expected going in.** `grep -rn
"AttachTaskFile|attachTaskFile" apps/ios/Sources/` finds only `CoreNetworking.TaskGateway`/
  `TaskTransport`'s own implementation and doc comments in `TasksUseCases.swift`/`TasksListView.swift`
  explaining the gap — no use case, no call site. It needs a `mediaId`, and
  `docs/development/deferred-capabilities.md`'s "Photo and file attachment" entry already lists
  `AttachTaskFile` alongside `FeaturePlants`'/`FeatureObservations`'s own media-dependent commands as one
  of the five gap-affected commands. The real scope is exactly the other seven, as the work package brief
  expected — no surprise here, unlike Stage 4c's fourth (`ConfirmPlantIdentification`).
- **All eight `tasks.*` discriminator strings and `recordType: "task"` verified directly against
  `packages/api-contracts/openapi.yaml`, not guessed — and, unlike every prior stage, every single one IS
  the naive camelCase guess.** `SyncTaskCommand`'s discriminator `mapping` (lines ~4459-4469):
  `tasks.createManualTask` (`SyncCreateManualTaskCommand` — `taskId` + `CreateManualTaskRequest`),
  `tasks.editTask` (`SyncEditTaskCommand` — `taskId` + `expectedRevision` + `EditTaskRequest`),
  `tasks.rescheduleTask` (`SyncRescheduleTaskCommand` — same shape + `RescheduleTaskRequest`),
  `tasks.completeTask`/`tasks.dismissTask` (same shape + `CompleteTaskRequest`/`DismissTaskRequest`),
  `tasks.skipTask`/`tasks.deleteTask` (`taskId` + `expectedRevision` only — **no `request` property at
  all**, matching `SkipTask`/`DeleteTask`'s own online signatures, which take only `If-Match`),
  `tasks.attachTaskFile` (out of scope — see above). The whole family wraps in `SyncTaskOperationPayload`
  (`recordType: "task"`, `gardenId`, `command`) — the contract's own singular `task`, also the guessable
  form this time. Every one was still read directly from the YAML before being typed into
  `TaskSyncCommandPayload.swift`, not assumed safe merely because it happened to match the guess.
- **`DeleteTask` confirmed a status transition to `'deleted'`, never a hard delete** —
  `task-lifecycle.ts`'s own header comment states this explicitly ("no hard-delete anywhere, only status
  transitions"), and `SyncDeleteTaskCommand`'s own description draws the same distinction
  `RequestGardenDeletion` already established for gardens. Its local projection
  (`TaskTerminalStatus.deleted.apply(to:at:)`) is a normal mutable-record upsert of the task's own row
  with `status: .deleted`, sharing the exact same code path `CompleteTask`/`DismissTask`/`SkipTask` use —
  never a row deletion from the local `task` table. Covered by a dedicated test
  (`TasksUseCasesOfflineTests.deleteTaskOffline`) asserting the row remains readable, with its status
  changed, immediately after.
- **`EditTask`/`RescheduleTask` factored through a shared client-side helper, mirroring this codebase's
  own server-side factoring of the same two commands.** `apply-task-detail-changes.ts`'s own doc comment
  states the server-side reasoning directly: both commands change only scheduling/detail fields (never
  `status`) through the identical domain function (`updateTaskDetails`, `domain/task.ts`), so the
  "guard the status, apply the change" plumbing lives once, not twice. This stage mirrors that exactly on
  the client: `TaskDetailChanges` (a client-side `TaskDetailChanges` mirror) plus
  `TaskDetailProjection.apply(_:to:at:)` (`TaskDetailProjection.swift`) is the one function both `EditTask`
  and `RescheduleTask` call — `RescheduleTask` simply builds a `TaskDetailChanges` that only ever populates
  `dueDate`/`timeWindowStart`/`timeWindowEnd`, leaving the rest at their `.unchanged`/`nil` defaults, the
  same relationship `RescheduleTaskInput`/`EditTaskChanges` have to the shared shape server-side.
  `CompleteTask`/`DismissTask`/`SkipTask`/`DeleteTask` got the identical treatment for their own shared
  logic, mirroring `task-lifecycle.ts`'s `requireEditableStatus`/`transitionTaskToTerminalStatus`:
  `TaskLifecycleRules.requireEditableStatus(_:)` (the shared precondition) and `TaskTerminalStatus.apply(
to:at:)` (the shared terminal-status projection, one case per target status) in
  `TaskLifecycleRules.swift` — both `TaskDetailProjection.apply` and `TaskTerminalStatus.apply` call
  `requireEditableStatus` first, so the "only while planned/suggested" invariant is enforced exactly once,
  not per-command.
- **`requireEditableStatus` needed a genuinely new local enforcement this stage, unlike Plants' commands.**
  Every Plants command Stage 4c retrofitted has no analogous "only while X status" precondition to lose by
  going offline (`setPlantStatus`/`transitionPlantLifecycleStage` accept a transition to any status,
  including the one already held — `plant-lifecycle.ts`'s own comment: "No hard state-machine ordering is
  enforced"). Tasks' server-side `requireEditableStatus` gate, previously enforced only by the round trip
  this stage removes, would otherwise let an already-terminal task be silently "edited" into an incoherent
  local projection with no error at all. Added as `TaskCommandError.taskNotEditable`, thrown by both shared
  helpers above — not reachable through the shipped UI today (`TasksListViewModelActions.performRowAction`
  already guards on `TaskRow.isMutable` before calling in), the same "not reachable, kept as a real tested
  failure mode rather than a force-unwrap" reasoning `PlantCommandError.localRecordNotFound`'s own doc
  comment gives, confirmed with a dedicated test for all four terminal transitions plus `EditTask`.
- **The list-shaped UI (not a single-record detail screen, unlike Plants/Gardens' settings screen) needed
  its own new local-store shape: a hybrid of Plants' and Map's precedents, not a straight copy of either.**
  `TasksListViewModel` renders one garden's whole task list, the same shape `MapEditorViewModel` renders
  `garden_object` through (`fetchAll`/`replaceAll` scoped by `gardenId`, N rows per garden) — but a task
  command, like a plant command and unlike a map command, only ever targets exactly one task
  (`commitOfflineMutation(taskId:command:)` loads and projects a single record, Plants' shape). `LocalTaskStore`
  combines both: `fetchAll(gardenId:)`/`replaceAll(gardenId:with:)` mirror `LocalMapStore`'s signatures
  exactly, while `commitOfflineMutation(taskId:command:)` mirrors `LocalPlantStore`'s exactly.
- **A genuinely new problem neither Gardens/Map/Plants/Observations had to solve: `TasksListViewModel`'s
  pre-existing server-side `statusFilter` support (`listTasksForGarden(gardenId:statuses:)`) is unsafe to
  feed straight into `replaceAll(gardenId:with:)` once local persistence exists.** `replaceAll` treats its
  argument as the _complete_ authoritative set for the garden, deleting any local row (besides a pending
  one) not present in it — so writing a server-side-_filtered_ subset through would incorrectly delete
  every task outside the filter from local storage, even though the server still has them. Resolved by
  making `ListTasksForGarden.callAsFunction` only write through to `localStore` when `statuses` is empty
  (a full, unfiltered fetch), and having `TasksListViewModel.load()` always call it with `statuses: []`,
  applying `statusFilter` as a display-only filter over the merged local result instead — the filter UI's
  user-visible behavior is unchanged, but the mechanism producing it moved from a server-side query
  parameter to a client-side `filter` over the same cache-first-then-refresh shape
  `FeatureGardens.GardensListViewModel.load()` already established, generalized to a garden-scoped list.
- **No `GetTask`/single-record cache-first read was needed, unlike Stage 4c's `GetPlant.cached(plantId:)`.**
  Checked explicitly, per Stage 4c's own precedent for this class of question:
  `TasksListViewModel.submitCreateTask()`/`performCreate` never navigates to a separate detail screen for
  the task it just created — creation and every row action happen on the same list screen already on
  screen, the identical reasoning Stage 4d gave for why Observations needed none either. `load()`'s
  cache-first-then-refresh shape (see above) is what already makes a task created offline visible
  immediately; no second, single-record read path was needed.

### What changed

- `TasksUseCases.swift`'s seven commands stop calling `TaskGateway` synchronously. Each now validates
  locally (title non-empty and ≤200 characters — the contract's own limit, previously enforced only up to
  non-empty by `CreateTaskFormValidation`, even though its own catalogue string, `tasks.titleRequired`,
  already read "Enter a title up to 200 characters" — a declared-but-unwired limit, this stage's own
  version of Stage 4a's `gardens.name.required` catch; task-must-exist-locally and
  task-must-be-planned/suggested for the six non-create commands), builds the optimistic local projection,
  and enqueues a `tasks.*` outbox operation — all inside one GRDB transaction
  (`LocalTaskStore.commitOfflineMutation(taskId:command:)`, new, combining `LocalPlantStore`'s
  single-record shape with `LocalMapStore`'s garden-scoped `fetchAll`/`replaceAll` shape — see above).
  `ListTasksForGarden` gained a `localStore: any LocalTaskStore` dependency and now writes every unfiltered
  fetch through to it (`localStore.replaceAll(gardenId:with:)`) — the mechanism that gives the seven
  offline commands a local row to load, validate against, and project forward, mirroring
  `FeatureGardens.ListGardens`'s identical Stage 4a addition. `TaskGateway` itself is untouched and stays
  in use by `ListTasksForGarden`.
- New `task` GRDB table (`TaskRecord`/`LocalTaskStore`/`GRDBTaskStore`/`InMemoryTaskStore`), full field set
  matching `GardenTask` exactly — the same "every non-create command must return a fully-correct
  projection the view model renders with no re-fetch" reasoning `PlantRecord`'s own doc comment gives,
  applied here too since `EditTask`/`RescheduleTask` each change only a handful of fields while everything
  else must still come out of the projection exactly as it was.
- Atomicity: `GRDBTaskStore.commitOfflineMutation` opens exactly one `dbQueue.write` block that loads the
  current `task` row, runs the caller's validate-and-project closure, saves the row, and inserts the
  `sync_outbox` row through the same shared `CorePersistence.SyncOutboxTransactionWriter` every prior stage
  built on. `GRDBTaskStore.replaceAll(gardenId:with:)` (and `InMemoryTaskStore`'s mirror) skip deleting or
  overwriting a task with a pending outbox operation — the same "do not let a stale server response
  clobber an unsynced local mutation" guard every prior stage added, decoding `sync_outbox.targetRecordIds`
  (a task's own id, not `gardenId`) the same way `GRDBPlantStore`/`GRDBMapStore` do.
- UI: `TaskRow` gained `isPendingSync: Bool`, shown as a "Saved locally, waiting to sync" badge
  (`tasks.status.savedLocally`, en+ru) next to each pending row — the per-row counterpart to
  `FeatureObservations.ObservationRow.isPendingSync` (Stage 4d), not the per-screen `syncStatusLabel`
  Stages 4a/4b/4c used, since a list, unlike a single garden/plant/map detail screen, can have several rows
  independently pending at once. Backed by `TasksListViewModel.locallyMutatedTaskIds`, a session-scoped
  `Set<String>` — the same "session-scoped, not derived from a persisted outbox query" precedent every
  prior stage's own version establishes.

### Tests

- [x] Termination-at-boundary fault test: forces a real `sync_outbox` primary-key violation on the second
      write inside `commitOfflineMutation`'s transaction and proves the projection write rolls back with it
      — real GRDB behavior, not a mock (`TaskOfflineMutationTests.outboxFailureRollsBackProjection`), plus
      the positive case that both writes are durably present together after a successful commit.
- [x] All seven commands covered offline (`TasksUseCasesOfflineTests`) — no test configures a `TaskGateway`
      at all, so a passing suite is itself proof no network call happens — including local-only validation
      failures (`invalidTitle`, `localRecordNotFound`, `taskNotEditable` for all four terminal transitions
      plus `EditTask`), each outbox row's stored payload decoded as loose JSON and checked against the
      contract's field names (including the `.set(nil)`-encodes-explicit-`null`-not-omission distinction for
      `EditTask`, and confirming `SkipTask`/`DeleteTask`'s payload carries no `request` key at all).
- [x] `replaceAll` pending-preservation covered for both `GRDBTaskStore` (real database, including that it
      is scoped per-task via `targetRecordIds`, not the whole owning garden) and `InMemoryTaskStore`.
- [x] View-model-level coverage (`TasksListViewModelTests`, rewritten, not just extended) — every test that
      depended on the now-removed online round trip (gateway-mediated status transitions,
      `gateway.listTasksForGarden` used as the confirmation channel) now seeds `FakeTaskGateway` once and
      calls `load()` to populate the local store via write-through, then exercises row actions purely
      locally; new coverage added for the saved-locally badge appearing immediately after create, and a
      pending mutation surviving a subsequent `load()` refresh against a fake gateway whose own copy is
      still stale (proving `replaceAll`'s pending-protection guard end to end through the view model, not
      only at the store level).
- 509 tests, 73 suites (`swift test`, full and unfiltered, run clean with no SIGBUS flake encountered).
  `FeatureTasksTests` itself: 50 tests across 5 suites (3 new: `TaskOfflineMutationTests`,
  `TasksUseCasesOfflineTests`, `InMemoryTaskStoreTests`), up from roughly 13 tests in 2 suites before this
  stage.

### Judgment calls (for later stages to inherit or reconsider)

- A task created offline gets local `revision = 0` and, for every other command, the projection keeps
  exactly `current.revision` — the identical `unconfirmedGardenRevision`/`unconfirmedPlantRevision`
  sentinel and "never advance locally" rule, restated here rather than reused as a shared constant across
  features, matching how every prior stage keeps its own version feature-private.
- Every one of the eight `tasks.*` `commandType` strings, and `recordType: "task"`, turned out to already
  be the naive camelCase/singular guess — the first stage in this series where that held for the whole
  family, not just some of it. Read directly from the YAML anyway, not assumed safe from the pattern:
  `SkipTask`/`DeleteTask` carrying no `request` property at all (unlike `CompleteTask`/`DismissTask`, which
  do) was still a real, if smaller, shape detail this stage could only have caught by reading the schema,
  not by pattern-matching the naming convention alone.
- `ListTasksForGarden.callAsFunction(gardenId:statuses:)` keeps its `statuses` parameter (rather than being
  narrowed to no longer accept one) even though `TasksListViewModel.load()` — its only caller — now always
  passes `[]`: the parameter itself is not unsafe, only feeding a non-empty result through
  `replaceAll(gardenId:with:)` is, and the method already guards that internally (skipping the
  write-through whenever `statuses` is non-empty) rather than trusting every future caller to remember the
  same discipline. A future server-side-filtered-list caller, if one is ever added, gets the safe behavior
  automatically rather than needing to rediscover this stage's own reasoning.
- `MigrationIntegrityTests.allTables` was not extended to include `task` — mirrors every prior stage's
  identical choice to leave `garden_object`/`plant`/`observation` off that same list (confirmed none of the
  four was ever added there); the same pre-existing, non-exhaustive-by-design gap this stage inherits
  rather than introduces.

Not done, deliberately: the real push/pull engine and full status vocabulary (P5-IOS-03), conflict recovery
UI (P5-CONFLICT-01), offline support for `AttachTaskFile` (confirmed unreachable — see above), any backend
change.

## P5-IOS-02 complete (Stages 4a–4e)

All five Phase 2–4 iOS features now route every reachable offline-capable command through the same atomic
local-projection-plus-outbox pattern, established in Stage 4a and reused (with feature-appropriate
variations, never a mechanical copy) by every stage after it:

- **Gardens** (Stage 4a): 4 commands — `CreateGarden`, `RenameGarden`, `ArchiveGarden`,
  `RequestGardenDeletion`. Local table: `garden` (one row per record).
- **Map** (Stage 4b): 10 commands via one generic dispatch (`ApplyMapCommandOffline`) — create, move,
  replace geometry, edit vertex, split/join linework, change properties, assign plant, delete, restore,
  duplicate. Local table: `garden_object` (N rows per garden).
- **Plants** (Stage 4c): 5 commands — `AddPlant`, `UpdatePlantDetails`, `TransitionPlantLifecycleStage`,
  `SetPlantStatus`, `MovePlant`. Local table: `plant` (one row per record, full field set).
- **Observations** (Stage 4d): 2 commands — `RecordObservation`, `CorrectObservation` (append-only, no
  "current" record to load). Local table: `observation` (append-only rows this device created).
- **Tasks** (Stage 4e): 7 commands — `CreateManualTask`, `EditTask`, `RescheduleTask`, `CompleteTask`,
  `DismissTask`, `SkipTask`, `DeleteTask`. Local table: `task` (one row per record via
  `commitOfflineMutation`, N rows per garden via `fetchAll`/`replaceAll` — a hybrid of Plants' and Map's
  shapes).

**Totals**: 28 offline-capable commands across 5 features, 5 new local GRDB tables (`garden`,
`garden_object`, `plant`, `observation`, `task`) sharing one per-profile database file and one
`CorePersistence.SyncOutboxTransactionWriter`/`sync_outbox` table. 9 commands confirmed unreachable from
any shipped UI and deliberately excluded (by grep, not assumed): `upsertCalibration`/`decideProposal`
(Map), `AddPlantFromPhoto`/`AttachPlantPhoto`/`SetPrimaryPlantPhoto`/`ConfirmPlantIdentification`
(Plants), `AttachTaskFile` (Tasks) — all media/reference-dependent on a pipeline this codebase does not
have yet (`docs/development/deferred-capabilities.md`'s "Photo and file attachment" entry). Final full,
unfiltered `swift test` count as of Stage 4e: 509 tests, 73 suites.

**Not done anywhere in P5-IOS-02, by design** — this work package's own scope boundary, not a gap: the
real push/pull `SyncEngine` (`CoreSynchronization.LocalOnlySyncEngine` remains the only implementation, so
no outbox operation any stage enqueues has actually reached the server yet), the full
`Waiting for connectivity`/`Synchronizing`/`Synchronized`/`Requires attention`/`Upload pending` status
vocabulary (every feature's UI shows only the honest "Saved locally, waiting to sync" slice), conflict
recovery UI, and any backend change. These are P5-IOS-03's and P5-CONFLICT-01's job next — both now
unblocked, since P5-IOS-02 (their shared dependency) is complete.

## P5-IOS-03 complete (Stages 5a–5b)

Stage 5a (merged separately) built `CoreNetworking.SyncGateway`'s `registerClient`/`push`/`acknowledge` and
the real push side, `CoreSynchronization.RemoteSyncEngine.pushPending()`, dispatching each of the six push
outcomes through a per-record-type `SyncRecordApplier` registry. Stage 5b completes the engine: real pull,
retry/backoff, checkpointing/triggers, and a status model.

- **Pull is profile-scoped, not per-garden** — a real, confirmed-by-inspection correction, not an
  assumption carried forward: `GET /sync/changes` (`packages/api-contracts/openapi.yaml`) declares exactly
  three parameters (`after`, `limit`, `protocolVersion`) and no `gardenId`, and `GetSyncChanges.execute`
  server-side computes visibility from every membership the caller has, not one requested garden. Stage 3's
  `CoreDomain.SyncCursor`/`CorePersistence.SyncCursorStore` were built "one cursor per garden partition"
  ahead of any real consumer; as their first real consumer, this stage corrected both to a one-row,
  profile-scoped singleton (new migration `recreateSyncCursorAsProfileScopedSingleton`, since nothing real
  ever wrote to the old shape) rather than building a client that queries a `gardenId` parameter the server
  does not accept.
- **`CoreNetworking.SyncGateway.getChanges`**: wraps `GET /sync/changes`, decoding each pulled item's
  `record.data` a second time into the exact same `GardenTransport`/`GardenObjectTransport`/
  `PlantTransport`/`GardenTaskTransport` structs `GardenGateway`/`MapGateway`/`PlantGateway`/`TaskGateway`
  already decode their own always-fresh-from-server reads into — reused, not duplicated, since
  `SyncRecordSnapshot`'s per-record-type `data` schema is byte-identical to each of those endpoints' own
  response schema. `calibration`/`observation` decode to `.unprojected(recordType:)` — no typed local
  projection exists for either (see below).
- **`CoreSynchronization.SyncPullRecordApplier`**: a new, optional-to-conform-to protocol extending
  `SyncRecordApplier` with `applyUpsert(_:)`/`applyDelete(recordId:gardenId:revision:)` — pull's "genuinely
  new or differently-changed record from another device" case, distinct from `applyConfirmed`'s "my own
  operation got confirmed" case. `GardenSyncRecordApplier`/`MapSyncRecordApplier`/`PlantSyncRecordApplier`/
  `TaskSyncRecordApplier` all conform; `ObservationSyncRecordApplier` deliberately does not —
  `LocalObservationStore` caches only this device's own not-yet-synced rows, never a full confirmed-record
  set a pulled upsert could write into, so `RemoteSyncEngine` skips `observation` changes generically
  (no pull-capable applier registered), the same "not this client's job to project locally" posture
  `calibration` already gets on the push side. `GardenSyncRecordApplier.applyDelete` is a deliberate no-op,
  not an oversight: a `garden`/`delete` change is the access-revocation tombstone, and "removing protected
  local data" is explicitly P5-SEC-01's own later work package — this stage only delivers and durably
  records it (the cursor still advances past it). `gardenObject`/`plant`/`task` deletes are real, ordinary
  tombstones with no such carve-out, applied through two new guarded methods each feature's `Local*Store`
  gained (`save(_:)`/`delete(id:)` for Map and Tasks; `delete(id:)` alone for Plants, which already had
  `save(_:)`) — the same "do not clobber a pending local mutation" guard every Stage 4 sub-stage's own
  `save`/`replaceAll` already implements.
- **Retry/backoff**: `SyncBackoff` (full jitter, `baseDelaySeconds = 2`, `maxDelaySeconds = 300`, both
  reasoned defaults documented as such) gates both `pushPending()` (per-operation, via
  `CoreDomain.OutboxOperation.retryState`, durably updated through `SyncOutboxStore.recordAttempt` — built
  in Stage 3, never called until now) and `pullChanges()` (a coarser, in-memory, per-engine-instance gate,
  since pull carries no per-operation retry state to key by at all). `Retry-After` is honored as a floor
  over the computed exponential delay — required threading a `retryAfterSeconds: Int?` onto
  `CoreNetworking.APIGatewayError.service` and reading the header in `HTTPTransport`, both new.
- **Checkpointing**: confirmed, not assumed, genuinely inherent — each pulled page's items are applied
  through real GRDB transactions and the cursor advances through its own real transaction before the next
  page starts. NOT literally "one shared SQLite transaction spanning every applied item plus the cursor
  advance," architecture/offline-synchronization.md section 10's stronger claim — achieving that would need
  every applier to accept an already-open `Database` handle, crossing the GRDB boundary this stage's own
  scope does not touch. Recorded as an honest, bounded gap: every apply is an idempotent upsert/delete by
  stable id, so a crash before the cursor advances just re-applies the same page harmlessly on restart, the
  same idempotent-retry safety net section 9 already relies on for push.
- **Triggers**: confirmed, by inspection, that no `NWPathMonitor`/`BGTaskScheduler`/`scenePhase` reference
  existed anywhere in this codebase before this stage. Wired one real trigger — SwiftUI `scenePhase` ==
  `.active` in `AppComposition.RootView`, calling a new `SyncEngine.retryNow()` (a protocol-level default
  `pushPending()` + `pullChanges()`, so `LocalOnlySyncEngine` gets it for free too) — satisfying
  "App foreground/background transitions" and, since `retryNow()` is exactly what a future explicit-retry
  button would call, "explicit user retry" structurally. Connectivity-change and background-processing-
  opportunity triggers are left a documented, real gap: both need genuinely new subsystems (a path-monitor
  actor; `Info.plist` `BGTaskSchedulerPermittedIdentifiers` plus a registered handler) beyond a small,
  clearly-scoped addition. Automatic per-feature "local outbox insert" triggers are also a deliberate,
  separately-scoped follow-up: every feature's own offline-mutation call sites (~20 use cases across five
  modules) would need touching for one trigger, and the engine itself is already ready to be called that
  way the moment that follow-up lands.
- **Status model**: new `CoreSynchronization.SyncEngineStatus` (`unknown`/`synchronizing`/`savedLocally`/
  `synchronized`/`waitingForConnectivity`/`requiresAttention` — five of section 8's six terms;
  `Upload pending` stays unmodeled, since no media-upload flow exists anywhere in this codebase yet),
  exposed as `RemoteSyncEngine.status`, updated after every push/pull cycle. Deliberately NOT wired into any
  of the five features' own session-scoped `syncStatusLabel`/`MapSaveStatus` placeholders this stage:
  reconciling a per-screen, per-command signal with an engine-wide one is a real design question spanning
  every `Feature*` module's view models, and `RemoteSyncEngine` staying a fresh-per-call factory (not a
  held singleton, to keep the existing profile-switch-safety guarantee every `local*Store()` method already
  has) means status is only observable within one instance's own call today regardless — both named plainly
  as a separate follow-up rather than half-wired now.
- Final full, unfiltered `swift test` count as of Stage 5b: 604 tests, 84 suites (up from Stage 4e's 509;
  Stage 5a's own count was not recorded in this log — its own tests remain green as of this stage).

**Not done, deliberately**: conflict recovery UI and revocation/protected-data-removal reaction to a garden
tombstone (P5-CONFLICT-01/P5-SEC-01's own later work), per-feature UI status wiring (see above), any backend
change.

## P5-SEC-01 complete

Remove protected local partitions and stop stale pushes after membership or account revocation. Builds the
reaction Stage 5b deliberately left as a documented no-op (`GardenSyncRecordApplier.applyDelete`, see above).

- **Server-side push rejection was already correct — verified, not assumed, and no backend code was
  needed.** Every one of the five sync push routers
  (`services/api/src/modules/synchronization/application/route-{garden,garden-object,plant,observation,task}-operation.ts`)
  routes to a sibling-module command that authorizes through `GardenAuthorization.requireCapability`
  (`services/api/src/modules/gardens-mapping/application/garden-authorization.ts`) before doing any write —
  directly for garden/map commands, or through `requirePlantAndAuthorize`/`requireTaskAndAuthorize`
  (`plants-inventory`/`tasks-recommendations`) for plant/task commands that only receive a record id, or
  directly for `RecordObservation`/`CorrectObservation`. `requireCapability` calls
  `MembershipRepository.findActiveMembership`, which `KyselyMembershipRepository`
  (`services/api/src/modules/gardens-mapping/persistence/kysely-membership-repository.ts`) implements as
  `WHERE state = 'active'` — a non-active or nonexistent membership returns `null`, and `requireCapability`
  throws `NotFoundError`. `execute-and-map-outcome.ts` catches every `ApplicationError` (including
  `NotFoundError`) and maps it to the sync push outcome `{ kind: 'rejected', error: detail }`. So a push
  against a garden the caller has lost membership on already comes back `rejected` today, purely as a side
  effect of the ordinary authorization check every command already had — nothing P5-SEC-01-specific exists
  or was needed server-side. (Separately confirmed, from `get-sync-changes.ts`'s own header comment: no
  command anywhere in this codebase transitions a membership row to `'removed'` yet — membership revocation
  itself is a genuine, unimplemented product-wide gap, not this work package's to close. `GetSyncChanges`
  was already built in advance to deliver a `garden`/`delete` tombstone correctly the moment a future
  revocation command exists; this stage is the client's own reaction to that tombstone, ready in advance of
  the same producer.)
- **Cascade-removal seam**: extended `CoreSynchronization.SyncRecordApplier` (the base protocol, not
  `SyncPullRecordApplier` — `ObservationSyncRecordApplier` deliberately does not conform to the latter, but
  still owns garden-scoped rows that must be swept) with a new required method,
  `removeGardenScopedData(gardenId:) async throws`. `RemoteSyncEngine+Pull.swift`'s `apply(_:)`, on seeing a
  `garden`/`delete` change (`item.recordId` is the garden's own id for this one record type — confirmed
  against `GetSyncChanges.fetchRecordSnapshot`'s own comment, "the record IS the garden"), calls a new
  `removeGardenPartition(gardenId:)` that iterates every registered applier's `removeGardenScopedData(gardenId:)`
  — `CoreSynchronization` never learns what `garden_object`/`plant`/`observation`/`task` are as concrete
  types, only that every registered applier owns some table scoped by `gardenId`. Each of the five appliers
  implements it by forwarding to a new, unconditional (no "except when pending" guard — a revoked garden's
  pending operations can never be accepted) `Local*Store` method: `LocalGardenStore.remove(gardenId:)`
  (the one case where `gardenId` names the applier's own record, not one scoped underneath it) and
  `LocalMapStore`/`LocalPlantStore`/`LocalObservationStore`/`LocalTaskStore.removeAll(gardenId:)`.
  `GardenSyncRecordApplier.applyDelete` itself stays the documented no-op it already was — the cascade, not
  that ordinary single-applier dispatch, is what now actually removes the garden's own row.
- **Stop stale pushes, client side**: the same `removeGardenPartition(gardenId:)` also drains every
  still-pending `sync_outbox` row for the garden (`SyncOutboxStore.fetchPending(gardenId:)` +
  `remove(operationId:)`, both pre-existing methods — no new outbox API needed) — a pure client-side
  optimization given the server already rejects it independently, avoiding a guaranteed-futile round trip and
  the transient "requires attention" status a `rejected` outcome would otherwise show for an
  already-known-unrecoverable operation.
- **Conflict/operation-result cleanup — a reasoned, not guessed, call**: `SyncOperationResult` rows for the
  garden are removed too (new `SyncOperationResultStore.removeAll(gardenId:)`) — operational bookkeeping for
  outbox operations the same step just removed, not itself "recovery information." `SyncConflict` rows are
  deliberately left untouched — no removal method was added to `SyncConflictStore` at all — matching
  architecture/offline-synchronization.md, section "11. Authorization Changes"'s own carve-out ("after
  preserving only policy-approved conflict or export recovery information") and section "15. Local Conflict
  Recovery"'s framing of a conflict record as durable recovery information (original operation, both
  representations, suggested recovery actions), not operational bookkeeping.
- **Account-level revocation (signed-out session should not retain another account's local data) — checked,
  not silently skipped, and left as a separate, real gap.** `CorePersistence.LocalDatabase` already scopes
  the on-disk database per Firebase UID (`profiles/<uid>/gardens.sqlite`, confirmed in `LocalDatabase.swift`'s
  own "Profile scoping" doc comment), so no code path in this app can ever read one signed-in account's data
  through a different account's session — switching accounts opens a genuinely different SQLite file, not a
  shared one carrying stale rows forward. What is NOT built anywhere in this codebase, confirmed by
  inspection: an actual sign-out flow. `CoreAuthentication.AuthenticationGateway.signOut()` has zero callers
  outside its own protocol declaration and the `FirebaseAuthenticationGateway` implementation; no
  Settings/Shell UI exists (`shellSignOut` is an unused, unwired localization key); `AppComposition.RootView`
  routes purely on `AuthenticationSessionObserver.isSignedIn`, driven only by Firebase's own listener, with no
  additional reaction wired to it. Building "the session became invalid, clear the local sync database" would
  mean designing a new cross-module flow this work package's own scope does not clearly own (new
  `CorePersistence`-facing API from `CoreAuthentication`/`AppComposition`, a decision about exactly when to
  trigger it with no sign-out UI yet to observe triggering it from) — real, non-trivial architecture work
  distinct from the garden-partition cascade this stage builds, not a small addition riding along with it.
  Documented here as a genuine, understood, separate gap — "membership OR account revocation" is P5-SEC-01's
  own stated scope, but the account half has no sign-out flow to close it against yet.
- **Tests — "Offline removal attack tests" (this work package's own completion evidence, taken literally)**:
  engine-level cascade dispatch and outbox/operation-result/conflict scoping, with fakes
  (`CoreSynchronizationTests.RemoteSyncEnginePullTests.gardenDeleteCascadesToEveryRegisteredApplier`/
  `nonGardenDeleteDoesNotCascade`); per-feature `removeGardenScopedData` forwarding, with `InMemory*Store`
  (`*SyncRecordApplierTests.removeGardenScopedData*`, all five features); per-feature real-GRDB
  `removeAll`/`remove` coverage proving the actual SQL deletes rows unconditionally and scopes strictly to one
  garden (`*OfflineMutationTests.removeAll*`/`removeDeletesGardenUnconditionally`, all five features, plus
  `SyncOperationResultStoreTests.removeAllDeletesResultsForOneGarden`); and the attack scenario itself, end to
  end against a real `GRDBGardenStore`/`RemoteSyncEngine`, in a new suite,
  `FeatureGardensTests.GardenRevocationAttackTests` — proving BOTH that an offline rename against a
  (unknowably, already-revoked) garden still succeeds before any pull happens, the deliberate, understood
  boundary that offline editing of a since-revoked garden is possible for at most one offline session, AND
  that the very next successful pull closes that window, removing the garden's row and sweeping the pending
  rename together.
- Final full, unfiltered `swift test` count: 624 tests, 85 suites (up from Stage 5b's 604/84 — 20 new tests,
  one new suite).

**Not done, deliberately**: conflict recovery UI (P5-CONFLICT-01), web continuity (P5-WEB-01), any new
backend code (verified unnecessary — see above), and closing the account-level sign-out/local-data-clearing
gap (a real, separate gap, documented above, not this stage's to build without its own scoping).

## P5-CONFLICT-01 complete

Implement durable recovery for stale geometry, task transitions, rejected operations, and dependency
failures — the resolution mechanism Stage 5a/5b's own conflict recording deliberately left unbuilt, and
P5-SEC-01 explicitly deferred.

- **Real per-command-type "safely replayable" table, replacing Stage 5a's placeholder**: the prior blanket
  "`gardenObject` gets all four actions, everything else gets two" rule is gone. New
  `CoreSynchronization.ConflictRecoveryPolicy` decides `reapplyLocalIntent`/`duplicateAsNewObject`
  per `(recordType, commandType)`, checked against every command's actual payload shape
  (`GardenSyncCommand`/`MapCommandPayload`/`PlantSyncCommand`/`TaskSyncCommand`/`ObservationSyncCommand`),
  not guessed: relative-delta commands (`map.moveObject`) and complete-new-value commands
  (`map.replaceGeometry`/`changeProperties`/`assignPlant`, every mutable `gardens.*`/`plants.*`/`tasks.*`
  command) are safely replayable; absolute-index commands that assume a specific prior shape
  (`map.editVertex`) are not; multi-target/dual-revision commands (`map.splitLinework`/`joinLinework`) get
  neither reapply nor duplicate, since this mechanism's one corrected revision and one server representation
  cannot vouch for more than one affected record; every create command (no `expectedRevision` at all) gets
  neither. `duplicateAsNewObject` stays `gardenObject`-only — confirmed, not assumed, that no other record
  type's command set has anything resembling a "duplicate" concept. Table-driven test coverage
  (`ConflictRecoveryPolicyTests`) enumerates every command type against this table.
- **Closing a conflict generically**: new `CoreDomain.OutboxOperation.resolvesConflictId: String?` (new
  nullable `sync_outbox` column, migration `addResolvesConflictIdToSyncOutbox`) — set only on a resolution
  operation `reapplyLocalIntent`/`duplicateAsNewObject` creates. `RemoteSyncEngine.apply(_:to:)`'s existing
  `.accepted`/`.duplicate` branch now also removes the conflict this field names, if any — the _only_ new
  logic there, with zero record-type-specific knowledge, matching Stage 5a/5b/P5-SEC-01's own "engine stays
  generic" convention exactly. New `CoreDomain.SyncConflict.recordType` (new `sync_conflict` column,
  migration `addRecordTypeToSyncConflict`, defaulted to `""` for any pre-migration row) lets the resolver
  look up the right applier without re-parsing `serverRepresentation`.
- **The resolution mechanism itself**: `RemoteSyncEngine+ConflictResolution.swift`, `resolveConflict(_:action:)`
  (new `ConflictResolvingSyncEngine` protocol `RemoteSyncEngine` conforms to — `LocalOnlySyncEngine`
  deliberately does not, since it never records a real conflict to resolve).
  - **Keep server version**: removes the original outbox row FIRST (so the pending-mutation guard every
    `Local*Store.save`/`applyUpsert` already has does not block the very write being asked for), then calls
    the record type's `SyncPullRecordApplier.applyUpsert` if one is registered, decoding
    `serverRepresentation` through a new, promoted-to-public `CoreNetworking.SyncRecordSnapshotDecoding`
    (the exact decode `getChanges` already used, reused rather than duplicated). `observation` has no
    `SyncPullRecordApplier` conformance, so this falls through to a no-op write — discarding the pending row
    is already the whole effect, since there is no local cache to overwrite. Closes the conflict
    immediately; no server round trip.
  - **Reapply local intent**: fetches the retained original operation (new `SyncOutboxStore.fetch(operationId:)`
    — the reason that row is deliberately retained on conflict, per Stage 5a's own comment, finally has a
    reader), asks the record type's new `SyncConflictReplayableApplier.reapplyDraft` for a new payload with
    only `command.expectedRevision` replaced (new `CoreDomain.ConflictResolutionPayloadEditing`, a small
    JSON-envelope edit every one of the four conforming appliers — Garden/Map/Plant/Task — calls; the
    original payload is otherwise untouched byte-for-byte). Removes the stale original operation (it would
    otherwise be resubmitted unchanged by a future `pushPending()` and record a second, redundant conflict —
    a defect caught by the two-step-timing test, not shipped), enqueues the new one tagged
    `resolvesConflictId`, and marks the conflict resolved-but-not-removed via
    `SyncConflictStore.resolve(conflictId:resolutionOperationId:at:)`. The conflict only actually closes once
    that new operation's own push later confirms — proven as two explicit steps in
    `RemoteSyncEngineConflictResolutionTests.reapplyTwoStepTiming`, using a spy `SyncConflictStore` that
    distinguishes "resolved" from "removed" (the two are otherwise indistinguishable through
    `fetchOpen(gardenId:)` alone).
  - **Duplicate as new object**: `gardenObject`-only, `MapSyncRecordApplier`'s new
    `SyncConflictDuplicatingApplier.duplicateDraft` clones THIS DEVICE's own currently cached local row
    (`LocalMapStore.fetchAll(gardenId:)`, filtered to the one target id) into a brand-new `map.createObject`
    command — not a value recomputed from the original command's own payload, which would reintroduce the
    same structural risk `reapplyLocalIntent` already excludes for shape-dependent commands. `nil` for a
    multi-target original (`splitLinework`/`joinLinework`) or when the local row is already gone. Performs
    `resolveKeepingServerVersion`'s own effect on the ORIGINAL record (it is not being superseded), then
    enqueues the new create-shaped operation with the same resolved-not-removed two-step timing as reapply.
  - **Open for manual review**: not a fourth resolver branch — a UI presentation mode
    (`SyncConflictsViewModel.select(_:)`/the compare sheet), matching architecture/offline-
    synchronization.md section 15's own framing; `resolveConflict` throws
    `SyncConflictResolutionError.manualReviewIsNotAResolution` if ever called with it, a defensive backstop
    against a UI bug, not a path any real user action reaches.
- **UI — reachable, not just a backing view model**: new `FeatureSyncConflicts` module (`SyncConflictsView`/
  `SyncConflictDetailView`/`SyncConflictsViewModel`), reachable from `GardenSettingsView` via a new
  `GardenSyncConflictsRoute` (`FeatureGardens`, the same marker-type pattern `GardenTasksRoute`/
  `GardenPlantsRoute`/`GardenObservationsRoute` already use, since `FeatureGardens` cannot depend on
  `FeatureSyncConflicts` either), wired into `AppComposition.RootView`. Deliberately reads
  `CorePersistence.SyncConflictStore.fetchOpen(gardenId:)` directly — the durable source of truth — rather
  than gating on `CoreSynchronization.SyncEngineStatus.requiresAttention`: that status is a coarser,
  ephemeral, per-engine-instance signal for "the last push/pull cycle itself failed" (Stage 5b's own scope),
  a genuinely different and orthogonal condition from "this garden has an open conflict" — a conflict can be
  open with the engine otherwise healthy, and `requiresAttention` can be true with zero open conflicts.
  `requiresAttention` stays exactly as unwired to UI as Stage 5b left it; that remains a real, separate,
  understood gap, not something this stage's own scope covers. The entry point is always reachable (not
  conditionally shown), and an empty conflict list is a normal state, not an error. Detail view is a
  structured side-by-side of the two raw JSON payloads (no geometry-diff rendering — explicitly out of
  scope) plus one button per `conflict.suggestedRecoveryActions`.
- **A real defect caught before shipping, not a hypothetical**: `ConflictResolutionPayloadEditing`'s first
  draft used `guard let x = try foo() else { throw ... }` — Swift only runs a `guard`'s `else` branch when
  the binding is `nil`, never when the `try` itself throws, so a malformed payload propagated
  `JSONSerialization`'s own untyped `NSError` instead of this type's documented, typed error. Caught by
  `ConflictResolutionPayloadEditingTests` on the first `swift test` run; fixed by downgrading the throwing
  call to `try?` before the `guard`.
- **Tests**: `ConflictRecoveryPolicyTests` (every command type against the table above);
  `RemoteSyncEngineConflictResolutionTests` (all three real resolver branches plus the manual-review/
  missing-operation/unsupported-record-type/duplicate-unavailable error paths, with local fakes — not
  `RemoteSyncEngineTests`'s own file-private ones); `reapplyDraft`/`duplicateDraft` coverage added to all
  four existing `*SyncRecordApplierTests` suites; `ConflictResolutionPayloadEditingTests`,
  `SyncRecordSnapshotDecodingTests` (the promoted-to-public decode utility, direct from raw text rather than
  a full HTTP round trip); `SyncConflictsViewModelTests` (load/select/dismiss/resolve, both success and
  failure paths). Final full, unfiltered `swift test` count: 663 tests, 90 suites (up from P5-SEC-01's
  624/85 — 39 new tests, 5 new suites).

**Not done, deliberately**: web continuity (P5-WEB-01), observability (P5-OBS-01), a real geometry-diff
visual renderer (a structured side-by-side of raw payload data is the stated bar for this stage), any
backend change (the conflict shape and recovery-action vocabulary are entirely client-side; the server
already returns everything needed in a `conflict` push result), and re-opening or otherwise unwinding the
ORIGINAL conflict if its own resolution operation later conflicts or is rejected in turn — a real,
understood, separate gap: that scenario produces a second, unrelated `SyncConflict` for the resolution
operation's own new `originalOperationId` through the ordinary conflict-recording path, while the first
conflict's row stays resolved-but-never-removed indefinitely. Left undocumented in code beyond this note
until a real product decision exists for how deep a retry chain should go.

## P5-WEB-01 complete

Implement explicit stale/disconnected states and schema-versioned recoverable drafts for selected
`apps/web/` forms and map sessions — Stage 6, the web-side counterpart to Stages 4a–4e/P5-CONFLICT-01's
native work, deliberately much smaller per architecture/web-application-design.md section "9. Online-First
Behavior" and its own explicit "Full record synchronization in the browser is deferred" boundary. Two
research passes ran before touching anything: grepping for any existing `navigator.onLine`/`online`/
`offline` wiring (none existed) and reading every form/list/detail view and the map editor's command-commit
path to find the actual, current save/error behavior rather than assume it.

- **Connectivity detection reuses TanStack Query's own `onlineManager` singleton** (`@tanstack/react-query`,
  re-exported from `@tanstack/query-core`) rather than a hand-rolled `window.addEventListener('online' |
'offline', …)` pair — confirmed by reading `onlineManager`'s own source first, not assumed: it already
  exists as this application's own dependency, it is already the exact signal the query client uses to
  pause queries/mutations under the default `networkMode: 'online'`, and a second independent listener pair
  risks the two ever disagreeing. New `core/connectivity/network-status.ts` wraps it in one hook,
  `useIsOnline()`, via `useSyncExternalStore` (a consistent server snapshot of `true`, so hydration never
  flashes an offline state).
- **`core/api/failure.ts` gained `isConnectivityFailure(failure)`** (`failure.kind === 'transport'`) — no
  new failure taxonomy needed; the gateway layer already distinguished "the request never reached the API"
  from a contract-level or malformed-response failure, which is exactly the distinction a stale/disconnected
  indicator needs.
- **`shared/ui/stale-indicator.tsx` (`StaleIndicator`)**: a small `Alert`-backed banner, layered over
  already-rendered content rather than replacing it, shown when either `useIsOnline()` is false or a passed-
  in `ApiFailure` is connectivity-classified (covers "browser reachable, API unreachable" too, not just
  `navigator.onLine`). Renders nothing otherwise. Wired into all four named "list/detail" views
  (`features/gardens/garden-list.tsx`, `features/tasks/task-list.tsx`,
  `features/observations/observation-timeline.tsx`, `features/plants/plant-detail.tsx`) and the map editor
  (`features/map/map-editor.tsx`), plus the three drafted create forms (as a plain offline explanation next
  to the disabled submit button, no `failure` prop needed there since forms have no background query of
  their own).
- **A real, pre-existing "existing data replaced by an error screen" defect, found and fixed, not left
  because it predates this work package**: TanStack Query v5's `QueryObserverResult` is a discriminated
  union with `isLoadingError` (failed first load, `data: undefined`) distinct from `isRefetchError` (failed
  _background_ refetch, `data: TData` — the last successful result — still present); confirmed directly by
  reading `query-core`'s own `types.ts`, not assumed from the hook's runtime behavior alone. All four list/
  detail views and the map editor previously branched on the coarser `query.isError` alone and returned a
  full replacement failure screen for _both_ cases, discarding already-loaded, already-server-confirmed data
  the moment a background refetch failed — exactly the failure mode architecture doc section 9's "Existing
  loaded data remains visible with a stale indicator" exists to prevent. Fixed by branching on
  `isLoadingError` for the full-failure state (nothing to preserve) and letting `isRefetchError` fall through
  to the ordinary success rendering with `StaleIndicator` layered on top, plus a small inline `FailureAlert`
  for a _non_-connectivity refetch error (a real server-side problem, e.g. revoked access mid-session, that
  must not be silently swallowed just because it isn't a connectivity failure).
- **Point 4's own audit — "does anything render a mutation as succeeded before the server confirms it" —
  found nothing, verified rather than assumed**: grepped every `setQueryData` call in `apps/web` (nine, across
  `plants`/`gardens`/`map` `queries.ts`) and confirmed each sits inside a mutation's own `onSuccess`; grepped
  for `onMutate` (zero results) — no optimistic-update infrastructure exists anywhere in this codebase yet.
  Every form already correctly gates its "saved"/navigate/reset behavior behind `onSuccess`. This is a
  documented negative finding, not a skipped check.
- **Schema-versioned recoverable local drafts — `core/drafts/`**: `local-draft-store.ts` is a thin
  `localStorage` adapter (`saveLocalDraft`/`loadLocalDraft`/`clearLocalDraft`) storing a
  `{ schemaVersion, draftType, savedAt, payload }` envelope per `(draftType, scopeKey)` key. `localStorage`,
  not IndexedDB, for every draft this pass persists — a deliberate size/lifetime call, documented in that
  file's own doc comment: every draft (form field values, or the map editor's in-progress vertex list) is a
  small, synchronously-serializable JSON value nowhere near `localStorage`'s practical quota; IndexedDB's
  async/larger-capacity/transactional advantages have no payoff at this size and are the right tool for a
  _different_, larger, not-yet-built concern (section 9's "Large imports preserve local recovery metadata" —
  `features/imports` does not exist in this codebase yet). Each draft type owns one `schemaVersion` integer
  constant (e.g. `ADD_PLANT_DRAFT_SCHEMA_VERSION = 1`), incremented whenever that payload's shape changes in
  a way an old stored draft could not be blindly reapplied under — deliberately mirroring the iOS client's
  own `commandVersion`/`<Payload>.version` convention (`CoreDomain/Synchronization`,
  e.g. `GardenSyncCommandPayload.version`) for a client-only concept with no server counterpart. A stored
  draft under a mismatched `schemaVersion` is discarded, never partially applied — proven directly by test.
- **`useRecoverableDraft` (`core/drafts/use-recoverable-draft.ts`)** is the one hook every drafted surface
  shares: on mount, looks for a matching-schema draft and surfaces it once as `recoveredPayload` for the
  caller to apply however its own state is shaped; while `hasUnsavedInput` is true, persists further changes
  debounced (400 ms default); the moment `hasUnsavedInput` turns false, _clears_ the stored draft immediately
  rather than merely stopping further saves — proven by test to matter concretely for the map editor
  (finishing or cancelling an in-progress shape must not leave a stale, later-"recoverable" ghost draft
  behind) — gated behind the initial recovery check completing first (an `isReady` flag), so this self-clear
  cannot race ahead of a real recovery and delete the very draft about to be restored.
- **Restore-automatically-with-a-visible-notice, not offer-to-restore-first — a deliberate, documented
  choice, not the only option.** `recovered` drives `shared/ui/recovered-draft-notice.tsx`
  (`RecoveredDraftNotice`), an `Alert` plus an explicit "Discard recovered draft" action. Reasoning recorded
  in `useRecoverableDraft`'s own doc comment: architecture doc section 11 already establishes the general
  preference ("Preserve user input after recoverable failures", "Avoid clearing a form after an unknown
  mutation outcome"); the friendlier default is getting the user's own typing back without an extra click,
  and the visible notice plus discard action cover "I don't want this" exactly as well as an upfront prompt
  would, without stopping every ordinary fresh-form visit to ask "restore nothing?". The notice itself is
  also what keeps a recovered draft from ever reading as architecture doc section 9's forbidden
  "server-confirmed state before confirmation" — it is always shown as exactly what it is: local, unconfirmed
  input.
- **Forms wired**: the three primary create-entry forms named by the work package's own "plant, observation,
  task forms" wording — `features/plants/add-plant-form.tsx` (including `taxonomyReferenceId`, state React
  Hook Form does not own, merged into the persisted payload alongside the RHF fields), `features/observations
/record-observation-form.tsx` (scoped per `gardenId:fixedPlantId ?? 'garden'`, since a garden-wide and a
  plant-fixed recording session are legitimately independent), `features/tasks/create-manual-task-form.tsx`.
  Deliberately not every edit form (`TaskEditForm`/`TaskRescheduleForm`/`PlantDetailsForm`/`PlantMoveForm`/
  `ObservationCorrectionForm`) — a scoping call, documented rather than silently narrowed: edit forms are
  short, pre-filled from server data, and cheap to redo if lost, unlike a long from-scratch entry; "selected
  forms" is this work package's own title wording, not "every form".
- **Map editor draft — `features/map/use-map-draft-persistence.ts`**: persists only
  `store.state.draftPoints`/`pendingGateGeometry`/`tool` — the map editor's one genuinely in-progress,
  not-yet-committed command state (every _committed_ command already reaches the server directly per
  architecture doc section 10, "Commands are committed at stable interaction boundaries", so there is no
  broader "session" to persist). Selection/camera/layer visibility are ordinary, trivially re-derivable view
  state, not authored work, and are not persisted. On recovery, `store.setTool` is called before
  `setDraftPoints`/`setPendingGateGeometry` deliberately — `setTool`'s own reducer case always resets both as
  part of its "abandon whatever was in progress" behavior, so it must run first, not last.
- **Disable-with-preserved-draft, not queue-and-resubmit — the spec's own default, applied, not the narrow
  carve-out.** No workflow in this pass met the spec's "only for supported draft workflows" bar for an
  explicit queue, so none was built. `map-editor-commit.ts`'s `useCommandCommit` — already documented as "the
  single choke point" for the layer-lock check — gained a second, identical-shaped gate: offline, every
  command it guards (create, move, change-properties, delete, geometry edits, linework, plant assignment,
  duplicate — everything routed through `commit`) is rejected before ever calling `submitMutation.mutateAsync`,
  with a `map.status.offline` status message; the in-progress shape stays exactly where the draft-persistence
  hook above already keeps it recoverable. `stepHistory` (undo/redo, `use-map-editor-actions.ts`) bypasses
  `commit` by its own prior design (a layer lock applied after an edit must not strand undo), so it carries
  the identical offline check directly rather than inheriting it. The three drafted forms disable their
  submit `Button` via `disabled={!isOnline}` (native `disabled`, not the `busy` prop — this is a genuinely
  unavailable action, not a transient in-progress one, and `StaleIndicator` sitting next to it explains why).
  Explicitly _not_ done: relying on TanStack Query's default `networkMode: 'online'` to "handle" offline
  mutations by itself — that default already silently pauses a fired mutation and auto-resubmits it the
  instant connectivity returns, with no visible "waiting" state and no further user action, which is exactly
  the implicit queue-and-resubmit behavior this work package's own scope excludes. Disabling the control
  before `mutate()`/`mutateAsync()` is ever called avoids that path entirely rather than fighting it after the
  fact.
- **Tests — "Browser restart and disconnect tests" (this work package's own completion evidence, taken
  literally)**: `core/connectivity/network-status.test.ts` and `core/drafts/{local-draft-store,
use-recoverable-draft}.test.ts` cover the underlying mechanisms directly (schema-mismatch discard,
  debounced persistence, immediate clear-on-empty, recovery sequencing). Component-level proof that a draft
  survives a simulated reload — unmount, then mount a fresh component instance against the same
  `window.localStorage`, exactly matching how a real browser reload behaves — lives in
  `features/tasks/create-manual-task-form.test.tsx` (plain fields), `features/plants/add-plant-form.test.tsx`
  (the RHF-plus-external-state merge case), and `features/map/use-map-draft-persistence.test.tsx` (map
  geometry, via a real `MapEditorStoreProvider`, not a hand-rolled store double). Offline-disables/
  online-re-enables-without-auto-resubmit is proven at the form level (`create-manual-task-form.test.tsx`/
  `add-plant-form.test.tsx`, toggling `onlineManager.setOnline`, asserting the mutation mock is never called
  on reconnect alone) and at the map-command-choke-point level (`map-editor-commit.test.tsx`'s new
  `describe('useCommandCommit — offline gate …')`, asserting `mutateAsync` is never invoked while offline).
  `garden-list.test.tsx` proves the fixed stale-data-visibility defect directly, distinguishing
  `isLoadingError` (full failure state) from `isRefetchError` (data stays visible, `StaleIndicator` shown).
  Final `apps/web` Vitest count: 338 tests, 40 files (up from 298/32 before this stage — 40 new tests, 8 new
  files; every pre-existing test still green, zero regressions).
- Verification run beyond the new tests themselves: `pnpm --filter @verdery/web build` (production build,
  succeeds), `pnpm --filter @verdery/web test`, root `pnpm typecheck` (all six workspaces), `pnpm format:check`,
  `pnpm lint`, `node scripts/check-file-size.mjs` — all clean.

**Not done, deliberately**: any native-style outbox/local-database/push-pull mechanism (explicitly out of
scope — see this work package's own bounding text); a new client-side conflict-resolution UI (P5-CONFLICT-01
is iOS-only by the spec's own design); backend changes (none needed — every touched form/command already
sent whatever `expectedRevision`/idempotency key it always did; a resubmitted recovered draft is an ordinary
mutation like any other, and a stale-revision rejection is already-correct pre-existing server behavior, not
a new conflict path); a stale-indicator/draft treatment for every remaining mutation surface in the app
(`features/gardens/garden-settings.tsx` shows the identical `isError`-hides-data pattern this stage fixed
elsewhere, and task-row's complete/skip/dismiss/delete and the plant lifecycle/move forms have no offline
gate — both real, understood, left-for-a-future-pass gaps, not silently missed: the work package's own title
says "selected forms and map sessions", and `garden-settings.tsx` in particular is a straightforward,
narrow follow-up using the exact same `isLoadingError`/`isRefetchError` pattern already proven here).

# Phase 5 — Native Offline Synchronization and Web Continuity, implementation complete, G5 pending

Scope: every Phase 5 work package, P5-DATA-01 through P5-QA-01. Native user changes survive
disconnection and process termination, synchronize idempotently, and expose recoverable conflicts.
Web stays online-first, preserving approved drafts and reusing server revisions and conflict rules
rather than building its own sync path.

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 14. This section
summarizes and cross-references the fifteen dated stage sections above (the planning entry, Stages
4a–4e, "P5-IOS-02 complete", "P5-IOS-03 complete", "P5-SEC-01 complete", "P5-CONFLICT-01 complete",
"P5-WEB-01 complete") plus this session's P5-OBS-01 and P5-QA-01 work, rather than repeating their
detail. Read those sections for the full account of any item below.

## Tasks

### Backend

- [x] P5-DATA-01 `platform.sync_change` (a real Phase 2 skeleton, unused until this phase) wired into
      every mutating command across `gardens-mapping`, `plants-inventory`, `observations-history`,
      `tasks-recommendations` via a new platform-level `platform/sync/` port, promoted from
      `gardens-mapping`'s own first, incomplete, module-local attempt
- [x] P5-API-01 the full `Synchronization` OpenAPI tag: client registration, push, pull, acknowledge —
      including a real, documented resolution of `POST /sync/acknowledge`'s genuine, otherwise
      unexplained spec gap
- [x] P5-BE-01 dependency-aware push batch processing (a real topological pass, not an approximation),
      five of six push outcomes with real producers (`retryLater` honestly left unreachable — no
      command in this codebase throws `DependencyUnavailableError`), idempotency-by-operationId reusing
      the existing `platform.idempotency_record`/`IdempotencyStore` rather than a new table
- [x] P5-BE-02 deterministic incremental pull (profile-scoped, not per-garden — a real correction found
      by direct contract inspection during Stage 5b, not assumed from earlier stages' own doc comments),
      initial sync and full resync both resolved as the same call with an omitted cursor (no separate
      endpoint), revocation-tombstone visibility correctly preserved even for a profile whose membership
      has already gone non-active

### iOS

- [x] P5-IOS-01 `CorePersistence`/`CoreSynchronization` — six new local tables, a GRDB migrator
      continuing (not replacing) `FeatureGardens`'s existing schema, `SyncEngine`'s generic seam
- [x] P5-IOS-02 all five features (Gardens, Map, Plants, Observations, Tasks — Stages 4a–4e) routed
      through atomic local-projection-plus-outbox transactions; Map's retrofit found and fixed a real
      Phase 3 gap (no actual local command-application logic existed, only gesture-preview math);
      Observations' append-only shape correctly got a simpler, genuinely different commit method
      instead of a mechanical copy of the mutable-record pattern
- [x] P5-IOS-03 the real bounded push/pull engine (Stages 5a–5b): `SyncGateway`, the
      `SyncRecordApplier`/`SyncPullRecordApplier` seam keeping `CoreSynchronization` free of any
      `Feature*` import, exponential backoff with jitter, `Retry-After` honored, a five-of-six-term
      status model
- [x] P5-CONFLICT-01 all four recovery actions (keep server, reapply, duplicate, manual review) with a
      real per-command-type "safely replayable" table verified against every payload shape, deferred
      conflict closure proven as an explicit two-step timing test, a reachable conflict list/detail UI
- [x] P5-SEC-01 cascade removal of a revoked garden's data across all five local tables plus its
      still-pending outbox operations, via a generic per-applier seam; the named "offline removal
      attack" test proving the actual security boundary (one offline session, closed at the next pull)

### Web

- [x] P5-WEB-01 the fully bounded spec (stale indicator, schema-versioned recoverable drafts for three
      forms and the map editor, disable-not-queue while offline) — plus a real, pre-existing defect
      found and fixed along the way (every list/detail view discarded already-loaded data behind a full
      error screen on any background refetch failure, not just a first-load failure)

### Observability and quality

- [x] P5-OBS-01 payload-free structured logging for push outcomes, pull lag, and full-resync triggers;
      an honest account of what has no producer yet (revocation cleanup); a concrete, non-deployed
      dashboard/alert-candidate writeup calibrated against Phase 1's own delivered bar for a "-01"
      observability work package
- [x] P5-QA-01 an 18-item testing-matrix assessment before writing anything new; genuine gaps closed
      (randomized convergence, clock skew precisely scoped to where the protocol actually uses time,
      large backlog on both push and pull, schema upgrade with a populated outbox, process termination
      with a corrected understanding of the real safety mechanism); two real defects found and
      deliberately left unfixed pending a product/architecture decision (see Known limitations)

## Deferred with reason

| Item                                                                                                      | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membership/account revocation itself (the command)                                                        | A genuine, pre-existing, product-wide gap confirmed by inspection during both P5-BE-02 and P5-SEC-01: `MembershipRepository` exposes only `insertOwner`; nothing anywhere transitions a membership row to `'removed'`. Not this phase's to build — P5-SEC-01/P5-BE-02 both made the sync protocol _correct in advance_ for the day a revocation command exists, verified with tests that manually drive the state a real revocation would produce. |
| Sign-out clearing local sync data                                                                         | Investigated during P5-SEC-01: no sign-out flow exists anywhere in this codebase yet (`AuthenticationGateway.signOut()` has zero callers, no Settings/Shell UI triggers it) — real, separate cross-module work with no UI trigger yet to hang it off, not a minimal addition.                                                                                                                                                                      |
| Three testing-matrix items needing organizations/client engagements/publications                          | Confirmed by grep: no organization, client-engagement, or publication concept exists anywhere in this codebase. Owned by Phase 9's own not-yet-started work packages, not fakeable here without building the underlying feature first.                                                                                                                                                                                                             |
| Media upload before/after record sync (testing-matrix item)                                               | The same, already-repeatedly-documented media-upload gap this whole session has tracked since Phase 4 — owned by `P6-API-01`.                                                                                                                                                                                                                                                                                                                      |
| Auth/authorization/validation failures retried like transient failures                                    | A real defect found during P5-QA-01: `RemoteSyncEngine`'s whole-push-call failure path records any `APIGatewayError`'s category but never gates retry eligibility on it, in tension with architecture section 20's "do not retry automatically as transient failures" — a rule the per-operation push-outcome path already correctly honors. Needs a product/architecture decision, not a QA-stage fix; see Known limitations.                     |
| P5-CONFLICT-01's multi-write resolution paths are not one shared transaction                              | Also found during P5-QA-01: `resolveKeepingServerVersion`/`resolveReapplyingLocalIntent`/`resolveDuplicatingAsNewObject` each issue several independent store writes. A crash between them is a real, narrow window; restructuring it is an architecture change requiring approval, not built here.                                                                                                                                                |
| `garden-settings.tsx`'s stale-data-visibility gap, task-row actions, and plant lifecycle/move forms (web) | P5-WEB-01's own title says "selected forms and map sessions" — `garden-settings.tsx` has the identical `isError`-hides-data pattern already fixed everywhere else, a narrow, understood follow-up using the exact same proven fix.                                                                                                                                                                                                                 |
| G5 approval                                                                                               | A repository-owner decision, not an automatic consequence of implementation and test evidence — see Review below.                                                                                                                                                                                                                                                                                                                                  |

## Review

Every Phase 5 work package is implemented and verified against real systems: real PostgreSQL
(Testcontainers integration tests throughout, plus the real `verdery-dev` Cloud SQL instance for every
migration in this phase), Swift built and tested against CI's own pinned toolchain at every stage, and
a real Next.js production build for the web work. G5 approval itself is a decision for the repository
owner to record, not something this session claims on its own.

### Verified evidence

| Check                                                    | Result                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:all`                                         | passes: format, lint, typecheck (6/6 workspace packages), the 600-line file-size rule, **963 tests across 130 files** (`services/api` 478, `apps/web` 338, `geometry-contracts` 96, `test-fixtures` 18, `api-contracts` 29, `services/workers` 4)                                                                          |
| `swift build && swift test` (apps/ios, full, unfiltered) | **674 tests, 93 suites**, clean — both locally (no SIGBUS flake on the runs this session's final stages used) and on CI's own pinned toolchain (`gh run view --job=89347511390`: "Test run with 674 tests in 93 suites passed")                                                                                            |
| CI on `master` (`66892f3`, all gates)                    | passes: secret scan, formatting/file-size, Swift package (full suite), lint/types/tests, all-gates summary                                                                                                                                                                                                                 |
| Real `verdery-dev` deploys, every migration this phase   | `1785000000000_synchronization-baseline.sql` (client installations) applied and verified via a real Cloud Run migration-job execution and a full `Deploy to development` run, including the live-request check                                                                                                             |
| Backend contract                                         | `pnpm --filter @verdery/api-contracts lint:contract && generate:check` clean at every stage; a dedicated contract test (`SyncRecordType parity`) cross-checks the generated schema against `services/api/src/platform/sync/sync-record-type.ts`'s real source directly, since the DB column itself has no CHECK constraint |
| Architecture dependency rules (iOS)                      | `swift test --filter DependencyRuleTests`: all 4 pass — confirmed by grep and by this automated suite that no `Feature*` module is ever imported under `CoreSynchronization`/`CoreNetworking`/`CorePersistence`, the single most important structural constraint this phase's engine design depended on                    |

### Defects found and fixed during this session

1. **`platform.sync_change`'s only prior writer (`gardens-mapping`) was module-local and incomplete.**
   4 of its 16 commands (Garden lifecycle) never wrote a sync_change row at all. Promoted to a
   platform-level port mirroring `platform/outbox/`'s own shape and wired into all 4 missing commands
   plus 19 more across 3 other modules.
2. **Three photo/file-attachment commands (`AttachPlantPhoto`, `SetPrimaryPlantPhoto`,
   `AttachTaskFile`) never bumped their owning aggregate's revision**, so nothing would have emitted a
   sync_change row recording that a new photo/attachment existed. Each now writes one directly using
   the aggregate's already-fetched, unbumped revision — a true statement of the record's revision at
   that moment, not an incremented lie.
3. **`pg_trgm` (from the immediately-preceding Phase 4 work, surfaced during this phase's first real
   deploy) needed database-level `CREATE`, which the least-privilege migration identity lacked** —
   found via a real failed `verdery-dev` deploy, root-caused with a local non-superuser Postgres
   reproduction before touching live infrastructure, fixed with a narrow, targeted grant, applied for
   real and verified via a live migration-job re-execution and a full deploy re-run.
4. **8 already-shipped Phase 3/4 creation commands across 5 modules had no way to accept a
   client-generated id**, blocking offline optimistic creation entirely. Retrofitted with an optional
   id parameter, verified byte-for-byte non-breaking for every existing REST caller (their idempotency
   fingerprints never change, since `JSON.stringify` drops an always-`undefined` field).
5. **`FeatureMap`'s Phase 3 doc comment's own claim — "no optimistic local mutation" — undersold a
   deeper gap**: no actual local command-application logic existed at all for several commands
   (`editVertex` insert/remove, `splitLinework`, `joinLinework`, `assignPlant`), only gesture-preview
   geometry math. Written fresh, mirroring the backend's own geometry primitives and per-command
   handlers line-for-line (verified, not assumed — `splitLineString`'s exact boundary condition and
   slice points, `joinLineStrings`' exact overlap-detection, both confirmed byte-identical to the TS
   source). Also fixed a real, pre-existing inaccuracy in `CoreDomain.MapCommandResult`'s own doc
   comment (claimed `joinLinework` affects "two" objects; the real backend handlers return three).
6. **`CorePersistence.SyncCursorStore` was built "one per garden partition" in Stage 3, ahead of any
   real consumer, and was wrong** — direct inspection of the shipped `GET /sync/changes` contract
   during Stage 5b proved pull is profile-scoped, exactly like push. Corrected via a new migration that
   drops and recreates the table (safe: nothing real ever wrote the old shape), eliminating an entire
   unnecessary "which gardens does this device care about" mechanism.
7. **`Tasks`' local list read-model had a real, undiscovered data-loss bug waiting to happen**: writing
   a server-side status-filtered fetch straight through `replaceAll` would have silently deleted every
   task outside the filter from local storage the first time a filtered list loaded. Found and fixed
   before it ever shipped, by only write-through on an unfiltered fetch.
8. **A Swift `guard let x = try foo() else` bug** in the conflict-resolution payload editor — this
   pattern only runs its `else` branch when `foo()` returns `nil`, never when it throws, so a malformed
   stored payload would have leaked `JSONSerialization`'s own untyped `NSError` instead of the
   documented typed command error. Caught by the new tests on first run, fixed by downgrading to `try?`
   before the guard.
9. **Every web list/detail view and the map editor discarded already-loaded data behind a full error
   screen on any background refetch failure**, not just a genuine first-load failure — directly
   contradicting architecture section 9's own first bullet ("existing loaded data remains visible with
   a stale indicator"). Fixed using TanStack Query's `isLoadingError`/`isRefetchError` distinction.
10. **`PushSyncOperations` never checked the sync protocol version**, despite the OpenAPI operation's
    own `409` response documenting `sync.protocol_version.unsupported` identically to `GetSyncChanges`,
    which does check it — found while verifying P5-OBS-01's new logging, fixed with the same one-line
    call `GetSyncChanges` already makes (currently unreachable over real HTTP either way, since the
    wire schema's own `minimum: 1` matches today's floor — a genuine contract-consistency fix, not a
    live behavior change, until a future protocol version bump makes it reachable).
11. **A server-side crash-window claim in `push-sync-operations.ts`'s own header comment was proven,
    not just trusted** — and the mechanism that actually keeps a crash-then-retry safe turned out to be
    a second, independent per-command idempotency layer neither this session's own first test draft nor
    the original comment had fully accounted for, corrected once the real behavior was observed.

### Known limitations

- **Membership/account revocation has no real producer anywhere in this codebase.** P5-BE-02 and
  P5-SEC-01 both made the sync protocol and the client's local-removal reaction _correct in advance_,
  verified with tests that manually drive the state a real revocation command would produce — but nothing
  in this codebase can revoke membership today. See Deferred with reason.
- **An authentication/authorization/validation failure on a whole push call is currently retried the
  same as a genuine transient failure**, once backoff elapses — in tension with architecture section
  20's own words. The per-operation push-outcome path already correctly distinguishes these; the
  whole-call transport-failure path does not yet. Needs a product/architecture decision on the intended
  behavior (e.g., should this require explicit user re-authentication before any retry?), not a
  QA-stage fix — see `RemoteSyncEngineFailureCategoryTests.swift`'s own header comment for the precise
  account.
- **P5-CONFLICT-01's three resolution paths are not one shared GRDB transaction.** A crash between
  their several independent store writes is a real, narrow, understood window (an outbox row removed
  but the local record not yet updated to the server's version) — restructuring this is an architecture
  change requiring approval, not built here.
- **Three testing-matrix items and one prior-phase gap remain genuinely untestable/unbuilt**:
  organization-membership, client-engagement, and publication-revocation scenarios (Phase 9, not
  started); media upload before/after sync (Phase 6, not started, already tracked since Phase 4).
- **Web's stale-indicator/draft treatment covers three forms and the map editor, not every mutation
  surface.** `garden-settings.tsx` has the identical, already-solved `isError`-hides-data pattern;
  task-row actions and the plant lifecycle/move forms have no offline gate yet. All three are narrow,
  understood follow-ups using patterns this phase already proved, not silently missed gaps.
- **The local `swift test` SIGBUS flake** (root-caused and CI-confirmed benign since Phase 3/4, see
  `apps/ios/README.md`) remains present and unrelated to any Phase 5 change; every stage's own
  verification either avoided it entirely or explicitly noted CI as the authoritative signal on the
  rare run that hit it.
- **`docs/implementation-plan.md`'s Phase 5 status table entry was stale before this session began**
  (recorded "not started" despite P5-IOS-01 through P5-BE-02 already being implemented) — corrected as
  part of this review, not a new discrepancy introduced here.

# Phase 6 — Media, Photos, and Property-Plan Import, planning

Scope: every Phase 6 work package, P6-PLAT-01 through P6-QA-01. Native and web clients upload ordinary
photos and sensitive property plans directly and recoverably; the system verifies, derives, authorizes,
retains, and deletes media correctly; users preview, calibrate, trace, hide, and revisit plan
backgrounds.

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 15;
[architecture/media-storage-and-processing.md](../docs/architecture/media-storage-and-processing.md)
(the primary spec — sections 3, 6, 7, 8, 11, 15, 21 named explicitly, read in full);
[architecture/garden-capture-and-scan.md](../docs/architecture/garden-capture-and-scan.md) section 8;
[architecture/map-rendering-and-editing.md](../docs/architecture/map-rendering-and-editing.md) section 16.

This is the heaviest-infrastructure phase yet — real private Cloud Storage buckets, resumable direct
uploads, async verification/processing workers (Cloud Tasks/Cloud Run Jobs), malware scanning,
image/video/PDF derivative generation, and a full retention/deletion lifecycle, not application code
alone. Two things are already known before any implementation starts:

- **What already exists**: Phase 4's `media` module is deliberately minimal — `media.media_record`
  (id, storage_reference, mime_type, uploaded_by_profile_id, created_at) and exactly one command,
  `RegisterMediaRecord`. No upload authorization, verification, state machine, derivatives, or
  retention exist yet — this phase grows that stub into the real thing, not a parallel module.
- **P6-PLANT-01 is blocked the same way P4-OBS-01 was**: it depends explicitly on `P0-PROV-01`
  ("Evaluate map/imagery, geocoding, weather, plant content/identification... candidates"), which
  remains undecided (Phase 0 is still "Partially decided" and this specific sub-decision was never
  resolved). Documented as a deferral once reached, not built with an invented ML vendor — matching
  `identifyPlantFromPhoto`'s existing honest-placeholder precedent from Phase 4.
- **Malware scanning (section 8) has no evaluated provider either** — no decision anywhere in this
  codebase names a scanning service (Cloud-native or third-party). This is a real, separate security
  gap from the photo-ID question, worth the same honest-placeholder treatment if no provider surfaces
  during implementation, not silent omission or a fabricated integration.
- **Real cloud infrastructure provisioning (`P6-PLAT-01`: new buckets, lifecycle rules, IAM) needs a
  confirmation gate before anything is created against the live `verdery-dev` project**, matching this
  session's own established precedent (the Phase 5 `pg_trgm` privilege grant) — planned and built
  behind a real port/adapter first, so everything except the live bucket creation itself can be
  developed and verified without it.

## Planned stages (dependency-ordered, matching the work package table)

1. **Media data model** (P6-DATA-01): identity, ownership, class, checksum, upload/processing/retention
   state machine, variants, relationships, quota reservations — grown from the existing minimal
   `media.media_record`. Pure PostgreSQL + application logic, fully testable via Testcontainers, no
   live infrastructure needed.
2. **Storage provisioning** (P6-PLAT-01): the four private buckets (user-media, raw-capture, derived,
   exports), public-access prevention, lifecycle shells — built as idempotent gcloud scripts matching
   `infrastructure/gcloud/scripts/`'s existing conventions, with the actual live provisioning gated on
   explicit confirmation before running against `verdery-dev`.
3. **Upload API** (P6-API-01): registration, authorized resumable session creation, completion
   verification, status, short-lived authorized access — behind a real storage port with a fake
   adapter for tests, the same port-plus-adapter-plus-fake pattern every module in this codebase
   already uses, so the application layer is fully testable before real buckets exist.
4. **Async processing foundation** (P6-ASYNC-01): transactional outbox relay and Cloud Tasks paths for
   verification/derivative jobs, durable job state.
5. **Validation and derivative workers** (P6-WORKER-01/02): MIME signature, size, dimension/duration,
   checksum, parser-bomb protection, malware-scanning placeholder (see above); idempotent thumbnails,
   screen previews, metadata stripping, PDF page previews, plan tiles.
6. **Clients** (P6-IOS-01, P6-WEB-01): background-capable upload coordination, local durability,
   progress/pause/retry/recovery on iOS; direct resumable upload with recoverable browser metadata on
   web.
7. **Property-plan import and calibration** (P6-PLAN-01/02): document selection, safety validation,
   page/perspective handling; known-distance calibration, residual error, trace tools, plan-to-map
   transforms — reusing Phase 3's map command model, not a parallel one.
8. **Photo identification** (P6-PLANT-01): deferred with reason, per above, unless `P0-PROV-01`
   resolves during this phase.
9. **Retention, observability, QA** (P6-RET-01, P6-OBS-01, P6-QA-01): deletion workflow and orphan
   reconciliation; upload/verification/processing/stored-byte/deletion dashboards, calibrated against
   this session's own established "-01 observability" delivery bar; the full required testing matrix
   (unauthorized cross-garden access, malformed inputs, parser limits, signed-access expiry, plan
   accuracy labels).

Each stage will be committed, pushed, and CI-confirmed-green independently, matching the pattern
established in every prior phase — not one single end-of-phase commit.
