# Grow Garden High-Level Architecture

> Status: Draft 0.3  
> Decision status: Approved detailed-design baseline  
> Last updated: July 22, 2026  
> Cloud platform: Firebase and Google Cloud

## 1. Purpose

This document defines the approved high-level architecture for Grow Garden. It translates the product requirements in [technical-specification.md](technical-specification.md) into system boundaries, major components, deployment units, data ownership, integration paths, and operational principles.

This document intentionally stays above implementation-level design. Approved detailed designs and architecture decision records are indexed in [architecture/README.md](architecture/README.md).

The proposed product-wide implementation sequence, dependencies, gates, and requirements traceability are defined in [implementation-plan.md](implementation-plan.md).

## 2. Scope

The architecture covers:

- Native Apple mobile and tablet applications.
- A first-class web application.
- User identity and access control.
- Garden, map, plant, observation, task, and recommendation data.
- Offline mobile work and synchronization.
- Property-plan, image, video, AR, and future depth-based capture.
- Media upload, storage, transformation, and retention.
- Asynchronous and compute-intensive processing.
- External horticultural, weather, map, imagery, notification, and AI providers.
- Security, privacy, observability, environments, delivery, and operations.

The architecture does not yet define:

- Detailed user-interface design.
- Exact commercial map, weather, plant-content, and transactional-email providers.
- Exact supported runtime and operating-system versions at implementation time.
- Exact Vertex AI models for evaluated use cases.
- Final legal retention exceptions and production alert thresholds.
- Commercial plans, quotas, or billing behavior.

## 3. Approved Architecture Decisions

| Area                          | Approved decision                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Apple client                  | Native Swift and SwiftUI application                                                                                   |
| Native persistence            | GRDB over SQLite with a durable outbox                                                                                 |
| Web client                    | Separate TypeScript, React, and Next.js application                                                                    |
| Backend style                 | TypeScript and Fastify modular monolith with independently deployed Python or TypeScript workers                       |
| Cloud ecosystem               | Firebase and Google Cloud                                                                                              |
| Transactional source of truth | Cloud SQL for PostgreSQL with PostGIS                                                                                  |
| Media storage                 | Google Cloud Storage                                                                                                   |
| Mobile platform services      | Firebase Authentication, App Check, Cloud Messaging, and Crashlytics                                                   |
| Web delivery                  | Firebase App Hosting on an active supported Next.js release                                                            |
| External API                  | Versioned REST described by OpenAPI                                                                                    |
| Database access               | Kysely, reviewed SQL migrations, and explicit PostGIS SQL                                                              |
| Mobile connectivity model     | Application-owned offline synchronization with GRDB/SQLite, an outbox, server revisions, and domain-specific conflicts |
| Web connectivity model        | Online-first, with recoverable local drafts where appropriate                                                          |
| Geometry model                | Local planar meters with optional WGS84 georeferencing and GeoJSON interchange                                         |
| Processing model              | Hybrid on-device and cloud processing                                                                                  |
| AI provider                   | Vertex AI through an application-owned adapter                                                                         |
| Primary market and region     | United States and `us-central1`                                                                                        |
| Production networking         | Global HTTPS Load Balancer, Cloud Armor, Direct VPC egress, and private Cloud SQL IP                                   |
| Delivery tooling              | Terraform and GitHub Actions with workload identity federation                                                         |
| Architecture portability      | Containerized backend, standard PostgreSQL, explicit provider adapters, and limited provider leakage into domain code  |

## 4. Architectural Principles

### 4.1 One Authoritative Domain Store

Cloud SQL for PostgreSQL is the authoritative store for synchronized domain data. PostGIS provides canonical spatial types, indexes, validation, and query capabilities.

Firestore is not part of the baseline authoritative data path. It may be introduced later for a narrowly defined projection or presence use case only after ownership, consistency, recovery, and deletion behavior are documented. It must not become an accidental second source of truth.

### 4.2 Progressive Garden Fidelity

The architecture must accept incomplete, approximate, imported, measured, and derived garden information. Every relevant spatial fact must be able to retain:

- Source and acquisition method.
- Coordinate-space information.
- Confidence or uncertainty.
- Measurement units.
- Revision and audit information.
- User acceptance or rejection state for generated results.

