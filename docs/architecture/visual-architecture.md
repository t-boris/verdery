# Verdery Visual Architecture

> Status: Draft 0.1
>
> Decision status: Presentation of the approved architecture; not a new architecture decision
>
> Last updated: August 3, 2026

## 1. Purpose

This document is a visual entry point into the Verdery architecture. It summarizes the authoritative
design documents through Mermaid diagrams so that product, engineering, security, and operations
readers can understand the system before following links into detailed specifications.

The diagrams simplify implementation detail but do not replace the linked source documents or
accepted architecture decision records. A solid line represents an approved current boundary. A
dashed line represents a planned, conditional, or research-only boundary when the diagram labels it
as such.

## 2. Architecture at a Glance

```mermaid
flowchart LR
    People[Garden owners<br/>household members<br/>professionals<br/>clients]

    subgraph Clients[Product surfaces]
        IOS[Native iOS and iPadOS<br/>Swift and SwiftUI]
        subgraph WEBAPP[One Next.js web application]
            WEB[Operational workspace<br/>live garden data]
            PORTAL[Client portal route group<br/>published data only]
        end
    end

    subgraph Edge[Identity and edge]
        FIREBASE[Firebase Authentication<br/>App Check and FCM]
        EDGE[HTTPS ingress<br/>Cloud Armor in production]
    end

    subgraph Application[Application platform]
        API[Cloud Run API<br/>Fastify modular monolith]
        WORKERS[Cloud Run workers and jobs<br/>asynchronous processing]
    end

    subgraph Data[Authoritative data]
        SQL[(Cloud SQL<br/>PostgreSQL and PostGIS)]
        STORAGE[(Private Cloud Storage<br/>media and exports)]
        QUEUES[Cloud Tasks and Pub/Sub<br/>durable delivery]
    end

    subgraph Providers[Replaceable providers]
        MAPS[Maps, imagery<br/>and geocoding]
        WEATHER[Weather and<br/>plant knowledge]
        AI[Vertex AI and<br/>evaluated AI providers]
        MESSAGE[Email and<br/>push delivery]
    end

    People --> IOS
    People --> WEB
    People --> PORTAL
    IOS --> FIREBASE
    WEB --> FIREBASE
    PORTAL --> FIREBASE
    IOS --> EDGE
    WEB --> EDGE
    PORTAL --> EDGE
    EDGE --> API
    API --> SQL
    API --> STORAGE
    API --> QUEUES
    QUEUES --> WORKERS
    WORKERS --> SQL
    WORKERS --> STORAGE
    API --> MAPS
    API --> WEATHER
    API --> AI
    API --> MESSAGE
```

Source basis: [high-level-architecture.md](../high-level-architecture.md), sections "System
Context", "Client Architecture", "Backend Architecture", and "Data Architecture";
[README.md](README.md), section "Approved Technology Profile".

## 3. Product Surfaces and Trust Boundaries

```mermaid
flowchart TB
    subgraph People[Actors]
        OWNER[Owner]
        EDITOR[Editor]
        VIEWER[Internal viewer]
        PUBLISHER[Explicit publisher capability]
        CLIENT[Professional client]
    end

    IOSAPP[Native iOS application]

    subgraph WebApplication[One Next.js web application and deployment]
        WEBAPP[Operational route group]
        CLIENTWEB[Client portal route group]
    end

    subgraph DataPlanes[Separate server-authorized data planes]
        LIVE[Live accepted garden<br/>tasks, observations, plants<br/>media, drafts, and history]
        PROJECTION[Immutable publication projection<br/>selected safe snapshots and derivatives]
    end

    OWNER --> IOSAPP
    OWNER --> WEBAPP
    EDITOR --> IOSAPP
    EDITOR --> WEBAPP
    VIEWER --> IOSAPP
    VIEWER --> WEBAPP
    IOSAPP --> LIVE
    WEBAPP --> LIVE
    PUBLISHER -->|review and publish| PROJECTION
    LIVE -->|explicit selection only| PROJECTION
    CLIENT --> CLIENTWEB
    CLIENTWEB --> PROJECTION
    LIVE -. no direct client query .-> CLIENTWEB
```

The client portal is not an operational viewer with hidden controls. It reads a separate immutable
publication projection and cannot access internal tasks, drafts, recommendations, diagnostics,
sensitive raw captures, or unpublished media.

