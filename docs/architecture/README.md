# Grow Garden Architecture Documentation

> Status: Draft 0.3
> Decision status: Approved detailed-design baseline  
> Last updated: July 22, 2026

## 1. Purpose

This directory contains the detailed architecture for the approved Grow Garden high-level architecture. The documents define component responsibilities, boundaries, data flows, failure behavior, security controls, testing obligations, and operational expectations.

The product-wide delivery order, work packages, dependencies, release gates, and requirements traceability are maintained in [../implementation-plan.md](../implementation-plan.md).

The architecture is based on the following approved product-level choices:

- The first market is the United States.
- The primary Google Cloud region is `us-central1`.
- The Apple application is native Swift and SwiftUI.
- The web application uses TypeScript, React, and Next.js.
- The backend is a TypeScript modular monolith using Fastify.
- Computer-vision and scan workers use Python where its ecosystem is advantageous.
- The external application API is REST described by OpenAPI.
- Cloud SQL for PostgreSQL with PostGIS is the synchronized source of truth.
- Native offline persistence uses SQLite through GRDB and an application-owned synchronization protocol.
- Firebase provides authentication, App Check, Cloud Messaging, Crashlytics, and App Hosting.
- Google Cloud provides Cloud Run, Cloud SQL, Cloud Storage, Cloud Tasks, Pub/Sub, Workflows, Vertex AI, networking, and observability.
- Operational team sharing uses owner/editor/viewer garden membership; professional clients use separate engagements and immutable client publications.

## 2. Document Map

| Area                                       | Detailed design                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Native Apple client                        | [ios-application-design.md](ios-application-design.md)                       |
| Web client                                 | [web-application-design.md](web-application-design.md)                       |
| Garden map rendering and editing           | [map-rendering-and-editing.md](map-rendering-and-editing.md)                 |
| Backend modular monolith                   | [backend-modular-monolith.md](backend-modular-monolith.md)                   |
| REST API and contracts                     | [api-design.md](api-design.md)                                               |
| PostgreSQL and geospatial model            | [data-and-geospatial-design.md](data-and-geospatial-design.md)               |
| Offline synchronization                    | [offline-synchronization.md](offline-synchronization.md)                     |
| Identity and authorization                 | [identity-and-authorization.md](identity-and-authorization.md)               |
| Collaboration and client sharing           | [collaboration-and-client-sharing.md](collaboration-and-client-sharing.md)   |
| Media storage and processing               | [media-storage-and-processing.md](media-storage-and-processing.md)           |
| Garden capture and scan                    | [garden-capture-and-scan.md](garden-capture-and-scan.md)                     |
| Queues, events, jobs, and workflows        | [asynchronous-processing.md](asynchronous-processing.md)                     |
| Recommendations and AI                     | [recommendations-and-ai.md](recommendations-and-ai.md)                       |
| Third-party providers                      | [external-integrations.md](external-integrations.md)                         |
| Push and in-app notifications              | [notifications.md](notifications.md)                                         |
| Security and privacy                       | [security-and-privacy.md](security-and-privacy.md)                           |
| Cloud networking                           | [networking.md](networking.md)                                               |
| Technical and product telemetry            | [observability-and-analytics.md](observability-and-analytics.md)             |
| Environments, infrastructure, and delivery | [environments-and-delivery.md](environments-and-delivery.md)                 |
| Availability, backup, and recovery         | [reliability-and-disaster-recovery.md](reliability-and-disaster-recovery.md) |
| Automated quality strategy                 | [testing-strategy.md](testing-strategy.md)                                   |
| Cost controls and scaling                  | [cost-and-scaling.md](cost-and-scaling.md)                                   |
| Data export, ownership, and deletion       | [data-export-and-deletion.md](data-export-and-deletion.md)                   |

## 3. Decision Records

Material decisions and their rationale are recorded under [decisions/](decisions/README.md). Detailed-design documents explain how an accepted decision is applied. An architecture decision record explains why the decision was selected and how it may be superseded.

## 4. Approved Technology Profile