### 4.3 User-Controlled Automation

Imported, scanned, inferred, or AI-generated objects are proposals until accepted by the user. Automated processing must not silently replace accepted garden geometry or horticultural facts.

### 4.4 Offline Safety

Loss of connectivity must not discard acknowledged mobile changes. Offline work is modeled explicitly through a local store, durable pending operations, idempotent synchronization, and visible synchronization state.

### 4.5 Asynchronous Heavy Work

Media analysis, plan extraction, video processing, scan reconstruction, recommendation batches, exports, and other long-running operations must not run in interactive API requests. They execute through durable queues and workers.

### 4.6 Replaceable External Providers

Weather, map imagery, plant content, geocoding, AI, notification, and similar integrations must be isolated behind application-owned interfaces. Provider payloads must not become the core domain model.

### 4.7 Modular Before Distributed

The backend begins as a modular monolith. Modules own behavior and persistence boundaries inside one deployable API. A module becomes a separate service only when scaling, security, reliability, release ownership, or technology requirements justify the operational cost.

## 5. System Context

```text
┌─────────────────────┐          ┌─────────────────────┐
│ Native iOS/iPadOS   │          │ Web Application     │
│ Swift + SwiftUI     │          │ TypeScript + React  │
└──────────┬──────────┘          └──────────┬──────────┘
           │                                │
           ├──── Firebase Authentication ───┤
           ├──── Firebase App Check ────────┤
           │                                │
           └──────── HTTPS API ─────────────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │ Cloud Run API     │
                  │ Modular Monolith  │
                  └───────┬───────────┘
                          │
              ┌───────────┼───────────────┐
              ▼           ▼               ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ Cloud SQL    │ │ Cloud Storage│ │ Cloud Tasks  │
     │ PostgreSQL   │ │ Media        │ │ / Pub/Sub    │
     │ + PostGIS    │ └──────────────┘ └──────┬───────┘
     └──────────────┘                         │
                                              ▼
                                    ┌──────────────────┐
                                    │ Cloud Run Jobs   │
                                    │ Worker Services  │
                                    └────────┬─────────┘
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │ External Services│
                                    │ Weather/Maps/AI  │
                                    └──────────────────┘
```

## 6. Client Architecture

### 6.1 Native Apple Application

The Apple application is a native Swift and SwiftUI client for iPhone and iPad. Native implementation is required to provide first-class access to:

- ARKit and device tracking.
- Camera, photos, video, depth, and supported LiDAR capabilities.
- Location and motion sensors.
- Background uploads and platform lifecycle behavior.
- Local persistence and offline workflows.
- Push notifications.
- Accessibility and platform-native interaction patterns.

The client is divided conceptually into:

- Presentation and navigation.
- Application use cases.
- Domain models and validation.
- Local persistence.
- Synchronization and upload coordination.
- Platform capability adapters.
- API and authentication clients.

GRDB over SQLite provides native local persistence. User mutations update the local read model and append a versioned outbox command in one transaction.

### 6.2 Web Application

The web application is a separate TypeScript and React client. It is a first-class product surface optimized for larger-screen map editing, plan calibration, data management, history, and collaboration administration.

The web client:

- Uses Firebase Authentication for identity.
- Uses App Check where supported and appropriate.
- Calls the application API rather than connecting directly to Cloud SQL.
- Uploads large media directly to Cloud Storage through application-authorized upload sessions.
- Is online-first in the initial architecture.
- Preserves recoverable local drafts for expensive editing flows where practical.
- Can display and edit accepted results created by device-only capture features.

Firebase App Hosting is the baseline web delivery platform. The application uses an active Firebase-supported Next.js release pinned and upgraded deliberately.

### 6.3 Shared Client Assets

The native and web applications do not share presentation code. They may share platform-neutral artifacts such as:

- OpenAPI or equivalent API definitions.
- Generated API clients.
- JSON schemas.
- Measurement and unit fixtures.
- Geometry interchange formats.
- Localization source data.
- Test vectors and validation examples.

Shared artifacts must not force either client into the other platform's runtime or user-interface abstractions.

## 7. Backend Architecture

### 7.1 Modular Monolith