Source basis: [collaboration-and-client-sharing.md](collaboration-and-client-sharing.md), sections
"Core Boundary", "Operational Roles and Capabilities", and "Publication Workflow";
[identity-and-authorization.md](identity-and-authorization.md), sections "Operational Garden
Roles" and "Authorization Evaluation".

## 4. Client Architecture

```mermaid
flowchart LR
    subgraph Native[Native Apple client]
        NVIEW[SwiftUI views<br/>feature MVVM]
        NAPP[Application use cases]
        NDOMAIN[Domain models and policies]
        NINFRA[Gateways and adapters]
        SQLITE[(GRDB and SQLite<br/>read models, outbox, drafts)]
        DEVICE[Camera, ARKit, LiDAR<br/>location and background transfer]

        NVIEW --> NAPP
        NAPP --> NDOMAIN
        NAPP --> NINFRA
        NINFRA --> SQLITE
        NINFRA --> DEVICE
    end

    subgraph Browser[Web client]
        ROUTES[Next.js route groups<br/>application and client portal]
        QUERY[TanStack Query<br/>server state]
        EDITORSTATE[Zustand<br/>map editor state]
        FORMS[React Hook Form and Zod]
        DRAFTS[IndexedDB or local storage<br/>recoverable drafts]

        ROUTES --> QUERY
        ROUTES --> EDITORSTATE
        ROUTES --> FORMS
        FORMS --> DRAFTS
    end

    CONTRACT[Generated clients<br/>from versioned OpenAPI]
    API[Verdery HTTPS API]

    NINFRA --> CONTRACT
    QUERY --> CONTRACT
    CONTRACT --> API
```

Native is offline-capable for selected operations and owns durable pending changes. Web is
online-first and may preserve explicit drafts, but it does not implement a second full
synchronization engine.

Source basis: [ios-application-design.md](ios-application-design.md), sections "Application
Structure", "Local Persistence", and "Synchronization Integration";
[web-application-design.md](web-application-design.md), sections "Application Structure", "State
Ownership", and "Online-First Behavior".

## 5. Backend Modular Monolith

```mermaid
flowchart TB
    HTTP[Fastify transport<br/>authentication, validation<br/>OpenAPI mapping]
    APP[Application layer<br/>commands, queries, transactions<br/>authorization requirements]
    DOMAIN[Domain layer<br/>entities, policies, state transitions]
    PORTS[Declared ports]
    ADAPTERS[Persistence and provider adapters]
    PLATFORM[Small platform layer<br/>database, telemetry, messaging<br/>storage, configuration]

    HTTP --> APP
    APP --> DOMAIN
    APP --> PORTS
    ADAPTERS --> PORTS
    ADAPTERS --> PLATFORM

    subgraph Modules[Application modules]
        IAM[Identity and access]
        GARDENS[Gardens and mapping]
        PLANTS[Plants and inventory]
        OBS[Observations and history]
        CARE[Tasks and recommendations]
        MEDIA[Media]
        CAPTURE[Capture and import]
        COLLAB[Collaboration]
        INTEGRATIONS[Integrations]
        ADMIN[Administration]
    end

    APP --> Modules
    Modules --> DOMAIN
```

Each module exposes a narrow public interface. Modules do not import another module's private
persistence implementation. The backend remains one deployable API until measured scaling,
security, reliability, ownership, or runtime evidence justifies extraction.

Source basis: [backend-modular-monolith.md](backend-modular-monolith.md), sections "Module Shape",
"Initial Modules", "Dependency Direction", and "Extraction Criteria".

## 6. Domain and Data Ownership

```mermaid
flowchart TB
    PROFILE[Application profile]
    GARDEN[Garden aggregate]
    MEMBERSHIP[Operational membership<br/>owner, editor, viewer]
    ORG[Service organization<br/>and garden assignment]
    ENGAGEMENT[Client engagement]
    PUBLICATION[Immutable client publication]

    SPACE[Coordinate space<br/>local planar plus optional georeference]
    OBJECT[Garden object<br/>typed geometry and revision]
    PLANT[Actual plant<br/>stable identity and history]
    CANDIDATE[Plant candidate<br/>planned, evaluated, convertible]
    OBSERVATION[Observation and visual journal]
    TASK[Task and recommendation]
    MEDIA[Media record and derivatives]

    PROFILE --> MEMBERSHIP
    MEMBERSHIP --> GARDEN
    PROFILE --> ORG
    ORG --> GARDEN
    GARDEN --> ENGAGEMENT
    ENGAGEMENT --> PUBLICATION
    GARDEN --> SPACE
    SPACE --> OBJECT
    GARDEN --> PLANT
    GARDEN --> CANDIDATE
    CANDIDATE -->|explicit conversion| PLANT
    PLANT --> OBSERVATION
    GARDEN --> TASK
    OBSERVATION --> MEDIA
    PLANT --> MEDIA
    PUBLICATION -->|safe snapshots and derivatives| MEDIA
```

