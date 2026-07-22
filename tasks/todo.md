# Phase 1 — Engineering Foundation (Increments 1–2)

Scope approved by the repository owner: implementation plan Phase 1 work packages that are
buildable without cloud credentials. `P1-PLAT-02` and `P1-PLAT-03` are deferred because they
require a real Google Cloud organization and billing.

Source: [docs/implementation-plan.md](../docs/implementation-plan.md) section 10.

## Phase 0 decisions approved for this scope

| Decision                | Value                                                                          | Work package unblocked |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| Node.js runtime         | 24 LTS "Krypton"                                                               | P0-PLAT-01             |
| PostgreSQL / PostGIS    | 17 / 3.5                                                                       | P0-PLAT-01             |
| Apple deployment target | iOS/iPadOS 18.0, SDK iOS 26, Swift 6.3                                         | P0-CLIENT-01           |
| Browser baseline        | last 2 Chrome/Edge/Firefox, Safari 17+                                         | P0-CLIENT-01           |
| Local planar space      | PostGIS SRID 0 plus `coordinate_space_id`                                      | P0-MAP-01              |
| Coordinate precision    | round to 1 mm on write                                                         | P0-MAP-01              |
| Curve persistence       | polyline approximation plus retained control points, 10 mm max chord deviation | P0-MAP-01              |
| Geometry tolerances     | vertex 1 mm, polygon 0.01 m², line 0.05 m, coordinate limit 10 km, snap 12 px  | P0-MAP-01              |

Recorded as [ADR-0009](../docs/architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md)
and [ADR-0010](../docs/architecture/decisions/ADR-0010-local-coordinate-space-and-geometry-tolerances.md).

## Tasks

### Foundation

- [x] ADR-0009 toolchain and platform version baseline
- [x] ADR-0010 local coordinate space and geometry tolerances
- [x] P1-REPO-01 monorepo directory structure
- [x] P1-REPO-02 workspaces, formatting, linting, type checking, file-size enforcement

### Contracts

- [x] P1-CONTRACT-01 OpenAPI `/v1` governance: error envelope, UUIDv7, timestamps, pagination, idempotency, revision headers
- [x] P1-CONTRACT-02 language-neutral geometry fixtures consumed by TypeScript and Swift

### Data

- [x] P1-DATA-01 reviewed SQL migration system, PostGIS extension, roles, migration tests

### Runtime shells

- [x] P1-BE-01 Fastify composition root, config validation, health checks, typed errors, database adapter, module boundaries
- [x] P1-WEB-01 Next.js shell, localization, design-system foundation, error boundaries, typed API gateway
- [x] P1-IOS-01 SwiftUI composition, Core packages, feature template, localization, dependency rules

### Quality and documentation

- [x] P1-QA-01 CI gates: lint, typecheck, unit tests, migrations, OpenAPI, generated clients, secrets
- [x] P1-DOC-01 local setup, migrations, contracts, and emergency-change documentation

## Deferred with reason

| Work package | Reason                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| P1-PLAT-01   | Terraform is not installed locally; modules cannot be validated           |
| P1-PLAT-02   | Requires a real Firebase/Google Cloud organization                        |
| P1-PLAT-03   | Requires workload identity federation against a real cloud project        |
| P1-OBS-01    | OpenTelemetry wiring is written but cannot export without a cloud project |

## Review

All Phase 1 work packages in scope are implemented and verified.

### Verified evidence

| Check                                            | Result                                                    |
| ------------------------------------------------ | --------------------------------------------------------- |
| `pnpm check:all`                                 | passes: format, lint, typecheck, 600-line rule, 163 tests |
| `swift build && swift test` (apps/ios)           | passes: 49 tests                                          |
| `pnpm --filter @verdery/web build`               | passes: production build, 3 routes                        |
| Migration tests against `postgis/postgis:17-3.5` | passes: 7 tests, real PostgreSQL 17 and PostGIS 3.5       |
| Cross-runtime geometry equivalence               | Swift and TypeScript agree on all shared fixtures         |

### Defects found and fixed during review

Each track was reviewed by an independent agent instructed to disprove the
implementer's claims. Five blocking defects were found and fixed:

1. **Curve densification exceeded its own tolerance.** Subdivision count was
   derived from an assumed inverse-square error law. An S-shaped segment
   deviated 14.5 mm against a 10 mm contract. Replaced with adaptive de
   Casteljau subdivision using a convex-hull flatness test, which is a true
   upper bound. The failing shape is now a fixture case.
2. **The down migration could not run.** `DROP EXTENSION postgis` aborts because
   the pinned image preinstalls dependent extensions, and node-pg-migrate wraps
   the migration in one transaction, so the rollback left roles behind. PostGIS
   is now deliberately left installed, with the reasoning recorded in the file.
3. **Migration tests passed only because Docker was stopped.** The pinned image
   publishes a linux/amd64 manifest only; on arm64 the suite failed as soon as
   Docker ran. The platform is now requested explicitly.
4. **An idle database connection killed the process.** No `error` listener was
   attached to the pg pool, so Node treated the event as fatal, bypassing
   graceful shutdown and readiness reporting. Reproduced by killing the database
   container, then fixed.
5. **CI could never run, and would have reported success anyway.** The workflow
   triggered on `main` while the repository's default branch is `master`, and
   the aggregating `gates` job did not depend on `changes`, so a broken
   change-detection step would present a green required check.

### Known limitations

- Node 24 is required by ADR-0009; this machine runs 22.22.3, so every pnpm
  command prints an engine warning. Everything builds and tests regardless.
- `services/api` declares a `migrate` script passing `--envPath .env`, but
  `dotenv` is not installed, so the flag is ignored. Setting `DATABASE_URL` in
  the shell is the documented path.
- Renaming the default branch from `master` to `main` would be reasonable, but
  it must change on the remote and in `ci.yml` in the same commit.