The primary backend runs as a stateless container on Cloud Run. It begins as one deployable modular monolith with explicit internal boundaries.

Initial logical modules are:

- **Identity and Access**: application profiles, garden membership, roles, and authorization decisions.
- **Gardens and Mapping**: gardens, coordinate spaces, geometry, structures, zones, beds, paths, fences, and validation.
- **Plants and Inventory**: plant instances, taxonomy references, placement, lifecycle, and status.
- **Observations and History**: notes, photos, events, measurements, and provenance.
- **Tasks and Recommendations**: planned work, completion, postponement, rejection, explanations, and recommendation history.
- **Media**: upload authorization, metadata, processing state, derivatives, and retention state.
- **Capture and Import**: plans, imagery, AR sessions, scans, extraction proposals, calibration, and reconciliation.
- **Collaboration**: invitations, membership, permissions, attribution, and future activity notifications.
- **Integrations**: weather, maps, imagery, geocoding, plant content, AI, and messaging adapters.
- **Administration and Operations**: feature configuration, support diagnostics, audit access, and operational controls.

Modules may share a database instance initially, but they must not bypass each other's application boundaries through undocumented table coupling.

### 7.2 Interactive API

The API is responsible for:

- Authentication token validation.
- Authorization and garden isolation.
- Command and query validation.
- Transaction boundaries.
- Idempotency for retried mutations.
- Synchronization endpoints.
- Upload-session creation.
- Job submission and status queries.
- Audit and diagnostic context.

The external API is versioned REST described by OpenAPI. Generated Swift and TypeScript clients are wrapped by application gateways. Mutations define idempotency and optimistic-concurrency behavior.

### 7.3 Asynchronous Processing

Cloud Tasks is the default mechanism for controlled delivery of application commands that require retry, scheduling, rate limiting, or a specific HTTP worker target.

Pub/Sub is used for fan-out events and integration between independently interested consumers. Event publication must be reliable relative to database transactions, using an outbox or equivalent pattern.

Cloud Run Jobs is used for finite, containerized batch work. Dedicated Cloud Run worker services may consume queues when continuous or low-latency processing is required.

Initial job categories include:

- Image derivative generation.
- Property-plan extraction.
- Video frame sampling and analysis.
- Scan reconstruction and geometry extraction.
- Bulk recommendation generation.
- Data import and export.
- Deletion and retention workflows.
- Search or projection rebuilding.

Every job must be idempotent, observable, retry-aware, cancellable where practical, and safe against duplicate delivery.

## 8. Data Architecture

### 8.1 PostgreSQL and PostGIS

Cloud SQL for PostgreSQL is the system of record for:

- Users' application profiles.
- Gardens and memberships.
- Garden objects and spatial geometry.
- Plant instances and placements.
- Observations, tasks, recommendations, and history.
- Provenance, confidence, and measurement metadata.
- Media metadata and processing state.
- Synchronization revisions and operation records.
- Audit-relevant application events.

PostGIS is used for spatial types, indexing, containment, intersection, distance, validity, and transformation operations.

The detailed spatial design must support both:

- A local planar garden coordinate space suitable for small-site editing and measurements.
- Optional georeferencing to geographic coordinates for imagery, weather, and regional context.

The detailed design uses a hybrid typed object model, GeoJSON interchange with explicit coordinate-space metadata, object-level optimistic concurrency, and current state plus an immutable revision journal. Exact custom SRID registration and numeric tolerances are implementation values validated through shared fixtures.

### 8.2 Cloud Storage

Cloud Storage holds binary objects such as:

- Original photos and videos.
- Imported plans and documents.
- AR and scan artifacts.
- Generated thumbnails and previews.
- Processing inputs and outputs.
- Export packages.

PostgreSQL stores object references, ownership, checksums, content types, sizes, provenance, processing status, and retention state. Storage object paths are infrastructure identifiers, not public API contracts.

Clients use short-lived, authorized upload or download mechanisms. Large media should not pass through the interactive API container.

### 8.3 Backups and Recovery

The production design must enable:

- Automated Cloud SQL backups.
- Point-in-time database recovery.
- Cloud Storage versioning or retention controls where justified.
- Tested restoration procedures.
- Separate recovery objectives for domain data and reproducible derivatives.