PostgreSQL and PostGIS are authoritative for synchronized accepted domain state. Cloud Storage owns
binary bytes, while PostgreSQL owns media identity, authorization, provenance, processing state,
retention, and references. Current state is paired with revision journals or append-oriented facts
where history must be preserved.

Source basis: [data-and-geospatial-design.md](data-and-geospatial-design.md), sections "Garden
Aggregate", "Garden Object Model", "Revision Model", and "Append-Oriented Records";
[plant-intelligence-and-visual-journal.md](plant-intelligence-and-visual-journal.md);
[media-storage-and-processing.md](media-storage-and-processing.md), section "Media Record".

## 7. Native Offline Synchronization

```mermaid
sequenceDiagram
    participant User
    participant UI as Native UI
    participant DB as SQLite and GRDB
    participant Sync as Sync engine
    participant API as Cloud Run API
    participant PG as PostgreSQL

    User->>UI: Perform offline-capable command
    UI->>DB: One transaction
    Note over DB: Update optimistic read model<br/>and append UUIDv7 outbox operation
    DB-->>UI: Locally saved, synchronization pending

    Sync->>DB: Read bounded dependency-aware batch
    Sync->>API: POST /v1/sync/push
    API->>PG: Authorize and execute idempotently
    PG-->>API: Accepted, duplicate, conflict,<br/>rejected, blocked, or retry later
    API-->>Sync: Per-operation stable outcomes
    Sync->>DB: Apply outcomes and revisions atomically

    Sync->>API: GET /v1/sync/changes after cursor
    API->>PG: Read authorized ordered changes
    PG-->>API: Change page and next cursor
    API-->>Sync: Authorized changes
    Sync->>DB: Apply page and advance cursor<br/>in one transaction
```

SQLite is authoritative only for pending local intent until the server accepts or explicitly
rejects it. PostgreSQL remains authoritative for synchronized accepted state. Client publications
are server-authoritative projections and never enter the operational mutation outbox.

Source basis: [offline-synchronization.md](offline-synchronization.md), sections "Authority Model",
"Local Mutation Transaction", "Push Protocol", and "Pull Protocol".

## 8. Media and Asynchronous Processing

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant GCS as Private Cloud Storage
    participant DB as PostgreSQL and outbox
    participant Tasks as Cloud Tasks
    participant Worker as Worker service or job

    Client->>API: Register upload and request authorization
    API->>DB: Create media record and quota reservation
    API-->>Client: Short-lived resumable upload session
    Client->>GCS: Upload bytes directly
    Client->>API: Complete upload with checksum metadata
    API->>DB: Mark uploaded and append outbox event
    DB-->>Tasks: Outbox relay enqueues idempotent command
    Tasks->>Worker: Authenticated processing request
    Worker->>GCS: Read unverified original
    Worker->>Worker: Validate, classify, and derive
    Worker->>GCS: Write new derivative objects
    Worker->>API: Authenticated result callback
    API->>DB: Commit processing result and derivative metadata
    Client->>API: Request authorized media access
    API-->>Client: Short-lived access to allowed derivative or original
```

Large bytes never pass through the interactive API. Messages carry identifiers and references, not
media content. Processing is versioned, duplicate-safe, observable, retry-aware, and bounded by
quota and retention policy.

Source basis: [media-storage-and-processing.md](media-storage-and-processing.md), sections "Upload
Flow", "Processing Manifest", and "Download Flow"; [asynchronous-processing.md](asynchronous-processing.md),
sections "Transactional Outbox", "Cloud Tasks", and "Cloud Run Jobs".

## 9. Garden Mapping and Capture Evolution

```mermaid
flowchart LR
    MANUAL[Manual 2D editor<br/>dimensions and snapping]
    PLAN[Plan or image import<br/>calibration and tracing]
    AR[Phase 12 voice-guided AR<br/>points, lines, polygons, height]
    DEPTH[Optional depth and LiDAR<br/>quality enhancement]
    ACCEPT[Reviewable proposal<br/>explicit user acceptance]
    MAP[Accepted garden map<br/>ordinary editable objects]
    WEB[Web correction and inspection]
    RESEARCH[Future automated reconstruction<br/>research only]

    MANUAL --> MAP
    PLAN --> ACCEPT
    AR --> ACCEPT
    DEPTH --> AR
    ACCEPT --> MAP
    MAP --> WEB
    MAP -. comparison baseline .-> RESEARCH
    RESEARCH -. new ADR and phase required .-> ACCEPT
