# Backend Modular Monolith Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the detailed structure of the interactive Grow Garden backend. The service is a TypeScript modular monolith running as a stateless Fastify container on Cloud Run.

## 2. Goals

- Keep domain behavior cohesive and independently testable.
- Preserve simple deployment and transactional behavior during early product development.
- Prevent a layered monolith with unrestricted table and service access.
- Support independently scaled Python and TypeScript workers.
- Make eventual service extraction possible without designing a distributed system prematurely.

## 3. Runtime Topology

```text
Global HTTPS Load Balancer
          │
     Cloud Armor
          │
          ▼
   Cloud Run API
   Fastify container
          │
     ┌────┼─────────┐
     ▼    ▼         ▼
 Cloud SQL  Cloud Tasks  Cloud Storage control plane
```

The API is stateless between requests. Durable state belongs in PostgreSQL, Cloud Storage, or approved asynchronous services.

## 4. Source Structure

```text
services/api/src/
├── bootstrap/
├── platform/
│   ├── configuration/
│   ├── database/
│   ├── authentication/
│   ├── telemetry/
│   ├── messaging/
│   └── storage/
├── modules/
│   ├── identity-access/
│   ├── gardens-mapping/
│   ├── plants-inventory/
│   ├── observations-history/
│   ├── tasks-recommendations/
│   ├── media/
│   ├── capture-import/
│   ├── collaboration/
│   ├── integrations/
│   └── administration/
└── app.ts
```

Each module contains domain, application, persistence, transport, and test code for its bounded responsibility. Repository source files remain below the repository's 600-line code limit.

## 5. Module Shape

```text
module/
├── domain/
├── application/
├── persistence/
├── transport/
├── integration/
├── public.ts
└── tests/
```

### 5.1 Domain

Contains entities, value objects, policies, state transitions, and domain errors. It has no Fastify, Kysely, Firebase, Google Cloud, or provider imports.

### 5.2 Application

Contains commands, queries, use cases, transaction coordination, authorization requirements, and interfaces required from infrastructure or other modules.

### 5.3 Persistence

Contains Kysely repositories, SQL mappings, and module-owned query implementations. A module may not import another module's private persistence implementation.

### 5.4 Transport

Contains Fastify route registration, request/response mapping, authentication requirements, OpenAPI bindings, and HTTP-specific error mapping.

### 5.5 Public Interface

`public.ts` exposes only supported application interfaces, domain identifiers, and events. Cross-module imports are allowed only through this file or a dedicated shared kernel.

## 6. Initial Modules

### 6.1 Identity and Access

Owns application profiles, Firebase identity mapping, account state, garden-role queries, and support-access policy interfaces.

### 6.2 Gardens and Mapping

Owns gardens, coordinate spaces, objects, geometry revisions, validation, calibration, georeferencing, and proposal acceptance.

### 6.3 Plants and Inventory

Owns plant instances, plant grouping, taxonomy references, placements, lifecycle, and garden-specific plant facts.

### 6.4 Observations and History

Owns append-oriented observations, measurements, notes, event history, and provenance records.

### 6.5 Tasks and Recommendations

Owns task lifecycle, completion, postponement, rejection, recommendation candidates, explanations, evidence, and feedback.

### 6.6 Media

Owns media records, upload authorization, verification, derivatives, access decisions, processing state, and retention state.

### 6.7 Capture and Import

Owns import jobs, capture sessions, processing proposals, calibration input, and result reconciliation.

### 6.8 Collaboration

Owns invitations, membership, owner/editor/viewer roles, attribution, and collaboration notifications.

### 6.9 Integrations

Owns provider adapters, normalized external observations, quota policy, licensing metadata, and provider-health reporting.

### 6.10 Administration

Owns feature configuration, controlled support tools, audit access, operational repair commands, and data export/deletion coordination.

## 7. Shared Kernel

The shared kernel is intentionally small and may contain:

- UUIDv7 identifiers.
- Time and clock interfaces.
- Measurement units.
- Common pagination types.
- Correlation and actor context.
- Transaction interface.
- Stable geometry primitives that are not owned by a single module.

Business concepts do not enter the shared kernel merely because several modules reference them. Their owning module exposes a public type or query.

## 8. Dependency Direction

```text
transport ──► application ──► domain
    │              │
    ▼              ▼
platform       declared ports
    │              ▲
    └──────────────┘
```

Domain code depends on no outer layer. Application code declares ports. Persistence and integration adapters implement those ports.

## 9. Composition Root

One bootstrap composition root:

- Loads validated configuration.
- Starts telemetry before application initialization.
- Creates database and Google Cloud clients.
- Constructs module adapters and public interfaces.
- Registers Fastify plugins and routes.
- Registers graceful shutdown.
- Starts serving only after readiness checks pass.

Runtime service lookup and arbitrary dependency containers are prohibited. Dependencies are explicit at construction boundaries.

## 10. Configuration

Configuration uses a typed schema and fails startup on invalid required values. Sources are:

- Non-secret environment configuration.
- Secret Manager references injected at runtime.
- Stable build metadata.

The application must not fetch secrets repeatedly per request. Secret values are never logged.

