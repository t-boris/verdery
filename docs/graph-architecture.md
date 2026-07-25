# Grow Garden — C4 Component Architecture Diagram

This diagram is a C4 level-3 style component view of the approved Grow Garden architecture, derived
from `high-level-architecture.md` and the detailed designs under `architecture/`.

It shows every actor, client-side subsystem, backend module, platform capability, asynchronous
primitive, worker, job, data store, managed Firebase/Google Cloud service, third-party provider, and
delivery component described in the documentation, together with the connections between them.

Reading order follows the request path: people use the native Apple client or the web client, both
reach the Cloud Run modular monolith through the protected edge, and the monolith owns PostgreSQL,
Cloud Storage, and the asynchronous primitives that drive workers, jobs, and external providers.

Internal systems (built and owned by the product) are grouped separately from external systems
(Firebase/Google Cloud managed services, Apple platform frameworks, and third-party providers).

```mermaid
%%INTERACTIVE
graph TB

%% ============================================================
%% PEOPLE AND ROLES
%% ============================================================
subgraph ACTORS["People and Roles"]
    direction LR
    ACT_OWNER["Garden Owner"]
    ACT_EDITOR["Editor - household member or colleague"]
    ACT_VIEWER["Internal Viewer"]
    ACT_ORGADMIN["Organization Administrator"]
    ACT_PRO["Assigned Professional"]
    ACT_PUBLISHER["Client Publisher capability holder"]
    ACT_CLIENT["Professional Service Client"]
    ACT_SUPPORT["Support and Operations Staff"]
end

%% ============================================================
%% INTERNAL - NATIVE APPLE CLIENT
%% ============================================================
subgraph IOS["INTERNAL - Native Apple Client - Swift, SwiftUI, GRDB"]
    IOS_UI["Presentation - SwiftUI views and feature view models"]
    IOS_ROUTER["Typed application router and deep links"]

    subgraph IOS_FEATURES["Feature Modules"]
        direction LR
        IOS_F_AUTH["Authentication feature"]
        IOS_F_GARDENLIST["Garden List feature"]
        IOS_F_MAP["Garden Map feature"]
        IOS_F_PLANTS["Plants feature"]
        IOS_F_OBS["Observations feature"]
        IOS_F_TASKS["Tasks feature"]
        IOS_F_RECS["Recommendations feature"]
        IOS_F_PLAN["Plan Import feature"]
        IOS_F_CAPTURE["Garden Capture feature"]
        IOS_F_MEDIA["Media Library feature"]
        IOS_F_COLLAB["Collaboration feature"]
        IOS_F_SETTINGS["Settings feature"]
    end

    subgraph IOS_CORE["Core Packages"]
        IOS_COMPOSITION["App composition root"]
        IOS_USECASES["Application use cases"]
        IOS_DOMAIN["Domain models, geometry metadata, validation"]
        IOS_PERSIST["Persistence - GRDB repositories and migrations"]
        IOS_SQLITE["SQLite local store - read models, drafts, cursors, conflicts"]
        IOS_OUTBOX["SQLite sync outbox - durable pending operations"]
        IOS_SYNC["Synchronization engine - bounded push and pull cycles"]
        IOS_NET["Networking - application gateway over generated OpenAPI client"]
        IOS_AUTHADAPTER["Firebase Authentication adapter and Keychain"]
        IOS_APPCHECK["App Check adapter"]
        IOS_MEDIA_XFER["Media transfer coordinator - background resumable upload"]
        IOS_CAPTURE_COORD["Capture session coordinator"]
        IOS_EDITOR["Map editor session - command stack, snapping, validation"]
        IOS_RENDER["SwiftUI Canvas and Core Graphics renderer"]
        IOS_OBSERV["Observability - crash, spans, analytics events"]
        IOS_CAPABILITIES["Platform capability adapters and capability tiers"]
    end
end

%% ============================================================
%% INTERNAL - WEB CLIENT
%% ============================================================
subgraph WEB["INTERNAL - Web Client - TypeScript, React, Next.js"]
    subgraph WEB_ROUTES["App Router Route Groups"]
        direction LR
        WEB_R_PUBLIC["public routes"]
        WEB_R_AUTH["auth routes"]
        WEB_R_APP["application routes"]
        WEB_R_PORTAL["client-portal routes - read only"]
    end

    subgraph WEB_FEATURES["Feature Modules"]
        direction LR
        WEB_F_GARDENS["gardens"]
        WEB_F_MAPEDITOR["map-editor"]
        WEB_F_PLANTS["plants"]
        WEB_F_OBS["observations"]
        WEB_F_TASKS["tasks"]
        WEB_F_RECS["recommendations"]
        WEB_F_MEDIA["media"]
        WEB_F_IMPORTS["imports"]
        WEB_F_COLLAB["collaboration"]
        WEB_F_ENGAGE["client-engagements"]
        WEB_F_PUBS["client-publications"]
        WEB_F_TIMELINE["garden-timeline"]
        WEB_F_SETTINGS["settings"]
    end

    subgraph WEB_CORE["Core Packages"]
        WEB_API["API gateways over generated OpenAPI client"]
        WEB_QUERY["TanStack Query - server cache and mutations"]
        WEB_STORE["Zustand editor store - selection, tools, undo"]
        WEB_FORMS["React Hook Form and Zod validation"]
        WEB_AUTHC["Firebase auth client and session-cookie exchange"]
        WEB_GEOMETRY["Geometry and coordinate transformation service"]
        WEB_UPLOAD["Upload controller - resumable sessions"]
        WEB_DRAFTS["IndexedDB recoverable drafts"]
        WEB_ANALYTICS["Analytics adapter - owned event schema"]
        WEB_OBSERV["Web observability - vitals, errors, correlation"]
    end

    subgraph WEB_RENDER["Map Rendering Subsystem"]
        direction LR
        WEB_KONVA["Konva - garden local scene and handles"]
        WEB_MAPLIBRE["MapLibre - geographic context layer"]
        WEB_WORKER["Web Worker - geometry preparation"]
    end
end

%% ============================================================
%% EXTERNAL - EDGE AND NETWORKING
%% ============================================================
subgraph EDGE["EXTERNAL MANAGED - Google Cloud Edge and Networking"]
    NET_DNS["Cloud DNS and Google-managed TLS certificates"]
    NET_LB["Global external HTTPS Load Balancer"]
    NET_ARMOR["Cloud Armor - WAF, rate limits, threat rules"]
    NET_NEG["Serverless network endpoint group"]
    NET_CDN["Cloud CDN"]
    NET_VPC["VPC network and regional application subnet"]
    NET_DVE["Direct VPC egress - private ranges only"]
    NET_PSA["Private Service Access"]
    NET_PGA["Private Google Access"]
end

%% ============================================================
%% INTERNAL - BACKEND MODULAR MONOLITH
%% ============================================================
subgraph API["INTERNAL - Cloud Run API - TypeScript Fastify modular monolith"]
    API_BOOT["Bootstrap composition root and health lifecycle"]

    subgraph API_PLATFORM["Platform Layer"]
        direction LR
        PL_PIPE["Request pipeline - correlation, authn, App Check, rate limits, OpenAPI validation"]
        PL_CONFIG["Configuration - typed schema and secret references"]
        PL_DB["Database - Kysely, transactions, explicit PostGIS SQL"]
        PL_AUTH["Authentication - Firebase ID token and session verification"]
        PL_TELEMETRY["Telemetry - OpenTelemetry spans, structured logs, metrics"]
        PL_MSG["Messaging - task, event, and outbox adapters"]
        PL_STORAGE["Storage - upload session and signed access control plane"]
        PL_KERNEL["Shared kernel - UUIDv7, clock, units, pagination, actor context"]
        PL_IDEM["Idempotency and optimistic concurrency records"]
    end

    subgraph API_MODULES["Domain Modules"]
        direction LR
        M_IDENTITY["Identity and Access"]
        M_GARDENS["Gardens and Mapping"]
        M_PLANTS["Plants and Inventory"]
        M_OBS["Observations and History"]
        M_TASKS["Tasks and Recommendations"]
        M_MEDIA["Media"]
        M_CAPTURE["Capture and Import"]
        M_COLLAB["Collaboration - team, organizations, engagements, publications"]
        M_SYNC["Synchronization - push, changes, cursors, conflicts"]
        M_INTEGRATIONS["Integrations - provider ports and adapters"]
        M_ADMIN["Administration and Operations"]
    end

    subgraph API_SURFACES["REST Surfaces - OpenAPI v1"]
        direction LR
        SURF_APP["Operational garden API"]
        SURF_SYNC["Synchronization API - push, changes, acknowledge"]
        SURF_MEDIA["Media and upload-session API"]
        SURF_JOBS["Processing jobs API"]
        SURF_ORG["Professional workspace API"]
        SURF_PORTAL["Client portal API - publication only"]
        SURF_EXPORT["Export and deletion API"]
    end

    subgraph API_ENGINES["Domain Engines"]
        direction LR
        ENG_RULES["Versioned horticultural rule engine"]
        ENG_GEOM["Geometry validation and tolerance engine"]
        ENG_CAPS["Capability and authorization evaluator"]
        ENG_PUBLISH["Publication and snapshot builder"]
        ENG_ASSISTANT["Conversational assistant tool boundary"]
    end
end

%% ============================================================
%% INTERNAL - ASYNCHRONOUS PROCESSING
%% ============================================================
subgraph ASYNC["Asynchronous Processing"]
    ASY_OUTBOX["Transactional outbox relay"]
    ASY_TASKS["Cloud Tasks queues - verification, notification, deletion, export, provider, reconciliation"]
    ASY_PUBSUB["Pub/Sub topics, subscriptions and dead-letter subscriptions"]
    ASY_SCHED["Cloud Scheduler - weather refresh, recommendation batches, retention scans"]
    ASY_WORKFLOWS["Google Cloud Workflows - scan pipeline, account deletion, export assembly"]
    ASY_DLQ["Dead-letter destinations and replay tooling"]

    subgraph WORKERS["Cloud Run Worker Services and Jobs"]
        direction LR
        W_VERIFY["Media verification worker - TypeScript"]
        W_DERIV["Image derivative job - TypeScript"]
        W_VIDEO["Video frame extraction job - Python"]
        W_PLAN["Property plan extraction job - Python, OpenCV"]
        W_SCAN["Scan reconstruction job - Python, photogrammetry"]
        W_RECS["Bulk recommendation job - TypeScript"]
        W_NOTIFY["Notification dispatch worker - TypeScript"]
        W_EXPORT["Export generation job - TypeScript"]
        W_DELETE["Deletion and retention job - TypeScript"]
        W_PROJECTION["Search and projection rebuild job"]
        W_RECONCILE["Reconciliation and integrity-check job"]
        W_MIGRATE["Database migration job"]
    end
end

%% ============================================================
%% EXTERNAL MANAGED - DATA STORES
%% ============================================================
subgraph DATA["EXTERNAL MANAGED - Data Stores"]
    subgraph SQL["Cloud SQL for PostgreSQL 17 with PostGIS 3.5 - private IP"]
        direction LR
        DB_IDENTITY["identity - profiles, identity links, account state, consents"]
        DB_COLLAB["collaboration - memberships, organizations, assignments, engagements, work logs, publications, grants"]
        DB_GARDENS["gardens - gardens, coordinate spaces, garden objects, geometry revisions, georeference, calibration"]
        DB_PLANTS["plants - plant instances, placements, taxonomy references"]
        DB_OBS["observations - observations, measurements, history events, provenance"]
        DB_TASKS["tasks - tasks, recommendations, evidence, outcomes"]
        DB_MEDIA["media - media records, variants, upload and retention state"]
        DB_CAPTURE["capture - capture sessions, imports, proposals, processor results"]
        DB_PLATFORM["platform - outbox, idempotency, sync change log, tombstones, installations, audit"]
        DB_EXTREF["external reference - weather, plant content, provider payload metadata"]
    end

    subgraph GCS["Cloud Storage - private buckets"]
        direction LR
        B_USER["user-media bucket"]
        B_RAW["raw-capture bucket"]
        B_DERIVED["derived bucket"]
        B_EXPORTS["exports bucket"]
    end

    STORE_SECRETS["Secret Manager"]
    STORE_AR["Artifact Registry - immutable OCI images"]
    STORE_BACKUP["Cloud SQL automated backups and point-in-time recovery"]
end

%% ============================================================
%% EXTERNAL MANAGED - FIREBASE PLATFORM
%% ============================================================
subgraph FIREBASE["EXTERNAL MANAGED - Firebase Platform"]
    direction LR
    FB_AUTH["Firebase Authentication - Apple, Google, email magic link"]
    FB_APPCHECK["Firebase App Check"]
    FB_FCM["Firebase Cloud Messaging"]
    FB_CRASH["Firebase Crashlytics"]
    FB_HOSTING["Firebase App Hosting - Next.js on managed Cloud Run"]
    FB_ANALYTICS["Firebase Analytics and GA4"]
end

%% ============================================================
%% EXTERNAL MANAGED - OBSERVABILITY
%% ============================================================
subgraph OBSERV["EXTERNAL MANAGED - Observability and Operations"]
    direction LR
    OBS_OTEL["OpenTelemetry instrumentation and trace context"]
    OBS_LOGGING["Cloud Logging - structured logs and audit records"]
    OBS_MONITORING["Cloud Monitoring - metrics, dashboards, SLOs, alerts"]
    OBS_TRACE["Cloud Trace"]
    OBS_ERRORS["Error Reporting"]
    OBS_BUDGET["Cloud Billing budgets and anomaly alerts"]
end

%% ============================================================
%% INTERNAL - DELIVERY AND PROVISIONING
%% ============================================================
subgraph DELIVERY["Delivery, Environments and Provisioning"]
    direction LR
    DEL_GHA["GitHub Actions - CI gates, build, deploy"]
    DEL_WIF["Workload Identity Federation"]
    DEL_GCLOUD["Versioned idempotent gcloud provisioning scripts"]
    DEL_SA["Least-privilege service accounts - api runtime, deploy, relay, notifier, verifier, scan, export"]
    DEL_FLAGS["Feature flags and controlled rollout"]
    DEL_ENVS["Separate projects - development, staging, production"]
    DEL_LOCAL["Local development - containerized PostgreSQL/PostGIS and emulators"]
end

%% ============================================================
%% EXTERNAL - THIRD-PARTY SYSTEMS
%% ============================================================
subgraph EXTERNAL["EXTERNAL - Third-Party Systems and Providers"]
    direction LR
    EXT_WEATHER["Weather provider - forecasts and observations"]
    EXT_GEOCODE["Geocoding and regional context provider"]
    EXT_TILES["Basemap, aerial and satellite tile provider"]
    EXT_PLANT["Plant taxonomy and horticultural content provider"]
    EXT_VERTEX["Vertex AI - generative and ML inference"]
    EXT_EMAIL["Transactional email provider"]
    EXT_SENTRY["Approved web error collection - Sentry"]
    EXT_APNS["APNs push transport behind FCM"]
    EXT_GITHUB["GitHub repository and environments"]
    EXT_APPSTORE["Apple App Store distribution"]
end

%% ============================================================
%% EXTERNAL - APPLE PLATFORM FRAMEWORKS
%% ============================================================
subgraph APPLEFW["EXTERNAL - Apple Platform Frameworks"]
    direction LR
    AFW_ARKIT["ARKit - tracking, anchors, depth, scene reconstruction"]
    AFW_AV["AVFoundation and PhotosUI"]
    AFW_VISION["Vision and Core ML"]
    AFW_LOCATION["Core Location and Core Motion"]
    AFW_MAPKIT["MapKit - geographic context"]
    AFW_BGTRANSFER["Background transfer subsystem"]
end

%% ============================================================
%% EDGES - ACTORS TO CLIENTS
%% ============================================================
ACT_OWNER --> IOS_UI
ACT_OWNER --> WEB_R_APP
ACT_EDITOR --> IOS_UI
ACT_EDITOR --> WEB_R_APP
ACT_VIEWER --> IOS_UI
ACT_VIEWER --> WEB_R_APP
ACT_PRO --> IOS_UI
ACT_PRO --> WEB_R_APP
ACT_ORGADMIN --> WEB_R_APP
ACT_PUBLISHER --> WEB_R_APP
ACT_CLIENT --> WEB_R_PORTAL
ACT_SUPPORT --> M_ADMIN
ACT_SUPPORT --> OBS_MONITORING
ACT_SUPPORT --> DEL_GCLOUD

%% ============================================================
%% EDGES - NATIVE CLIENT INTERNALS
%% ============================================================
IOS_UI --> IOS_ROUTER
IOS_ROUTER --> IOS_USECASES
IOS_COMPOSITION --> IOS_USECASES
IOS_F_AUTH --> IOS_USECASES
IOS_F_GARDENLIST --> IOS_USECASES
IOS_F_MAP --> IOS_USECASES
IOS_F_PLANTS --> IOS_USECASES
IOS_F_OBS --> IOS_USECASES
IOS_F_TASKS --> IOS_USECASES
IOS_F_RECS --> IOS_USECASES
IOS_F_PLAN --> IOS_USECASES
IOS_F_CAPTURE --> IOS_USECASES
IOS_F_MEDIA --> IOS_USECASES
IOS_F_COLLAB --> IOS_USECASES
IOS_F_SETTINGS --> IOS_USECASES
IOS_F_MAP --> IOS_EDITOR
IOS_F_CAPTURE --> IOS_CAPTURE_COORD
IOS_F_MEDIA --> IOS_MEDIA_XFER
IOS_F_PLAN --> IOS_MEDIA_XFER
IOS_F_AUTH --> IOS_AUTHADAPTER
IOS_USECASES --> IOS_DOMAIN
IOS_USECASES --> IOS_PERSIST
IOS_USECASES --> IOS_SYNC
IOS_USECASES --> IOS_NET
IOS_USECASES --> IOS_MEDIA_XFER
IOS_USECASES --> IOS_CAPTURE_COORD
IOS_EDITOR --> IOS_RENDER
IOS_EDITOR --> IOS_DOMAIN
IOS_PERSIST --> IOS_SQLITE
IOS_PERSIST --> IOS_OUTBOX
IOS_SYNC --> IOS_OUTBOX
IOS_SYNC --> IOS_SQLITE
IOS_SYNC --> IOS_NET
IOS_MEDIA_XFER --> IOS_SQLITE
IOS_MEDIA_XFER --> AFW_BGTRANSFER
IOS_CAPTURE_COORD --> IOS_CAPABILITIES
IOS_CAPTURE_COORD --> IOS_SQLITE
IOS_CAPABILITIES --> AFW_ARKIT
IOS_CAPABILITIES --> AFW_AV
IOS_CAPABILITIES --> AFW_VISION
IOS_CAPABILITIES --> AFW_LOCATION
IOS_RENDER --> AFW_MAPKIT
IOS_NET --> IOS_AUTHADAPTER
IOS_NET --> IOS_APPCHECK
IOS_AUTHADAPTER --> FB_AUTH
IOS_APPCHECK --> FB_APPCHECK
IOS_OBSERV --> FB_CRASH
IOS_OBSERV --> FB_ANALYTICS
IOS_UI --> IOS_OBSERV
FB_FCM --> IOS_UI
AFW_MAPKIT --> EXT_TILES
EXT_APPSTORE --> IOS_COMPOSITION

%% ============================================================
%% EDGES - NATIVE CLIENT TO BACKEND AND STORAGE
%% ============================================================
IOS_NET -->|HTTPS REST v1| NET_LB
IOS_SYNC -->|push and pull batches| NET_LB
IOS_MEDIA_XFER -->|resumable upload| B_USER
IOS_MEDIA_XFER -->|raw capture upload| B_RAW

%% ============================================================
%% EDGES - WEB CLIENT INTERNALS
%% ============================================================
FB_HOSTING -->|serves shell and server components| WEB_ROUTES
WEB_R_AUTH --> WEB_AUTHC
WEB_R_APP --> WEB_QUERY
WEB_R_PORTAL --> WEB_API
WEB_R_PUBLIC --> WEB_OBSERV
WEB_F_GARDENS --> WEB_API
WEB_F_MAPEDITOR --> WEB_API
WEB_F_PLANTS --> WEB_API
WEB_F_OBS --> WEB_API
WEB_F_TASKS --> WEB_API
WEB_F_RECS --> WEB_API
WEB_F_MEDIA --> WEB_API
WEB_F_IMPORTS --> WEB_API
WEB_F_COLLAB --> WEB_API
WEB_F_ENGAGE --> WEB_API
WEB_F_PUBS --> WEB_API
WEB_F_TIMELINE --> WEB_API
WEB_F_SETTINGS --> WEB_API
WEB_F_MAPEDITOR --> WEB_STORE
WEB_F_MAPEDITOR --> WEB_KONVA
WEB_F_MAPEDITOR --> WEB_MAPLIBRE
WEB_F_MAPEDITOR --> WEB_GEOMETRY
WEB_F_MEDIA --> WEB_UPLOAD
WEB_F_IMPORTS --> WEB_UPLOAD
WEB_F_IMPORTS --> WEB_DRAFTS
WEB_API --> WEB_QUERY
WEB_QUERY --> WEB_FORMS
WEB_GEOMETRY --> WEB_WORKER
WEB_KONVA --> WEB_GEOMETRY
WEB_MAPLIBRE --> EXT_TILES
WEB_AUTHC --> FB_AUTH
WEB_AUTHC --> FB_APPCHECK
WEB_ANALYTICS --> FB_ANALYTICS
WEB_OBSERV --> EXT_SENTRY
WEB_OBSERV --> OBS_ERRORS
WEB_STORE --> WEB_DRAFTS
WEB_DRAFTS --> WEB_FORMS

%% ============================================================
%% EDGES - WEB CLIENT TO BACKEND AND STORAGE
%% ============================================================
WEB_API -->|HTTPS REST v1| NET_LB
WEB_UPLOAD -->|resumable upload| B_USER
WEB_UPLOAD -->|imported plans| B_USER
NET_CDN --> WEB_R_PUBLIC

%% ============================================================
%% EDGES - EDGE AND NETWORK PATH
%% ============================================================
NET_DNS --> NET_LB
NET_LB --> NET_ARMOR
NET_ARMOR --> NET_NEG
NET_NEG --> PL_PIPE
NET_LB --> NET_CDN
PL_DB --> NET_DVE
NET_DVE --> NET_VPC
NET_VPC --> NET_PSA
NET_PSA --> SQL
NET_VPC --> NET_PGA
NET_PGA --> GCS

%% ============================================================
%% EDGES - API PLATFORM AND MODULES
%% ============================================================
API_BOOT --> PL_CONFIG
API_BOOT --> PL_TELEMETRY
API_BOOT --> PL_DB
API_BOOT --> API_MODULES
PL_PIPE --> PL_AUTH
PL_PIPE --> PL_IDEM
PL_PIPE --> API_SURFACES
PL_CONFIG --> STORE_SECRETS
PL_AUTH --> FB_AUTH
PL_AUTH --> FB_APPCHECK
PL_TELEMETRY --> OBS_OTEL
PL_MSG --> ASY_TASKS
PL_MSG --> ASY_PUBSUB
PL_MSG --> DB_PLATFORM
PL_STORAGE --> B_USER
PL_STORAGE --> B_RAW
PL_STORAGE --> B_DERIVED
PL_STORAGE --> B_EXPORTS
PL_IDEM --> DB_PLATFORM
PL_KERNEL --> API_MODULES

SURF_APP --> M_GARDENS
SURF_APP --> M_PLANTS
SURF_APP --> M_OBS
SURF_APP --> M_TASKS
SURF_APP --> M_IDENTITY
SURF_SYNC --> M_SYNC
SURF_MEDIA --> M_MEDIA
SURF_JOBS --> M_CAPTURE
SURF_ORG --> M_COLLAB
SURF_PORTAL --> M_COLLAB
SURF_EXPORT --> M_ADMIN

M_IDENTITY --> ENG_CAPS
M_COLLAB --> ENG_CAPS
M_COLLAB --> ENG_PUBLISH
M_GARDENS --> ENG_GEOM
M_CAPTURE --> ENG_GEOM
M_TASKS --> ENG_RULES
M_TASKS --> ENG_ASSISTANT
ENG_RULES --> M_INTEGRATIONS
ENG_ASSISTANT --> M_INTEGRATIONS

M_IDENTITY --> PL_DB
M_GARDENS --> PL_DB
M_PLANTS --> PL_DB
M_OBS --> PL_DB
M_TASKS --> PL_DB
M_MEDIA --> PL_DB
M_CAPTURE --> PL_DB
M_COLLAB --> PL_DB
M_SYNC --> PL_DB
M_ADMIN --> PL_DB
M_MEDIA --> PL_STORAGE
M_CAPTURE --> PL_STORAGE
M_ADMIN --> PL_STORAGE
M_GARDENS --> PL_MSG
M_MEDIA --> PL_MSG
M_CAPTURE --> PL_MSG
M_COLLAB --> PL_MSG
M_TASKS --> PL_MSG
M_ADMIN --> PL_MSG
M_INTEGRATIONS --> PL_CONFIG

%% ============================================================
%% EDGES - MODULE DATA OWNERSHIP
%% ============================================================
PL_DB --> DB_IDENTITY
PL_DB --> DB_COLLAB
PL_DB --> DB_GARDENS
PL_DB --> DB_PLANTS
PL_DB --> DB_OBS
PL_DB --> DB_TASKS
PL_DB --> DB_MEDIA
PL_DB --> DB_CAPTURE
PL_DB --> DB_PLATFORM
PL_DB --> DB_EXTREF
M_IDENTITY -.owns.-> DB_IDENTITY
M_COLLAB -.owns.-> DB_COLLAB
M_GARDENS -.owns.-> DB_GARDENS
M_PLANTS -.owns.-> DB_PLANTS
M_OBS -.owns.-> DB_OBS
M_TASKS -.owns.-> DB_TASKS
M_MEDIA -.owns.-> DB_MEDIA
M_CAPTURE -.owns.-> DB_CAPTURE
M_SYNC -.owns.-> DB_PLATFORM
M_INTEGRATIONS -.owns.-> DB_EXTREF

%% ============================================================
%% EDGES - ASYNCHRONOUS PROCESSING
%% ============================================================
DB_PLATFORM --> ASY_OUTBOX
ASY_OUTBOX --> ASY_PUBSUB
ASY_OUTBOX --> ASY_TASKS
ASY_SCHED --> ASY_TASKS
ASY_TASKS --> ASY_WORKFLOWS
ASY_WORKFLOWS --> W_VIDEO
ASY_WORKFLOWS --> W_SCAN
ASY_WORKFLOWS --> W_DELETE
ASY_WORKFLOWS --> W_EXPORT
ASY_TASKS --> W_VERIFY
ASY_TASKS --> W_NOTIFY
ASY_TASKS --> W_DERIV
ASY_TASKS --> W_PLAN
ASY_TASKS --> W_RECS
ASY_TASKS --> W_DELETE
ASY_TASKS --> W_EXPORT
ASY_TASKS --> W_RECONCILE
ASY_PUBSUB --> W_NOTIFY
ASY_PUBSUB --> W_PROJECTION
ASY_PUBSUB --> W_RECONCILE
ASY_PUBSUB --> ASY_DLQ
ASY_TASKS --> ASY_DLQ
ASY_DLQ --> OBS_MONITORING

%% ============================================================
%% EDGES - WORKERS TO DATA AND PROVIDERS
%% ============================================================
W_VERIFY --> B_USER
W_VERIFY --> B_RAW
W_VERIFY --> DB_MEDIA
W_DERIV --> B_USER
W_DERIV --> B_DERIVED
W_DERIV --> DB_MEDIA
W_VIDEO --> B_RAW
W_VIDEO --> B_DERIVED
W_VIDEO --> DB_CAPTURE
W_PLAN --> B_USER
W_PLAN --> B_DERIVED
W_PLAN --> DB_CAPTURE
W_SCAN --> B_RAW
W_SCAN --> B_DERIVED
W_SCAN --> DB_CAPTURE
W_SCAN --> DB_GARDENS
W_SCAN --> EXT_VERTEX
W_RECS --> DB_TASKS
W_RECS --> DB_EXTREF
W_RECS --> EXT_VERTEX
W_NOTIFY --> DB_PLATFORM
W_NOTIFY --> FB_FCM
W_NOTIFY --> EXT_EMAIL
W_EXPORT --> SQL
W_EXPORT --> B_EXPORTS
W_DELETE --> SQL
W_DELETE --> GCS
W_DELETE --> FB_AUTH
W_PROJECTION --> SQL
W_RECONCILE --> SQL
W_RECONCILE --> GCS
W_MIGRATE --> SQL
FB_FCM --> EXT_APNS

%% ============================================================
%% EDGES - EXTERNAL PROVIDER ADAPTERS
%% ============================================================
M_INTEGRATIONS --> EXT_WEATHER
M_INTEGRATIONS --> EXT_GEOCODE
M_INTEGRATIONS --> EXT_TILES
M_INTEGRATIONS --> EXT_PLANT
M_INTEGRATIONS --> EXT_VERTEX
M_INTEGRATIONS --> EXT_EMAIL
M_INTEGRATIONS --> DB_EXTREF
M_COLLAB --> EXT_EMAIL

%% ============================================================
%% EDGES - OBSERVABILITY
%% ============================================================
OBS_OTEL --> OBS_TRACE
OBS_OTEL --> OBS_LOGGING
OBS_OTEL --> OBS_MONITORING
PL_TELEMETRY --> OBS_LOGGING
W_VERIFY --> OBS_OTEL
W_SCAN --> OBS_OTEL
W_NOTIFY --> OBS_OTEL
W_EXPORT --> OBS_OTEL
OBS_LOGGING --> OBS_MONITORING
OBS_LOGGING --> OBS_ERRORS
OBS_MONITORING --> OBS_BUDGET
FB_CRASH --> OBS_MONITORING

%% ============================================================
%% EDGES - DELIVERY AND PROVISIONING
%% ============================================================
EXT_GITHUB --> DEL_GHA
DEL_GHA --> DEL_WIF
DEL_WIF --> STORE_AR
DEL_GHA --> STORE_AR
DEL_GHA --> W_MIGRATE
DEL_GHA -->|deploy image digest| API_BOOT
DEL_GHA --> FB_HOSTING
DEL_GHA --> EXT_APPSTORE
STORE_AR --> API_BOOT
STORE_AR --> WORKERS
DEL_GCLOUD --> NET_VPC
DEL_GCLOUD --> SQL
DEL_GCLOUD --> GCS
DEL_GCLOUD --> ASY_TASKS
DEL_GCLOUD --> ASY_PUBSUB
DEL_GCLOUD --> STORE_SECRETS
DEL_GCLOUD --> DEL_SA
DEL_GCLOUD --> NET_LB
DEL_SA --> API_BOOT
DEL_SA --> WORKERS
DEL_FLAGS --> API_MODULES
DEL_ENVS --> DEL_GCLOUD
DEL_LOCAL --> DEL_GHA
SQL --> STORE_BACKUP

%% ============================================================
%% STYLES
%% ============================================================
classDef person fill:#F6E7CE,stroke:#8B6F47,stroke-width:2px,color:#2B2115
classDef client fill:#DCE9F7,stroke:#2E6DA4,stroke-width:1.5px,color:#12283D
classDef clientCore fill:#EEF5FC,stroke:#5B93C7,stroke-width:1px,color:#12283D
classDef backend fill:#D5EBD6,stroke:#3D7A3D,stroke-width:2px,color:#12300F
classDef module fill:#EAF6EA,stroke:#4F9B4F,stroke-width:1px,color:#12300F
classDef datastore fill:#F7DEDE,stroke:#A64B4B,stroke-width:2px,color:#3A1414
classDef async fill:#FBEEDC,stroke:#C98416,stroke-width:1.5px,color:#3B2606
classDef worker fill:#FDF6E9,stroke:#D9A441,stroke-width:1px,color:#3B2606
classDef managed fill:#EDE2F7,stroke:#6B4FA3,stroke-width:1.5px,color:#241634
classDef network fill:#DFF2F2,stroke:#3B8C8C,stroke-width:1.5px,color:#0F2C2C
classDef observ fill:#ECECEC,stroke:#6E6E6E,stroke-width:1px,color:#242424
classDef delivery fill:#FFF6CC,stroke:#B39100,stroke-width:1.5px,color:#332C00
classDef external fill:#E6E6E6,stroke:#555555,stroke-width:2px,stroke-dasharray:5 4,color:#1F1F1F

class ACT_OWNER,ACT_EDITOR,ACT_VIEWER,ACT_ORGADMIN,ACT_PRO,ACT_PUBLISHER,ACT_CLIENT,ACT_SUPPORT person
class IOS_UI,IOS_ROUTER,IOS_F_AUTH,IOS_F_GARDENLIST,IOS_F_MAP,IOS_F_PLANTS,IOS_F_OBS,IOS_F_TASKS,IOS_F_RECS,IOS_F_PLAN,IOS_F_CAPTURE,IOS_F_MEDIA,IOS_F_COLLAB,IOS_F_SETTINGS client
class WEB_R_PUBLIC,WEB_R_AUTH,WEB_R_APP,WEB_R_PORTAL,WEB_F_GARDENS,WEB_F_MAPEDITOR,WEB_F_PLANTS,WEB_F_OBS,WEB_F_TASKS,WEB_F_RECS,WEB_F_MEDIA,WEB_F_IMPORTS,WEB_F_COLLAB,WEB_F_ENGAGE,WEB_F_PUBS,WEB_F_TIMELINE,WEB_F_SETTINGS client
class IOS_COMPOSITION,IOS_USECASES,IOS_DOMAIN,IOS_PERSIST,IOS_SYNC,IOS_NET,IOS_AUTHADAPTER,IOS_APPCHECK,IOS_MEDIA_XFER,IOS_CAPTURE_COORD,IOS_EDITOR,IOS_RENDER,IOS_OBSERV,IOS_CAPABILITIES clientCore
class WEB_API,WEB_QUERY,WEB_STORE,WEB_FORMS,WEB_AUTHC,WEB_GEOMETRY,WEB_UPLOAD,WEB_ANALYTICS,WEB_OBSERV,WEB_KONVA,WEB_MAPLIBRE,WEB_WORKER clientCore
class IOS_SQLITE,IOS_OUTBOX,WEB_DRAFTS datastore
class API_BOOT,PL_PIPE,PL_CONFIG,PL_DB,PL_AUTH,PL_TELEMETRY,PL_MSG,PL_STORAGE,PL_KERNEL,PL_IDEM backend
class M_IDENTITY,M_GARDENS,M_PLANTS,M_OBS,M_TASKS,M_MEDIA,M_CAPTURE,M_COLLAB,M_SYNC,M_INTEGRATIONS,M_ADMIN module
class SURF_APP,SURF_SYNC,SURF_MEDIA,SURF_JOBS,SURF_ORG,SURF_PORTAL,SURF_EXPORT module
class ENG_RULES,ENG_GEOM,ENG_CAPS,ENG_PUBLISH,ENG_ASSISTANT module
class ASY_OUTBOX,ASY_TASKS,ASY_PUBSUB,ASY_SCHED,ASY_WORKFLOWS,ASY_DLQ async
class W_VERIFY,W_DERIV,W_VIDEO,W_PLAN,W_SCAN,W_RECS,W_NOTIFY,W_EXPORT,W_DELETE,W_PROJECTION,W_RECONCILE,W_MIGRATE worker
class DB_IDENTITY,DB_COLLAB,DB_GARDENS,DB_PLANTS,DB_OBS,DB_TASKS,DB_MEDIA,DB_CAPTURE,DB_PLATFORM,DB_EXTREF,B_USER,B_RAW,B_DERIVED,B_EXPORTS,STORE_SECRETS,STORE_AR,STORE_BACKUP datastore
class FB_AUTH,FB_APPCHECK,FB_FCM,FB_CRASH,FB_HOSTING,FB_ANALYTICS managed
class NET_DNS,NET_LB,NET_ARMOR,NET_NEG,NET_CDN,NET_VPC,NET_DVE,NET_PSA,NET_PGA network
class OBS_OTEL,OBS_LOGGING,OBS_MONITORING,OBS_TRACE,OBS_ERRORS,OBS_BUDGET observ
class DEL_GHA,DEL_WIF,DEL_GCLOUD,DEL_SA,DEL_FLAGS,DEL_ENVS,DEL_LOCAL delivery
class EXT_WEATHER,EXT_GEOCODE,EXT_TILES,EXT_PLANT,EXT_VERTEX,EXT_EMAIL,EXT_SENTRY,EXT_APNS,EXT_GITHUB,EXT_APPSTORE external
class AFW_ARKIT,AFW_AV,AFW_VISION,AFW_LOCATION,AFW_MAPKIT,AFW_BGTRANSFER external
```