```

```mermaid
flowchart TB
    PLANMEDIA[Imported plan or image]

    subgraph Device[On device]
        PERMISSIONS[Permissions and safety]
        TRACKING[AR tracking, location,<br/>heading and immediate feedback]
        VOICE[Bounded voice commands<br/>with touch fallback]
        PARTIAL[Durable partial points<br/>checkpoints and recovery]
        PREVIEW[Measurements, uncertainty<br/>and explicit confirmation]
        ACCEPTED[Accepted map command<br/>ready to synchronize]
    end

    subgraph Cloud[Approved cloud boundary]
        VALIDATE[Media validation]
        PLANEXTRACT[Document and line extraction]
        QUALITY[Quality and audit metadata]
    end

    PERMISSIONS --> TRACKING
    TRACKING --> VOICE
    VOICE --> PARTIAL
    PARTIAL --> PREVIEW
    PREVIEW --> ACCEPTED
    PLANMEDIA --> VALIDATE
    VALIDATE --> PLANEXTRACT
    PLANEXTRACT --> QUALITY
```

Automated multi-capture reconstruction is not a committed production stage. It may return only if
Phase 12 evidence identifies a material remaining problem and a new ADR approves a newly numbered
delivery phase.

Source basis: [garden-capture-and-scan.md](garden-capture-and-scan.md), sections "Staged Capability
Plan", "Hybrid Processing Boundary", and "Future Research: Automated Reconstruction";
[implementation-plan.md](../implementation-plan.md), sections "Phase 12" and "Future Research".

## 10. Deployment and Network Topology

### 10.1 Approved production target

```mermaid
flowchart TB
    INTERNET[Internet clients]
    WEBHOST[Firebase App Hosting target<br/>Next.js managed runtime]
    LB[Global HTTPS Load Balancer]
    ARMOR[Cloud Armor]
    NEG[Serverless NEG]
    API[Cloud Run API<br/>stateless revisions]
    WORKER[Private Cloud Run workers<br/>and Cloud Run Jobs]
    VPC[Direct VPC egress<br/>private ranges only]
    SQL[(Cloud SQL PostgreSQL<br/>private IP)]
    GCS[(Private Cloud Storage)]
    GOOGLE[Authenticated Google APIs<br/>Tasks, Pub/Sub, Secret Manager]

    INTERNET --> WEBHOST
    INTERNET --> LB
    LB --> ARMOR
    ARMOR --> NEG
    NEG --> API
    API --> VPC
    WORKER --> VPC
    VPC --> SQL
    API --> GCS
    WORKER --> GCS
    API --> GOOGLE
    WORKER --> GOOGLE
```

### 10.2 Environment isolation and delivery

```mermaid
flowchart LR
    GIT[GitHub repository]
    CI[GitHub Actions CI<br/>format, lint, types, tests<br/>contracts, Swift, security]
    WIF[Workload Identity Federation<br/>no downloaded cloud key]
    ARTIFACTS[Artifact Registry<br/>immutable images]

    subgraph DEV[Development project]
        DEVAPP[API, web, and workers]
        DEVDB[(Development database)]
        DEVMEDIA[(Development buckets)]
    end

    subgraph STAGE[Staging target]
        STAGEAPP[Production-like services]
        STAGEDB[(Isolated database)]
    end

    subgraph PROD[Production target]
        PRODAPP[Protected services]
        PRODDB[(Regional HA database)]
    end

    GIT --> CI
    CI --> WIF
    WIF --> ARTIFACTS
    ARTIFACTS --> DEVAPP
    DEVAPP --> DEVDB
    DEVAPP --> DEVMEDIA
    ARTIFACTS -. approved promotion .-> STAGEAPP
    STAGEAPP --> STAGEDB
    ARTIFACTS -. approved promotion .-> PRODAPP
    PRODAPP --> PRODDB
