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

- [ ] ADR-0009 toolchain and platform version baseline
- [ ] ADR-0010 local coordinate space and geometry tolerances
- [ ] P1-REPO-01 monorepo directory structure
- [ ] P1-REPO-02 workspaces, formatting, linting, type checking, file-size enforcement

### Contracts

- [ ] P1-CONTRACT-01 OpenAPI `/v1` governance: error envelope, UUIDv7, timestamps, pagination, idempotency, revision headers
- [ ] P1-CONTRACT-02 language-neutral geometry fixtures consumed by TypeScript and Swift

### Data

- [ ] P1-DATA-01 reviewed SQL migration system, PostGIS extension, roles, migration tests

### Runtime shells

- [ ] P1-BE-01 Fastify composition root, config validation, health checks, typed errors, database adapter, module boundaries
- [ ] P1-WEB-01 Next.js shell, localization, design-system foundation, error boundaries, typed API gateway
- [ ] P1-IOS-01 SwiftUI composition, Core packages, feature template, localization, dependency rules

### Quality and documentation

- [ ] P1-QA-01 CI gates: lint, typecheck, unit tests, migrations, OpenAPI, generated clients, secrets
- [ ] P1-DOC-01 local setup, migrations, contracts, and emergency-change documentation

## Deferred with reason

| Work package | Reason                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| P1-PLAT-01   | Terraform is not installed locally; modules cannot be validated           |
| P1-PLAT-02   | Requires a real Firebase/Google Cloud organization                        |
| P1-PLAT-03   | Requires workload identity federation against a real cloud project        |
| P1-OBS-01    | OpenTelemetry wiring is written but cannot export without a cloud project |

## Review

To be completed when the tasks above are done.
