# Architecture Decision Records

> Status: Active  
> Last updated: July 21, 2026

## Purpose

Architecture decision records preserve the context, choice, consequences, and supersession path for material Grow Garden decisions.

## Status Values

- **Proposed**: under review and not authoritative.
- **Accepted**: approved and authoritative.
- **Superseded**: replaced by a later ADR.
- **Rejected**: considered but not selected.

## Decision Index

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](ADR-0001-monorepo-and-client-separation.md) | Monorepo with separate native and web clients | Accepted |
| [ADR-0002](ADR-0002-firebase-google-cloud-and-postgresql.md) | Firebase and Google Cloud with PostgreSQL/PostGIS authority | Accepted |
| [ADR-0003](ADR-0003-modular-monolith-and-rest-api.md) | Fastify modular monolith and REST/OpenAPI | Accepted |
| [ADR-0004](ADR-0004-application-owned-offline-sync.md) | GRDB/SQLite and application-owned offline synchronization | Accepted |
| [ADR-0005](ADR-0005-dual-space-geospatial-model.md) | Local planar geometry with optional WGS84 georeferencing | Accepted |
| [ADR-0006](ADR-0006-google-cloud-asynchronous-primitives.md) | Cloud Tasks, Pub/Sub, Cloud Run Jobs, and transactional outbox | Accepted |
| [ADR-0007](ADR-0007-us-central1-production-baseline.md) | United States market and `us-central1` production baseline | Accepted |
| [ADR-0008](ADR-0008-rules-first-recommendations-and-vertex-ai.md) | Rules-first recommendations with Vertex AI explanations | Accepted |

## Naming

Use `ADR-NNNN-short-decision-name.md`. ADR numbers are immutable and never reused.
