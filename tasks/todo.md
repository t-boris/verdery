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