## 11. Request Pipeline

The standard request pipeline is:

1. Correlation identifier creation or validation.
2. Request size and content-type enforcement.
3. Firebase session or ID-token authentication.
4. App Check verification according to endpoint policy.
5. Rate and abuse controls at the edge and application layer.
6. OpenAPI request validation.
7. Actor-context construction.
8. Route-to-use-case mapping.
9. Authorization and domain execution.
10. Transaction commit and outbox append.
11. Response mapping.
12. Structured telemetry completion.

## 12. Transactions

Use cases declare transaction boundaries. Repositories participate through a transaction-scoped Kysely handle.

Rules are:

- Transactions are short and never contain media upload or external provider calls.
- Domain state and its outbox events commit atomically.
- Retried commands are resolved through idempotency records inside the transaction.
- Cross-module transactions are allowed only through public application interfaces and documented use cases.
- Background jobs use smaller checkpointed transactions for large batches.

## 13. Commands and Queries

Commands represent business intent and may change state. Queries return purpose-built read models without exposing persistence rows.

Command handlers:

- Validate expected revision.
- Authorize the actor.
- Enforce domain invariants.
- Write current state and revision records.
- Append outbox events.
- Return stable resource identifiers and accepted revisions.

Queries use explicit selection and pagination. Unbounded list queries are prohibited.

## 14. Error Model

Application errors are stable typed categories:

- Validation.
- Authentication required.
- Forbidden.
- Not found without existence leakage.
- Conflict or stale revision.
- Quota exceeded.
- Unsupported capability.
- Retryable dependency unavailable.
- Internal failure.

HTTP mapping occurs only in the transport layer. Internal exception messages are not sent to clients.

## 15. Idempotency

All externally retryable commands accept an idempotency key scoped to actor, operation, and endpoint semantics.

The backend stores:

- Key hash.
- Actor.
- Command fingerprint.
- Processing state.
- Stable result reference.
- Expiration.

Reusing a key with a different command fingerprint is rejected.

## 16. Authorization

Authorization is application-owned and evaluated inside use cases. Transport middleware may reject unauthenticated requests, but it does not decide garden-level permissions.

Each use case declares the required capability, such as:

- View garden.
- Edit garden content.
- Manage membership.
- Delete garden.
- Run expensive processing.
- Access support diagnostics.

## 17. Database Access

Kysely provides typed query construction and transaction plumbing. Reviewed SQL migrations define the schema. Explicit SQL is used for PostGIS, advanced indexes, locks, and queries that are clearer in SQL.

Database access requirements are:

- Parameterized queries.
- Query timeouts.
- Connection-pool limits aligned with Cloud Run scaling.
- Request-level transaction cleanup.
- Slow-query telemetry without sensitive bind values.
- No dynamic table or column names from untrusted input.

## 18. External Providers

Provider calls occur outside database transactions through module-owned ports. Adapters implement timeout, retry, circuit-breaker, quota, caching, and telemetry behavior.

Long or unreliable calls move to asynchronous commands. Interactive endpoints return existing data, accepted job state, or explicit dependency degradation rather than holding requests indefinitely.

## 19. Worker Boundary

Workers share versioned contracts and selected domain packages but do not import the running API application. A worker has its own composition root, service identity, configuration, health behavior, and deployment.

Python workers exchange versioned JSON manifests and storage references rather than importing TypeScript domain code.

## 20. Health and Lifecycle

- Liveness proves the process event loop is responsive.
- Readiness proves required initialization is complete.
- Dependency outages are reported through telemetry; readiness does not flap for every transient provider failure.
- Shutdown stops accepting requests, drains within the Cloud Run grace period, closes pools, and abandons no owned transaction.

## 21. Observability

Every request records:

- Correlation and trace identifiers.
- Route template, not raw sensitive URL.
- Actor type, not raw identity unless audit policy requires it.
- Outcome category.
- Latency.
- Database and provider span summaries.
- Idempotency outcome where relevant.

Logs exclude tokens, secrets, raw media, exact geometry, precise addresses, and signed URLs.

## 22. Testing

- Domain and application unit tests.
- Module integration tests against real PostgreSQL/PostGIS.
- Route contract tests against OpenAPI.
- Authorization matrix tests.
- Idempotency and concurrency tests.
- Outbox atomicity tests.
- Provider adapter tests with deterministic fakes and controlled integration environments.
- Container startup, readiness, and migration compatibility tests.

## 23. Extraction Criteria

A module may become a service when evidence shows:

- A materially different runtime or scaling profile.
- Unacceptable failure coupling.
- A necessary independent security boundary.
- Independent team ownership and release cadence.
- Incompatible availability or latency objectives.

Extraction requires a new ADR and an explicit data-ownership migration plan.

## 24. Completion Criteria

- Domain modules expose clear public interfaces.
- Route handlers contain no business logic.
- State changes and outbox events commit atomically.
- All mutations are authorized and revision-aware.
- Cloud Run scaling cannot exhaust Cloud SQL connections under configured limits.
- Provider outages do not corrupt domain transactions.
- The service can be tested locally with containerized PostgreSQL/PostGIS and emulated external adapters.
