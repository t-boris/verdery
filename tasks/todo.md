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