| Concern                          | Approved choice                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Repository                       | Monorepo                                                                           |
| iOS architecture                 | Feature-based MVVM with application use cases                                      |
| iOS persistence                  | GRDB over SQLite                                                                   |
| iOS dependencies                 | Swift Package Manager                                                              |
| iOS rendering                    | SwiftUI Canvas/Core Graphics with MapKit context                                   |
| Web framework                    | Next.js on an active Firebase App Hosting-supported release                        |
| Web server state                 | TanStack Query                                                                     |
| Web editor state                 | Zustand                                                                            |
| Web forms                        | React Hook Form and Zod                                                            |
| Web garden renderer              | Konva Canvas scene graph                                                           |
| Web geographic context           | MapLibre with a replaceable tile provider                                          |
| Backend runtime                  | TypeScript on Node.js                                                              |
| Runtime baseline                 | Node.js 24 and TypeScript 5.9.x                                                    |
| Backend HTTP framework           | Fastify                                                                            |
| Scan runtime                     | Python workers where required                                                      |
| External API                     | REST and OpenAPI                                                                   |
| Database access                  | Kysely with reviewed SQL migrations and explicit PostGIS SQL                       |
| Database baseline                | PostgreSQL 17 and PostGIS 3.5                                                      |
| Identifiers                      | Client-generated UUIDv7                                                            |
| Geometry API                     | GeoJSON with application metadata                                                  |
| Geometry storage                 | PostGIS geometry in a local planar garden space with optional WGS84 georeferencing |
| Local geometry contract          | SRID 0, separate coordinate-space identity, 1 mm rounding, and ADR-0010 tolerances |
| Geometry concurrency             | Object-level optimistic concurrency                                                |
| History                          | Mutable current state plus immutable revision journal                              |
| Offline sync                     | Application-owned outbox and versioned synchronization API                         |
| Authentication                   | Firebase Authentication                                                            |
| Initial login methods            | Sign in with Apple, Google Sign-In, and email magic link                           |
| Apple and browser baseline       | iOS/iPadOS 18 minimum with Swift 6.3; last two Chrome/Edge/Firefox and Safari 17+  |
| Web authentication               | Firebase HTTP-only session cookie                                                  |
| Operational collaboration roles  | Owner, editor, and viewer                                                          |
| Professional client access       | Service organization, engagement, and immutable publication projection             |
| Media transfer                   | Backend-authorized resumable Cloud Storage upload                                  |
| Application commands             | Cloud Tasks                                                                        |
| Fan-out events                   | Pub/Sub                                                                            |
| Batch execution                  | Cloud Run Jobs                                                                     |
| Long orchestration               | Google Cloud Workflows when justified                                              |
| Reliable publication             | PostgreSQL transactional outbox                                                    |
| AI provider                      | Vertex AI through an application-owned adapter                                     |
| Search                           | PostgreSQL full-text and trigram indexes initially                                 |
| Push transport                   | Firebase Cloud Messaging                                                           |
| Initial infrastructure tooling   | Versioned idempotent gcloud scripts                                                |
| Future infrastructure option     | Terraform after a superseding multi-operator decision                              |
| CI/CD                            | GitHub Actions with Google workload identity federation                            |
| Environments                     | Separate development, staging, and production Firebase/GCP projects                |
| Production database network      | Private IP through Direct VPC egress                                               |
| Production ingress               | Global HTTPS Load Balancer and Cloud Armor                                         |
| Primary region                   | `us-central1`                                                                      |
| Production database availability | Cloud SQL regional high availability                                               |
| Technical telemetry              | OpenTelemetry and Google Cloud operations products                                 |
| Native crash reporting           | Firebase Crashlytics                                                               |
| Product analytics                | Application-owned event schema delivered to Firebase Analytics/GA4 with consent    |

## 5. Repository Shape

The target repository shape is:

```text
apps/
├── ios/
└── web/

services/
├── api/
└── workers/

packages/
├── api-contracts/
├── geometry-contracts/
├── localization/
└── test-fixtures/

infrastructure/
├── gcloud/
├── terraform/
└── firebase/

docs/
├── architecture/
└── technical-specification.md
```

The iOS project is stored in the same repository but is not part of the JavaScript workspace toolchain. TypeScript workspaces use `pnpm`. Initial Google Cloud resources are provisioned through `infrastructure/gcloud`; `infrastructure/terraform` is reserved and is not authoritative under ADR-0011.

## 6. Cross-Document Rules

- Cloud SQL is the authoritative synchronized domain store.
- Firestore is not an authoritative domain store and is not part of the initial data path.
- Clients never connect directly to Cloud SQL.
- Accepted garden geometry is never silently replaced by generated output.
- Long-running processing never executes in an interactive API request.
- Every asynchronous command and worker is idempotent.
- Every user-created offline mutation is durable until accepted, rejected with a recoverable explanation, or deliberately discarded by the user.
- Provider-specific payloads remain outside domain modules.
- Security and authorization are enforced on the server even when clients also validate locally.
- Sensitive media and precise location are excluded from ordinary logs and analytics.
- Client portal authorization is evaluated against active engagement and published resource identity; client visibility is never implemented only by hiding operational controls.
- Production resources use least-privilege service identities and private database connectivity.

## 7. Remaining Implementation-Time Selections

The architecture strategy, initial platform/toolchain baseline, and geometry tolerances are approved. The following values remain selected at implementation or launch review without reopening the architecture unless their consequences exceed the documented boundaries:

- Exact active Firebase App Hosting-supported Next.js release and upgrade timing within the dependency lock.
- Responsive breakpoints within the accepted browser baseline.
- Initial commercial basemap and imagery tile provider.
- Transactional email provider.
- Exact Vertex AI model for each evaluated use case.
- Exact production alert thresholds and quotas after load tests.
- Legal retention exceptions required by policy or jurisdiction.

## 8. Change Process

1. Update or add an ADR for any material replacement or new dependency.
2. Update the affected detailed-design document.
3. Update [../high-level-architecture.md](../high-level-architecture.md) when the system-level view changes.
4. Update [../technical-specification.md](../technical-specification.md) when product behavior or constraints change.
5. Change the document version and last-updated date.

No implementation change is complete when its affected documentation remains inaccurate.