```

Development is the only existing persistent environment. Staging and production are approved
targets, not claims about currently provisioned infrastructure.

Source basis: [networking.md](networking.md), sections "Production Topology" and "Environment
Isolation"; [environments-and-delivery.md](environments-and-delivery.md), sections "Environments",
"GitHub Actions", and "Release Promotion".

## 11. Security, Privacy, and Observability Controls

```mermaid
flowchart LR
    REQUEST[Client or service request]
    TLS[TLS and controlled ingress]
    AUTHN[Firebase authentication<br/>or workload identity]
    APPCHECK[App Check signal<br/>where supported]
    AUTHZ[Server-side capability<br/>and resource authorization]
    VALIDATE[Schema and domain validation]
    TRANSACTION[Idempotent transaction<br/>revision and audit]
    DATA[(Authorized data)]

    REQUEST --> TLS
    TLS --> AUTHN
    AUTHN --> APPCHECK
    APPCHECK --> AUTHZ
    AUTHZ --> VALIDATE
    VALIDATE --> TRANSACTION
    TRANSACTION --> DATA

    TELEMETRY[Structured logs, metrics,<br/>traces and correlation]
    AUDIT[Durable security audit]
    REDACTION[No secrets, tokens, signed URLs,<br/>precise geometry or raw media]

    AUTHN --> TELEMETRY
    AUTHZ --> AUDIT
    TRANSACTION --> TELEMETRY
    TELEMETRY --> REDACTION
```

App Check is defense in depth, not a replacement for authentication or authorization. Garden,
organization, engagement, publication, and media entitlement are always resolved by the
application backend. Sensitive content is excluded from ordinary telemetry.

Source basis: [security-and-privacy.md](security-and-privacy.md), sections "Trust Boundaries",
"Authorization Controls", and "Telemetry and Logging";
[observability-and-analytics.md](observability-and-analytics.md), sections "Prohibited Telemetry"
and "Audit Versus Diagnostic Logs".

## 12. Delivery Roadmap Over the Architecture

```mermaid
flowchart LR
    FOUNDATION[Phases 1 to 8<br/>foundation implemented<br/>owner release gates remain]
    COLLAB[Phase 9<br/>collaboration, client delivery<br/>and seasonal context]
    PHOTO[Phase 10<br/>plant identification<br/>and plan OCR]
    PLANT[Phase 11<br/>plant intelligence, candidates<br/>and visual journal]
    FIELD[Phase 12<br/>voice-guided AR mapping<br/>and solar context]
    ASSISTANT[Phase 13<br/>constrained assistant]
    VIEW3D[Phase 14<br/>3D and Time Machine]
    RECON[Automated reconstruction<br/>unnumbered research]

    FOUNDATION --> COLLAB
    FOUNDATION --> PHOTO
    PHOTO --> PLANT
    PLANT --> FIELD
    FOUNDATION --> ASSISTANT
    FOUNDATION --> VIEW3D
    FIELD -. evidence baseline .-> RECON
```

Later phases reuse the same accepted garden, plant, history, media, authorization, and publication
identities. They must not create parallel data authorities.

Source basis: [implementation-plan.md](../implementation-plan.md), sections "Dependency Graph",
"Phase 10", "Phase 11", "Phase 12", "Phase 13", and "Phase 14".

## 13. Known Documentation Tension

The approved high-level baseline names Firebase App Hosting as the web delivery platform, while the
current development workflow builds and deploys the Next.js web container directly to Cloud Run.
This presentation therefore shows Firebase App Hosting only in the approved production-target
diagram and describes the development environment generically as API, web, and worker services.

- **Evidence:** [high-level-architecture.md](../high-level-architecture.md), sections "Approved
  Architecture Decisions" and "Web Application"; [web-application-design.md](web-application-design.md),
  section "Runtime and Hosting"; the repository's `.github/workflows/deploy-dev.yml` and
  `infrastructure/gcloud/scripts/deploy-web.sh` implement direct development deployment.
- **Impact:** Readers cannot currently infer whether direct Cloud Run hosting is a development-only
  implementation choice or a replacement for the approved hosting baseline.
- **Proposal:** Record an ADR that either confirms direct Cloud Run as development-only and defines
  the Firebase App Hosting promotion path, or supersedes the web-hosting baseline and synchronizes
  the high-level, web, delivery, networking, and cost documents.
- **Confidence:** High.

## 14. How to Read the Detailed Architecture

1. Start with diagrams 2 through 6 for product, runtime, module, and data boundaries.
2. Use diagrams 7 and 8 for the two most important durable flows: offline synchronization and
   media processing.
3. Use diagram 9 for the garden-capture direction and its research boundary.
4. Use diagrams 10 and 11 for deployment, trust boundaries, and operations.
5. Follow the source links under any diagram before changing the represented boundary.