## Legend

### Colour coding

| Colour              | Meaning                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sand, solid border  | People and roles — operational garden roles, professional roles, client role, support staff                             |
| Blue, solid border  | Internal client-facing components — native feature modules, web route groups and feature modules                        |
| Light blue          | Internal client core subsystems — use cases, persistence, synchronization, networking, rendering, adapters              |
| Green, thick border | Internal backend platform layer of the Cloud Run modular monolith                                                       |
| Light green         | Internal backend domain modules, REST surfaces, and domain engines                                                      |
| Orange              | Asynchronous primitives — outbox relay, Cloud Tasks, Pub/Sub, Scheduler, Workflows, dead letters                        |
| Light orange        | Internal Cloud Run worker services and jobs, TypeScript and Python                                                      |
| Red                 | Data stores — PostgreSQL logical schemas, Cloud Storage buckets, Secret Manager, registry, backups, local device stores |
| Purple              | Firebase managed platform services                                                                                      |
| Teal                | Google Cloud edge and networking components                                                                             |
| Grey, solid border  | Observability and operations services                                                                                   |
| Yellow              | Delivery, environments, and provisioning components                                                                     |
| Grey, dashed border | External third-party systems and Apple platform frameworks outside product ownership                                    |

### Internal versus external

- **Internal** — the native Apple client, the web client, the Cloud Run API modular monolith, the
  asynchronous workers and jobs, and the delivery/provisioning tooling. These are built, versioned,
  and released by the product team.