Recovery point and recovery time objectives remain to be defined before production launch.

## 9. Offline and Synchronization Architecture

### 9.1 Ownership

The server is authoritative after synchronization. The mobile local store is authoritative for acknowledged offline changes that have not yet been accepted by the server. The system must make this pending state visible and recoverable.

### 9.2 Mobile Change Flow

```text
User action
    │
    ▼
Local transaction
├── Update local read model
└── Append durable outbox operation
             │
             ▼ when connected
       Synchronization API
             │
       Validate and authorize
             │
       Idempotent server transaction
             │
       Return accepted revision
             │
       Update local sync state
```

The synchronization design must provide:

- Client-generated operation identifiers.
- Idempotent retries.
- Server revisions or equivalent change tokens.
- Incremental pull of server changes.
- Tombstones or equivalent deletion semantics.
- Explicit upload state for media.
- Conflict detection based on the version the user edited.
- User-visible recovery for rejected or irreconcilable changes.

### 9.3 Conflict Strategy

The baseline must not apply universal last-write-wins behavior to whole garden documents. Conflict behavior is defined by domain operation.

Expected categories are:

- Automatically merge independent object changes.
- Reject stale edits to the same geometry revision and request review.
- Preserve append-only observations and history events.
- Treat task status transitions as explicit commands.
- Prevent generated scan results from overwriting accepted geometry.

Real-time simultaneous geometry collaboration is not required for the initial release. A detailed synchronization design must be approved before implementation.

### 9.4 Web Behavior

The initial web application is online-first. It may cache query results and save recoverable editing drafts, but it must not claim a successful server save while offline. Full offline web synchronization is a future option and must reuse the same server-side concurrency rules.

## 10. Media and Garden Scan Pipeline

```text
Capture or import
       │
       ▼
Create media/upload record through API
       │
       ▼
Direct resumable upload to Cloud Storage
       │
       ▼
Upload completion verification
       │
       ▼
Durable job submission
       │
       ▼
Cloud Run Job / specialized processor
       │
       ├── Derivatives and diagnostics to Cloud Storage
       └── Structured proposal to PostgreSQL
                         │
                         ▼
                  User review and edit
                         │
                         ▼
                  Accepted garden revision
```

On-device processing should handle immediate interaction, capture guidance, basic quality checks, device-specific AR tracking, and lightweight transformations. Cloud processing should handle workloads that need larger models, more memory, longer execution, cross-capture reconciliation, or reproducibility independent of device capability.

Processing output must include:

- Processor and model version.
- Input artifact references.
- Coordinate-space and calibration information.
- Confidence and quality diagnostics.
- Generated object provenance.
- Failure reason when processing is incomplete.

GPU or specialist compute may be provided by Vertex AI or another adapter-backed provider. It is not required to run inside the primary API platform.

## 11. Identity, Authorization, and Security

### 11.1 Identity

Firebase Authentication is the identity provider for supported clients. The backend validates Firebase ID tokens and maps the external identity to an application profile.

Authentication does not grant garden access by itself. Garden membership and role assignments are owned by the application database and enforced by the backend.

### 11.2 Application Protection

Firebase App Check is used as a defense-in-depth signal for supported clients. It does not replace authentication, authorization, rate limiting, input validation, or abuse monitoring.

### 11.3 Authorization

Every domain operation must be authorized against the target garden and requested capability. The baseline roles are owner, editor, and viewer. The backend evaluates stable capabilities for these roles as defined in [architecture/identity-and-authorization.md](architecture/identity-and-authorization.md); client-side checks are never an authorization boundary.

### 11.4 Service Security

The platform must use:

- Least-privilege service accounts.
- Secret Manager for application secrets.
- Encrypted transport.
- Google-managed encryption at rest by default, with customer-managed keys considered only when requirements justify them.
- Private or strongly restricted database connectivity.
- Short-lived signed or authorized media access.
- Rate limits, quotas, and abuse detection for expensive operations.
- Audit trails for security-sensitive actions.
- Separate identities and resources per environment.

The web client and Firebase App Hosting backend must not connect directly to Cloud SQL. Database access is restricted to application and worker services that require it.

