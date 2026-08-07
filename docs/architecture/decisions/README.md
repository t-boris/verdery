# Architecture Decision Records

> Status: Active  
> Last updated: July 29, 2026

## Purpose

Architecture decision records preserve the context, choice, consequences, and supersession path for material Grow Garden decisions.

## Status Values

- **Proposed**: under review and not authoritative.
- **Accepted**: approved and authoritative.
- **Superseded**: replaced by a later ADR.
- **Rejected**: considered but not selected.

## Decision Index

| ADR                                                                      | Decision                                                                                       | Status                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| [ADR-0001](ADR-0001-monorepo-and-client-separation.md)                   | Monorepo with separate native and web clients                                                  | Accepted                            |
| [ADR-0002](ADR-0002-firebase-google-cloud-and-postgresql.md)             | Firebase and Google Cloud with PostgreSQL/PostGIS authority                                    | Accepted                            |
| [ADR-0003](ADR-0003-modular-monolith-and-rest-api.md)                    | Fastify modular monolith and REST/OpenAPI                                                      | Accepted                            |
| [ADR-0004](ADR-0004-application-owned-offline-sync.md)                   | GRDB/SQLite and application-owned offline synchronization                                      | Accepted                            |
| [ADR-0005](ADR-0005-dual-space-geospatial-model.md)                      | Local planar geometry with optional WGS84 georeferencing                                       | Accepted                            |
| [ADR-0006](ADR-0006-google-cloud-asynchronous-primitives.md)             | Cloud Tasks, Pub/Sub, Cloud Run Jobs, and transactional outbox                                 | Accepted                            |
| [ADR-0007](ADR-0007-us-central1-production-baseline.md)                  | United States market and `us-central1` production baseline                                     | Accepted                            |
| [ADR-0008](ADR-0008-rules-first-recommendations-and-vertex-ai.md)        | Rules-first recommendations with Vertex AI explanations                                        | Accepted                            |
| [ADR-0009](ADR-0009-toolchain-and-platform-baseline.md)                  | Toolchain and platform version baseline                                                        | Accepted                            |
| [ADR-0010](ADR-0010-local-coordinate-space-and-geometry-tolerances.md)   | Local coordinate space representation and geometry tolerances                                  | Accepted                            |
| [ADR-0011](ADR-0011-gcloud-scripts-instead-of-terraform.md)              | Idempotent gcloud scripts instead of Terraform for initial infrastructure                      | Accepted                            |
| [ADR-0012](ADR-0012-separate-team-and-client-sharing.md)                 | Separate operational team access from client publications                                      | Accepted                            |
| [ADR-0013](ADR-0013-ai-assisted-care-content-authoring.md)               | AI-assisted care content authoring, never runtime care authority                               | Accepted                            |
| [ADR-0014](ADR-0014-phase-10-capture-research-gate.md)                   | Phase 10 capture research gate: dataset plan and draft thresholds                              | Superseded (partially, by ADR-0015) |
| [ADR-0015](ADR-0015-phase10-redirect-plants-over-photo-capture.md)       | Redirect Phase 10: real plant identification over photo-based garden-object capture            | Accepted                            |
| [ADR-0016](ADR-0016-phase-11-plant-intelligence-domain-and-providers.md) | Phase 11 domain freeze: actual/candidate semantics, health-suggestion safety, provider mapping | Accepted                            |
| [ADR-0017](ADR-0017-pdf-plans-rendered-without-a-malware-scanner.md)     | PDF plans rendered by poppler in the worker; malware-scanner port removed                      | Accepted                            |
| [ADR-0018](ADR-0018-plat-extraction-as-reviewable-proposals.md)          | A surveyor's plat is read into reviewable proposals, never into accepted geometry              | Accepted                            |
| [ADR-0019](ADR-0019-the-apple-surface-narrows-to-iphone.md)              | The Apple client targets iPhone only; iPad returns, if ever, as its own designed surface       | Accepted                            |

## Naming

Use `ADR-NNNN-short-decision-name.md`. ADR numbers are immutable and never reused.