- **External managed** — Firebase platform services, Cloud SQL, Cloud Storage, Secret Manager,
  Artifact Registry, edge networking, and observability. These are consumed as managed services and
  provisioned through versioned `gcloud` scripts.
- **External third party** — weather, geocoding, tile, plant-content, AI, email, error-collection,
  push-transport, source-hosting, and app-distribution providers, plus Apple platform frameworks.
  Every provider is reached through an application-owned port and adapter.

### Edge conventions

- Solid arrow — a runtime call, data flow, or delivery action in the direction of the arrow.
- Dotted arrow labelled `owns` — module ownership of a PostgreSQL logical schema. A module may reach
  another module's data only through that module's public application interface.
- Arrows into `NET_LB` — public HTTPS traffic entering through the protected production ingress path.
- Arrows from clients directly into Cloud Storage buckets — direct resumable media transfer that
  deliberately bypasses the interactive API container.

### Key architectural boundaries visible in the diagram

1. **One authoritative domain store** — every domain module writes through the platform database
   layer into Cloud SQL for PostgreSQL with PostGIS; no second source of truth exists.
2. **Two sharing planes** — the operational garden path terminates at the operational API surfaces,
   while the client portal path terminates at publication-only surfaces backed by the Collaboration
   module's separate query surface.
3. **Media bypasses the API** — the API owns upload authorization and verification, but binary media
   moves directly between clients, buckets, and workers.
4. **Asynchronous heavy work** — the transactional outbox is the only bridge between domain commits
   and event publication; long-running compute lives in workers and jobs, never in request handlers.
5. **Replaceable providers** — every third-party system is reached only through the Integrations
   module's adapters, never from domain code.