### 11.5 Privacy

Property plans, addresses, garden imagery, video, location, and nearby private property are sensitive data. The detailed security, privacy, media, and deletion designs define:

- Purpose-specific collection and consent.
- Regional storage and processing constraints.
- Raw media retention.
- User deletion and account closure.
- Provider data-use restrictions.
- Support access and audit behavior.
- Analytics consent and data minimization.

A formal threat-model and privacy launch review remain required before production launch.

## 12. Networking

The initial architecture avoids unnecessary network complexity while preserving a secure production path.

- Public clients reach Firebase-hosted web content and the HTTPS API.
- Cloud Run is the only public application entry point for domain operations.
- Cloud SQL is never accessed directly by clients.
- Development may use the authenticated Cloud SQL connector over public IP.
- Staging and production use private Cloud SQL IP and Direct VPC egress with private-range routing.
- Production API ingress uses a global HTTPS Load Balancer and Cloud Armor.
- Workers and jobs receive only the network access required for their responsibilities.

The detailed network design defines environment-isolated VPCs, regional subnets, private service access, IAM-authenticated internal calls, and exact public ingress. A NAT gateway is added only for an identified all-traffic or stable-egress requirement after cost and capacity review.

## 13. External Integrations

External providers are accessed through application-owned adapters. Initial integration categories are:

- Weather forecasts and observations.
- Geocoding and regional context.
- Basemap, aerial, and satellite imagery.
- Plant taxonomy and horticultural content.
- Image recognition and generative AI.
- Email and future non-push messaging.
- Product analytics and support tooling.

Each adapter must define:

- Provider-independent input and output models.
- Timeout, retry, quota, and circuit-breaker behavior.
- Data classification and allowed payloads.
- Caching and freshness rules.
- Attribution and licensing requirements.
- Failure behavior and user-visible degradation.
- Replacement and migration considerations.

## 14. Notifications

Firebase Cloud Messaging is the baseline push-notification transport. The application backend owns notification intent, recipient selection, deduplication, user preferences, and audit context.

Notification delivery is asynchronous. A failed notification must not roll back the domain transaction that created the notification intent.

## 15. Observability and Operations

The baseline observability stack uses:

- Firebase Crashlytics for native client crashes and non-fatal diagnostics.
- Cloud Logging for backend, worker, job, and infrastructure logs.
- Cloud Monitoring for metrics, dashboards, uptime checks, and alerts.
- Cloud Trace and Error Reporting where appropriate.
- Correlation identifiers across API requests, jobs, and provider calls.

Operational signals must cover:

- API latency and error rates.
- Authentication and authorization failures.
- Database health and connection pressure.
- Queue age, retry rate, and dead-letter volume.
- Job duration, failure, cancellation, and cost.
- Media upload completion and abandonment.
- Synchronization backlog and rejection rate.
- External-provider availability and quota consumption.
- Expensive-operation abuse and budget anomalies.

Logs and analytics must not contain raw sensitive media, authentication tokens, secrets, or unnecessary precise location data.

## 16. Environments and Delivery

Grow Garden uses separate Firebase and Google Cloud projects for at least:

- Development.
- Staging.
- Production.

Environment data, credentials, storage, queues, and identity configuration must not be shared accidentally.

Delivery principles are:

- Infrastructure is defined as code.
- Database changes use reviewed, forward-compatible migrations.
- Backend containers are immutable and promoted through environments.
- Web builds are reproducible and tied to source revisions.
- Mobile releases use controlled rollout and server-compatible API versions.
- Feature flags separate deployment from user-visible release where risk justifies them.
- Production rollback and database recovery procedures are tested.

Terraform is the infrastructure-as-code baseline. GitHub Actions builds, validates, promotes immutable artifacts, and authenticates to Google Cloud through workload identity federation.

## 17. Scalability and Evolution

### 17.1 Initial Scaling Model

- Cloud Run scales stateless API instances horizontally.
- Cloud SQL is scaled vertically first, then through connection management, query optimization, and read replicas where justified.
- PostGIS indexes support spatial query growth.
- Direct media transfer prevents API bandwidth from becoming the primary bottleneck.
- Queues absorb processing spikes.
- Jobs scale independently from interactive traffic.

### 17.2 Service Extraction Criteria

A module may be extracted from the monolith when at least one of these conditions is demonstrated:

- It requires materially different compute, runtime, or scaling.
- It creates unacceptable failure coupling.
- It needs an independent security boundary.
- It has a separate release cadence and clear ownership.
- It cannot meet reliability objectives inside the shared deployment.

Garden Scan processing is already separated as worker and job deployments because its resource and execution profile differs from the interactive API.

### 17.3 Portability

Portability is protected through:

- Standard PostgreSQL and PostGIS schemas.
- Containerized API and worker workloads.
- Explicit storage and provider adapters.
- Application-owned authorization and domain rules.
- Exportable media and domain data.
- Minimal use of Firestore-specific domain modeling.

Portability does not mean avoiding valuable managed services. It means keeping the cost and method of replacement understood.

## 18. Reliability and Failure Behavior

The architecture assumes partial failure.

- Interactive requests must not wait for long-running processing.
- Domain commits and event publication must not diverge silently.
- Retried commands and jobs must be idempotent.
- Failed media uploads remain recoverable or clearly abandoned.
- Failed processors preserve diagnostic state and original inputs according to retention policy.
- External-provider outages degrade only dependent features where possible.
- Accepted garden data remains usable while new processing is unavailable.
- User-facing status distinguishes queued, running, failed, cancelled, proposed, and accepted work.

## 19. Cost Controls

The production design must include:

- Google Cloud budgets and anomaly alerts.
- Per-user and per-garden quotas for expensive capture and AI features.
- Maximum upload sizes and supported media formats.
- Worker concurrency limits.
- Job timeouts and retry limits.
- Media lifecycle policies.
- Caching for licensed and reusable provider data where permitted.
- Cost attribution by environment and major workload.

Minimum Cloud Run instances, private networking components, GPU capacity, and long media retention must be enabled only with an explicit latency, security, or product requirement.

## 20. Implementation-Time Selections

The architecture strategy is approved. These values are selected or calibrated during implementation and launch review without reopening the architecture unless their consequences exceed the documented boundaries:

1. Minimum supported iOS and iPadOS versions under the current-plus-supported-predecessors policy.
2. Exact active Firebase-supported Next.js and Cloud SQL PostgreSQL versions.
3. Supported browser release lines and responsive breakpoints.
4. Initial commercial map, imagery, geocoding, weather, plant-content, and transactional-email providers.
5. Exact Vertex AI model for each evaluated use case.
6. Exact custom SRID registration, geometry tolerances, quotas, and performance thresholds.
7. Final legal retention exceptions, production SLO targets, and alert thresholds.

## 21. Rejected Baseline Alternatives

The following alternatives were evaluated and are not the selected baseline:

- **Firestore-only backend:** rejected as the authoritative model because the product requires relational integrity, explicit revisions, and advanced spatial operations.
- **Vercel as the complete platform:** rejected because long-running media and scan processing requires a separate compute platform; Vercel remains a possible future web-hosting alternative.
- **Supabase-first:** viable, but not selected because Firebase and Google Cloud provide the preferred integrated mobile, security, diagnostics, web, API, storage, and job ecosystem.
- **CloudKit-first:** rejected because the web application is a first-class product surface and the backend must remain platform-neutral.
- **AWS or Azure baseline:** technically viable, but not selected due to higher initial operational complexity without a current enterprise constraint requiring them.
- **Kubernetes:** rejected for the initial architecture because the modular monolith and workers do not justify its operational cost.
- **Self-hosted infrastructure:** rejected for the initial architecture because backup, security, availability, and operational ownership would distract from product validation.

## 22. Detailed Architecture

Approved detailed-design documents and ADRs are indexed in [architecture/README.md](architecture/README.md). Implementation must add the operational runbooks, final threat model, provider assessments, and release-specific support matrices required by those designs before the affected capability reaches production.

## 23. Documentation Maintenance

- This document must remain synchronized with approved architecture and implementation changes.
- Detailed documents must not contradict this baseline without an explicit superseding decision.
- New provider dependencies must be recorded with ownership, data flow, failure behavior, and replacement implications.
- Significant changes must update the draft version and last-updated date.
