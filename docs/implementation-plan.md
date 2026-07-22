# Grow Garden Product Implementation Plan

> Status: Draft 0.1  
> Plan type: Product-wide delivery and implementation plan  
> Last updated: July 22, 2026  
> Architecture baseline: Approved  
> Delivery approval: Required before committed staffing or dates

## 1. Purpose

This document turns the approved Grow Garden product specification and architecture into an executable implementation sequence. It covers the foundation release, post-foundation expansion, and advanced product capabilities. It defines work packages, dependencies, evidence, release gates, quality obligations, risks, assumptions, and requirements traceability.

This is a delivery plan, not a replacement for the product requirements or detailed designs. Product meaning remains authoritative in [technical-specification.md](technical-specification.md). System boundaries and technical choices remain authoritative in [high-level-architecture.md](high-level-architecture.md) and [architecture/README.md](architecture/README.md).

Calendar commitments, staffing assignments, commercial provider selections, and numeric launch thresholds are not stated in the source documentation. They are explicitly identified as assumptions or decisions in this plan rather than presented as facts.

## 2. Source Baseline

### 2.1 Facts From Source

- Grow Garden is a cross-device garden-management product with native Apple and web applications, centered on a continuous loop from garden context to an explainable action and recorded outcome. [Source: technical-specification.md, sections "2. Product Definition" and "8.2 Daily Care Loop"]
- The foundation scope includes garden management, progressive 2D mapping, imagery and plan-based starts, manual editing, plants, observations, weather-aware context, the Today view, recommendations, tasks, a first-class web application, and essential offline mobile actions. [Source: technical-specification.md, section "6.1 Foundation Scope"]
- AR, LiDAR, sharing, improved vectorization, and richer seasonal context are proposed after foundation validation; Garden Scan, 3D, Time Machine, and conversational assistance are future capabilities. [Source: technical-specification.md, sections "6.2 Proposed Next Scope" and "6.3 Future Scope"]
- The accepted architecture uses a native Swift/SwiftUI client, a TypeScript/React/Next.js web client, a Fastify modular monolith, PostgreSQL/PostGIS, Cloud Storage, Firebase, Google Cloud, GRDB/SQLite, REST/OpenAPI, and application-owned synchronization. [Source: architecture/README.md, section "4. Approved Technology Profile"]
- The first market is the United States and the controlled regional baseline is `us-central1`. [Source: architecture/decisions/ADR-0007-us-central1-production-baseline.md, section "Decision"]
- Every advanced capture mode must have a manual fallback, and generated geometry remains a reviewable proposal until the user accepts it. [Source: architecture/garden-capture-and-scan.md, sections "2. Product Position" and "22. Completion Criteria"]
- The product is not a survey, engineering measurement, or construction-layout tool; provenance and uncertainty must remain visible. [Source: technical-specification.md, section "13. Accuracy and Safety Policy"]
- The repository currently contains documentation and repository rules but no application, service, infrastructure, or test implementation. [Source: repository inventory performed July 22, 2026]

### 2.2 Reliability of the Baseline

| Source | Status | Planning reliability | Use in this plan |
|---|---|---:|---|
| `technical-specification.md` | Draft 0.6; architecture approved | High for current product intent; Medium for proposed release scope | Requirements, journeys, priorities, risks, open product decisions |
| `high-level-architecture.md` | Draft 0.2; approved detailed-design baseline | High | System context and non-negotiable boundaries |
| `architecture/*.md` | Draft 0.1; approved baseline | High | Component responsibilities, failure behavior, testing, completion criteria |
| `architecture/decisions/*.md` | Accepted ADRs | High | Irreversible or expensive architectural choices |
| `AGENTS.md` | Repository rule | High | Language, documentation, clean-code, and source-file-size rules |

### 2.3 Interpretation

The proposed foundation scope is treated as the first production release candidate, but it is not treated as a committed schedule. This is an inference from the priority ordering and acceptance outcomes, not an explicit release commitment. [Source: technical-specification.md, sections "6. Proposed Product Priorities" and "15. Proposed Acceptance Criteria"]

The plan intentionally proves the manual, explainable care loop before advanced capture. This is an inference from the product principles that prioritize action, progressive setup, user control, and graceful capability tiers. [Source: technical-specification.md, section "5. Product Principles"]

## 3. Delivery Outcomes

### 3.1 Foundation Release

The foundation release is complete only when a United States user can:

1. Sign in and create a garden.
2. Start from a blank canvas, contextual imagery, or an imported property plan.
3. Represent a lot, house, deck, internal fence, path, bed, tree, and plants on an editable 2D map.
4. Preserve the source, scale, confidence, and revision of map information.
5. Add plants, observations, photos, and manual tasks.
6. Receive an explainable, evidence-backed action in the Today view.
7. Complete, postpone, dismiss, or reject the action and see the outcome in history.
8. Perform essential native actions offline and recover synchronization conflicts without silent data loss.
9. Continue supported non-device-specific work in the web application.
10. Export and delete owned data through private, verifiable workflows.

These outcomes consolidate the documented initial acceptance criteria and data-ownership requirements. [Source: technical-specification.md, sections "15. Proposed Acceptance Criteria", "FR-31: Offline Use and Synchronization", "FR-32: Import, Export, and Data Ownership", and "FR-33: Web Application"]

### 3.2 Expansion Release

The expansion release adds collaboration, seasonal planning, richer garden context, assisted media capture, plan recognition, AR measurement, and LiDAR enhancement. Each capability remains separately flaggable and may ship independently after its own evidence gate. [Source: technical-specification.md, section "6.2 Proposed Next Scope"; architecture/environments-and-delivery.md, section "14. Feature Flags"]

### 3.3 Advanced Product

The advanced product adds guided Garden Scan, multi-capture reconstruction, constrained conversational assistance, a shared-data 3D view, and illustrative Time Machine behavior. These capabilities must not delay the foundation release. [Source: technical-specification.md, sections "6.3 Future Scope", "FR-16: Guided Garden Scan", "FR-28: Conversational Assistance", "FR-29: 3D Garden View", and "FR-30: Time Machine"]

### 3.4 Current Scope Boundaries

- Android is not part of the approved client architecture and requires a future product decision and architecture design.
- Indoor-only plant care and professional agricultural operations are not the initial market focus.
- Survey-grade boundaries, engineering measurement, and construction layout are explicitly excluded.
- Full browser offline synchronization, enterprise identity tenancy, active/active multi-region writes, dedicated search, and independent microservices are not baseline capabilities.
- Advanced capabilities remain optional until their user-value, safety, quality, privacy, and cost gates pass.

[Source: technical-specification.md, sections "4. Initial Target Users" and "13. Accuracy and Safety Policy"; architecture/web-application-design.md, section "9. Online-First Behavior"; architecture/identity-and-authorization.md, section "16. Multi-Tenancy"; architecture/reliability-and-disaster-recovery.md, section "2. Service Tier"; architecture/backend-modular-monolith.md, section "23. Extraction Criteria"]

## 4. Planning Assumptions

### Assumption A-1: Reference Delivery Team

- **Explanation:** Forecast ranges use a reference team of two backend/platform engineers, two native Apple engineers, two web engineers, one computer-vision/ML engineer joining when needed, one quality-automation engineer, and shared product, design, horticulture, security, privacy, and cloud-operations support.
- **Evidence:** Staffing and team capacity are not stated in the source documentation.
- **Confidence:** Low.
- **Validation path:** Assign named people, allocation percentages, hiring lead times, and ownership before approving any calendar forecast.
- **Planning consequence:** If one engineer owns more than one client or platform track, elapsed time increases and parallel phase estimates do not apply.

### Assumption A-2: Two-Week Planning Increments

- **Explanation:** Work is planned and reviewed in two-week increments, with continuous integration and independently releasable feature flags.
- **Evidence:** Iteration length is not stated. The architecture requires immutable artifacts, staged promotion, and deployment separated from feature release. [Source: architecture/environments-and-delivery.md, sections "9. Branch and Promotion Model" and "14. Feature Flags"]
- **Confidence:** Medium.
- **Validation path:** Confirm the delivery method and adjust forecast units without changing dependency order.

### Assumption A-3: Both Native and Web Ship in the Foundation Release

- **Explanation:** iPhone/iPad and web ship as supported product surfaces for the foundation care loop. Device-specific capture may remain native-only.
- **Evidence:** The web application is required as a first-class product surface, and cross-device continuation is an initial acceptance outcome. [Source: technical-specification.md, sections "FR-33: Web Application" and "15. Proposed Acceptance Criteria"]
- **Confidence:** High.
- **Validation path:** Approve the surface launch matrix in Phase 0.

### Assumption A-4: The Foundation Web Application Is Online-First

- **Explanation:** Web preserves recoverable drafts but does not implement the native synchronization engine in the foundation release.
- **Evidence:** The detailed web design explicitly selects online-first behavior and defers full browser synchronization. [Source: architecture/web-application-design.md, sections "2. Product Role" and "9. Online-First Behavior"]
- **Confidence:** High.
- **Validation path:** Confirm which editor and form drafts must survive browser restart in Phase 0.

### Assumption A-5: Advanced Capture Requires Research Gates

- **Explanation:** AR, LiDAR, reconstruction, and model-based recognition receive evaluation milestones before production implementation is committed.
- **Evidence:** The capture design requires representative evaluation data and makes each capture stage independently shippable. [Source: architecture/garden-capture-and-scan.md, sections "3. Staged Capability Plan" and "20. Evaluation"]
- **Confidence:** High.
- **Validation path:** Approve datasets, ground truth, metrics, device matrix, privacy basis, quality thresholds, and unit-cost limits before each capability exits research.

## 5. Delivery Principles

1. **Ship vertical slices.** Every major increment includes contracts, persistence, backend behavior, at least one client path, tests, telemetry, and documentation.
2. **Manual before automatic.** Manual editing and correction ship before plan extraction, AR, or scan proposals.
3. **Contract before clients.** OpenAPI, geometry fixtures, identifiers, error codes, revisions, and message schemas are executable before multiple implementations depend on them.
4. **Offline semantics before scale.** Server revisions, idempotency, change logs, tombstones, and durable client operations are designed into initial mutations rather than retrofitted.
5. **Accepted data before generated data.** Processors create immutable proposals; only revision-aware user commands change accepted garden state.
6. **Security and privacy in every phase.** Authorization, redaction, data classification, retention, and deletion are acceptance work, not launch-only cleanup.
7. **Provider independence.** Domain modules use application ports and normalized records; provider SDKs remain in adapters.
8. **Measure before architecture expansion.** Service extraction, dedicated search, GPU compute, PgBouncer, replicas, and multi-region expansion require measured triggers.
9. **Documentation is part of done.** Implementation and documentation change together.

These principles derive from the approved backend, sync, capture, security, provider, cost, testing, and repository designs. [Source: architecture/backend-modular-monolith.md, sections "5. Module Shape" and "23. Extraction Criteria"; architecture/offline-synchronization.md, section "4. Authority Model"; architecture/garden-capture-and-scan.md, section "13. Proposal Model"; architecture/external-integrations.md, section "2. Integration Boundary"; architecture/cost-and-scaling.md, section "18. Scaling Triggers"; AGENTS.md]

## 6. Workstreams and Ownership

| ID | Workstream | Responsibilities | Required partners |
|---|---|---|---|
| WS-PROD | Product and research | Segment, scope, journeys, metrics, usability studies, release decisions | Design, horticulture, engineering, privacy |
| WS-DESIGN | Product design | Information architecture, responsive flows, map tools, capture guidance, accessibility | Native, web, research |
| WS-CONTRACT | Contracts and shared semantics | OpenAPI, geometry fixtures, errors, commands, events, localization keys | Backend, native, web, QA |
| WS-DATA | Data and geospatial | PostgreSQL/PostGIS schema, revisions, geometry, migrations, search | Backend, sync, map |
| WS-BE | Backend application | Fastify modules, use cases, authorization, APIs, jobs, adapters | Data, platform, all clients |
| WS-IOS | Native Apple | SwiftUI features, GRDB, sync, Canvas/MapKit, capture, background transfer | Contracts, backend, map/CV |
| WS-WEB | Web | Next.js application, authenticated session, Konva/MapLibre editor, forms, uploads | Contracts, backend, design |
| WS-MAP | Cross-platform map | Canonical commands, transformations, validation, calibration, performance fixtures | Data, native, web, QA |
| WS-MEDIA | Media and capture | Uploads, storage, derivatives, plan processing, capture sessions | Native, web, platform, CV |
| WS-CV | Computer vision and ML | Document extraction, assisted capture, reconstruction, evaluation | Media, map, product, privacy |
| WS-GUIDE | Recommendations and content | Rules, evidence, safety tiers, Today ranking, plant/weather context | Horticulture, backend, AI |
| WS-PLAT | Cloud platform and delivery | Terraform, networking, Firebase/GCP, CI/CD, environments, budgets | Security, backend, QA |
| WS-SEC | Security and privacy | Threat model, identity controls, data flows, retention, incident readiness | Every workstream |
| WS-QA | Quality and release | Test architecture, fixtures, automation, performance, resilience, release evidence | Every workstream |
| WS-OPS | Reliability and operations | SLOs, dashboards, alerts, runbooks, restore and recovery | Platform, backend, support |

Named people are not stated in source and must be assigned before delivery approval.

## 7. Dependency and Release Map

```text
P0 Product closure and research setup
 │
 ▼
P1 Engineering and cloud foundation
 │
 ▼
P2 Identity and first-garden vertical slice
 │
 ├───────────────┐
 ▼               ▼
P3 2D map       P4 Plants, observations, tasks
 │               │
 └───────┬───────┘
         ▼
P5 Native offline synchronization and web continuity
         │
         ▼
P6 Media, photos, and property-plan import
         │
         ▼
P7 Weather, recommendations, Today, and notifications
         │
         ▼
P8 Foundation beta, hardening, and US general availability
         │
         ├──────────────► P9 Collaboration and seasonal context
         ├──────────────► P10 Assisted photo/video capture and plan recognition
         │                         │
         │                         ▼
         │                     P11 AR and LiDAR measurement
         │                         │
         │                         ▼
         │                     P12 Guided Garden Scan
         │
         ├──────────────► P13 Conversational assistance
         │
         └──────────────► P14 3D garden and Time Machine
```

P3 and P4 may run in parallel after P2. P9 and P10 may run in parallel after foundation validation. P13 and P14 require validated structured garden data but do not need to block one another.

## 8. Release Gates

| Gate | Evidence required | Release consequence |
|---|---|---|
| G0 Plan approved | Named owners, product decisions, launch matrix, funding and provider evaluation plan | Start implementation |
| G1 Foundation operational | Repository, CI, dev environment, deployable API/web shells, buildable iOS shell, contracts and migrations | Begin feature slices |
| G2 First garden | Authenticated user creates and reopens one garden on native and web | Internal dogfood |
| G3 Manual map | Required structural and garden objects edit correctly across platforms with shared validation | Mapping alpha |
| G4 Care records | Plants, observations, history, and tasks use the same garden objects and revisions | Care-data alpha |
| G5 Offline convergence | Native edits survive termination/offline operation and converge without silent loss | Field alpha |
| G6 Plan and media | Direct resumable uploads, photos, plan calibration, tracing, recovery, and retention pass | Setup alpha |
| G7 Complete care loop | Weather/rules produce explainable actions; feedback reaches history; failures degrade safely | US private beta |
| G8 Foundation launch | Security, privacy, accessibility, localization, load, backup/restore, export/deletion, support, and store readiness pass | US GA |
| G9 Expansion quality | Collaboration and seasonal/context outcomes validate with real users | Expansion GA |
| G10 Capture quality | Assisted/AR/LiDAR features meet accuracy, safety, correction-effort, privacy, and cost thresholds | Capture rollout |
| G11 Scan quality | Reconstruction meets approved object and geometry metrics and remains proposal-only | Garden Scan rollout |
| G12 Advanced value | Assistant, 3D, or Time Machine each shows measurable user value and passes its safety/accuracy gate | Independent advanced rollout |

## 9. Phase 0 — Product Closure and Research Setup

### 9.1 Outcome

Convert unresolved product questions and implementation-time selections into time-bounded decisions. Produce the launch experience map and evaluation protocols before implementation choices become expensive.

### 9.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P0-PROD-01 | Select the first-release user segment and top three garden archetypes | WS-PROD | None | Signed segment brief and recruitment criteria |
| P0-PROD-02 | Decide guest onboarding, sign-in boundary, and any local-to-account migration | WS-PROD, WS-SEC | P0-PROD-01 | Approved journey and data lifecycle |
| P0-PROD-03 | Freeze foundation object categories, plant lifecycle stages, task states, recommendation urgency levels, and initial care categories | WS-PROD, WS-GUIDE | P0-PROD-01 | Versioned domain glossary |
| P0-PROD-04 | Define minimum information needed for the first useful recommendation | WS-PROD, WS-GUIDE | P0-PROD-03 | Rule-input contract and onboarding minimum |
| P0-DESIGN-01 | Prototype first garden, blank/imagery/plan starts, manual editor, first plant, Today loop, sync attention, and error recovery | WS-DESIGN | P0-PROD-01..04 | Tested end-to-end prototype |
| P0-MAP-01 | Define launch object semantics, canonical curve approximation, geometry tolerances, snap rules, and accuracy labels | WS-MAP, WS-DATA | P0-PROD-03 | Geometry decision note and fixtures plan |
| P0-CLIENT-01 | Select minimum iOS/iPadOS versions, browser release lines, responsive breakpoints, and foundation surface matrix | WS-IOS, WS-WEB | P0-DESIGN-01 | Compatibility matrix |
| P0-PROV-01 | Evaluate map/imagery, geocoding, weather, plant content/identification, and transactional email candidates | WS-BE, WS-PROD, WS-SEC | P0-PROD-01 | Scored vendor decision records |
| P0-PLAT-01 | Pin supported Next.js, Node.js, Swift toolchain, Python, PostgreSQL/PostGIS, Terraform, and container baselines | WS-PLAT | P0-CLIENT-01 | Version matrix and upgrade policy |
| P0-SEC-01 | Classify launch data flows and draft privacy notice, consent, retention schedule, safety exclusions, and US legal review checklist | WS-SEC | P0-PROD-02, P0-PROV-01 | Reviewed data inventory and policy backlog |
| P0-QA-01 | Define measurable budgets for core latency, map interaction, sync convergence, upload recovery, SLO candidates, quotas, and alert thresholds | WS-QA, WS-OPS | P0-CLIENT-01 | Initial non-functional scorecard |
| P0-DEL-01 | Assign workstream owners, capacity, decision rights, escalation path, and backlog governance | WS-PROD | All P0 decisions | Approved delivery charter |

### 9.3 Exit Criteria

- Every Phase 0 item has a named approver and dated decision.
- High-risk flows have tested prototypes with findings incorporated.
- No provider is selected without licensing, privacy, coverage, cost, quota, and replacement review.
- Foundation scope has explicit included, deferred, and excluded lists.
- G0 is approved.

### 9.4 Source Traceability

The unresolved decisions come from the implementation-time selections and product questions. Provider evaluation criteria come from the adapter contract. [Source: technical-specification.md, sections "14.2 Implementation-Time Selections" and "18. Open Product Questions"; architecture/external-integrations.md, section "3. Adapter Contract"]

## 10. Phase 1 — Engineering and Cloud Foundation

### 10.1 Outcome

Create a reproducible monorepo and deployable development environment with executable contracts, database migrations, shared test fixtures, observability, and security defaults.

### 10.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P1-REPO-01 | Create `apps/ios`, `apps/web`, `services/api`, `services/workers`, `packages`, `infrastructure`, and test-fixture structure | WS-PLAT | P0-PLAT-01 | Clean builds from documented setup |
| P1-REPO-02 | Configure TypeScript workspaces, Swift Package Manager, Python environment, formatting, linting, type checking, dependency locks, and file-size enforcement | WS-PLAT | P1-REPO-01 | CI rejects policy violations |
| P1-CONTRACT-01 | Establish OpenAPI governance, `/v1`, common errors, UUIDv7, timestamps, SI measurement conventions, pagination, idempotency, and revision headers | WS-CONTRACT, WS-BE | P0-MAP-01 | Linted contract and compiling generated clients |
| P1-CONTRACT-02 | Create language-neutral geometry, sync, provider, and recommendation fixture schemas | WS-CONTRACT, WS-QA | P1-CONTRACT-01 | Fixtures consumed by at least two runtimes |
| P1-DATA-01 | Start reviewed SQL migration system; create PostGIS extension, application/migration roles, schema ownership, and migration tests | WS-DATA | P0-PLAT-01 | Fresh and upgrade migration tests pass |
| P1-BE-01 | Implement Fastify composition root, configuration validation, health checks, request pipeline skeleton, typed errors, database adapter, and module boundaries | WS-BE | P1-CONTRACT-01, P1-DATA-01 | API container starts and exposes validated health |
| P1-WEB-01 | Create Next.js application shell, localization framework, design-system foundation, route/error boundaries, and typed API gateway | WS-WEB | P1-REPO-01, P1-CONTRACT-01 | Web shell deploys in development |
| P1-IOS-01 | Create SwiftUI application composition, Core packages, feature template, localization, generated API gateway, and dependency rules | WS-IOS | P1-REPO-01, P1-CONTRACT-01 | iPhone and iPad shells build and test |
| P1-PLAT-01 | Create Terraform modules for project services, IAM, network, Cloud SQL, Cloud Run, storage, messaging, observability, and edge shells | WS-PLAT | P0-PLAT-01 | Terraform validate and reviewed development plan |
| P1-PLAT-02 | Configure separate development, staging, and production Firebase/GCP projects or documented organization bootstrap prerequisites | WS-PLAT | P1-PLAT-01 | Environment inventory and isolation evidence |
| P1-PLAT-03 | Configure GitHub Actions workload identity federation, Artifact Registry, immutable images, and environment-specific deploy identities | WS-PLAT, WS-SEC | P1-PLAT-02 | Keyless development deployment |
| P1-OBS-01 | Add OpenTelemetry, structured redacted logs, correlation IDs, initial dashboards, and build/version metadata | WS-OPS, WS-BE | P1-BE-01, P1-PLAT-02 | One request trace crosses ingress and database |
| P1-QA-01 | Implement PR gates for docs, links, language, lint, typecheck, unit tests, migrations, OpenAPI, generated clients, Terraform, secrets, dependencies, and images | WS-QA, WS-PLAT | P1-REPO-02 | Required checks run on a sample PR |
| P1-DOC-01 | Document local setup, environment promotion, migrations, contracts, feature flags, and emergency changes | All owners | P1-QA-01 | A new developer follows setup without tribal knowledge |

### 10.3 Exit Criteria

- Development deployment is reproducible from an empty workstation with approved access.
- API, web, iOS, database, and worker test shells build in CI.
- CI uses federation and no committed or downloaded long-lived cloud key.
- A backward-compatible migration and rollback-compatible application deployment are rehearsed in development.
- Contracts and fixtures are generated, compiled, and never manually patched.
- G1 is approved.

### 10.4 Source Traceability

Repository shape, delivery identity, environment isolation, migration safety, and test gates are defined by the approved architecture. [Source: architecture/README.md, section "5. Repository Shape"; architecture/environments-and-delivery.md, sections "2. Environments", "6. CI/CD Identity", "7. Change Detection", and "12. Database Migrations"; architecture/testing-strategy.md, sections "4. Shared Test Assets" and "22. CI Gates"]

## 11. Phase 2 — Identity and First-Garden Vertical Slice

### 11.1 Outcome

An authenticated user creates, lists, opens, renames, archives, and reopens a garden from native and web clients against the deployed backend. Authorization, revisions, idempotency, audit, and telemetry are real rather than mocked.

### 11.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P2-DATA-01 | Add profiles, Firebase identity links, account state, gardens, memberships, roles, invitations skeleton, consent, audit, revisions, idempotency, sync-change, and outbox tables | WS-DATA | P1-DATA-01 | Migration and ownership tests pass |
| P2-BE-01 | Implement identity-access and gardens-mapping module foundations with explicit domain/application/persistence/transport layers | WS-BE | P2-DATA-01 | Module dependency tests pass |
| P2-AUTH-01 | Verify native Firebase ID tokens, create actor context, provision application profiles idempotently, and handle revocation/account state | WS-BE, WS-SEC | P2-BE-01 | Auth integration and negative tests pass |
| P2-AUTH-02 | Implement web sign-in exchange, secure HTTP-only Firebase session cookie, CSRF controls, logout, and server-side session verification | WS-WEB, WS-BE, WS-SEC | P2-AUTH-01 | CSRF/session test suite passes |
| P2-AUTH-03 | Integrate Apple, Google, and email magic-link flows on applicable clients, including provider-link conflict handling | WS-IOS, WS-WEB | P2-AUTH-01, P2-AUTH-02 | Provider matrix passes in development |
| P2-SEC-01 | Implement capability evaluation for owner/editor/viewer and conceal unauthorized resource existence | WS-BE, WS-QA | P2-DATA-01 | Full cross-garden matrix passes |
| P2-API-01 | Implement garden list/create/get/rename/archive/delete-request contracts with idempotency and revisions | WS-BE, WS-CONTRACT | P2-BE-01, P2-SEC-01 | Contract and concurrency tests pass |
| P2-IOS-01 | Create per-profile GRDB store, authentication flow, garden list/create screens, local read model, and sign-out cleanup | WS-IOS | P2-API-01, P2-AUTH-03 | Native first-garden UI test passes |
| P2-WEB-01 | Implement authenticated application shell, garden list/create/settings flows, TanStack Query ownership, and accessible error handling | WS-WEB | P2-API-01, P2-AUTH-02 | Web first-garden Playwright test passes |
| P2-APPCHK-01 | Integrate App Check in monitor-only mode and record privacy-safe valid/missing/invalid metrics | WS-SEC, WS-IOS, WS-WEB | P2-AUTH-01 | Dashboard shows client classes without user content |
| P2-OBS-01 | Audit account state and garden ownership changes; add route, authorization, database, and client correlation telemetry | WS-OPS, WS-BE | P2-API-01 | One workflow is traceable without sensitive payloads |
| P2-QA-01 | Add E2E register/sign-in/create/reopen/sign-out scenarios and provider outage behavior | WS-QA | All P2 implementation | G2 test evidence |

### 11.3 Exit Criteria

- Credentials remain in Firebase; permissions remain in PostgreSQL.
- Native and web sessions use their approved distinct flows.
- Every protected garden use case evaluates a server-side capability.
- Account, role, and garden changes are audit-visible.
- The same garden is visible on both clients without duplicate identity or data creation.
- G2 is approved for internal dogfood.

### 11.4 Source Traceability

Identity ownership, session flows, roles, and completion criteria are defined in the identity design. Garden API conventions come from the REST design. [Source: architecture/identity-and-authorization.md, sections "2. Identity Authority", "4. Native Authentication Flow", "5. Web Session Flow", "8. Garden Roles", and "19. Completion Criteria"; architecture/api-design.md, sections "4. Resource Naming", "6. Idempotency", and "8. Authentication"]

## 12. Phase 3 — Canonical 2D Map and Manual Editors

### 12.1 Outcome

Users create and edit an approximate, scaled, or georeferenced 2D garden on iPhone, iPad, and web. The two renderers consume the same semantic geometry, commands, validations, provenance, measurements, and revisions.

### 12.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P3-DATA-01 | Implement coordinate spaces, optional georeference, garden objects, specialized detail tables, provenance, measurements, current revisions, and immutable revision journal | WS-DATA | P2-DATA-01, P0-MAP-01 | Migration, constraint, revision, and ownership tests |
| P3-DATA-02 | Add GiST spatial indexes, geometry validity constraints, viewport queries, and semantic validation query ports | WS-DATA | P3-DATA-01 | Query-plan and invalid-geometry tests |
| P3-CONTRACT-01 | Finalize GeoJSON envelopes with explicit coordinate-space metadata, object categories, measurement uncertainty, and provenance | WS-CONTRACT, WS-MAP | P3-DATA-01 | Swift/TypeScript/backend round trips agree |
| P3-MAP-01 | Implement canonical commands for create, move, resize, rotate, reshape, duplicate, delete, label, measure, calibrate, and layer changes | WS-MAP | P3-CONTRACT-01 | Language-neutral command fixtures pass |
| P3-MAP-02 | Implement undo/redo as inverse or compensating commands, gesture preview boundaries, snapping, constraints, and warning-oriented validation | WS-MAP | P3-MAP-01 | Deterministic editor state tests |
| P3-BE-01 | Implement map queries and revision-aware map-command endpoint with authorization, idempotency, validation, history, sync change, and outbox event | WS-BE | P3-DATA-01, P3-CONTRACT-01 | Concurrent command tests pass |
| P3-BE-02 | Implement lot, structure, fence/gate, path, bed/zone, tree, plant placement, label, and measurement behaviors | WS-BE, WS-MAP | P3-BE-01 | Required object scenario passes |
| P3-WEB-01 | Implement Konva scene, viewport culling, selection, tool state, gesture preview, keyboard shortcuts, accessible object list, and property panel | WS-WEB | P3-MAP-01, P3-BE-01 | Web editor component and accessibility tests |
| P3-WEB-02 | Integrate MapLibre context through a provider adapter with attribution, cache limits, location search, and local/geographic transform | WS-WEB, WS-BE | P0-PROV-01, P3-WEB-01 | Provider replacement and attribution tests |
| P3-IOS-01 | Implement SwiftUI Canvas/Core Graphics scene, immutable render snapshots, selection, gestures, commands, properties, and measurement overlays | WS-IOS | P3-MAP-01, P3-BE-01 | Native editor tests and representative device profile |
| P3-IOS-02 | Integrate optional MapKit context without making canonical garden geometry provider-dependent | WS-IOS | P3-IOS-01 | Blank and georeferenced gardens both work |
| P3-UX-01 | Implement layer visibility/locking, scale/accuracy presentation, unsaved/local/synchronized states, warnings, and non-survey disclosures | WS-DESIGN, WS-IOS, WS-WEB | P3 editors | Usability and accessibility report |
| P3-QA-01 | Create small, ordinary, large, pathological, and accessibility map fixtures and cross-platform semantic comparison | WS-QA, WS-MAP | P3-MAP-01 | CI equivalence gate |
| P3-PERF-01 | Measure open, pan/zoom, hit test, select, command commit, viewport query, and memory budgets | WS-QA, WS-OPS | P3 editors | Performance scorecard meets Phase 0 budgets |

### 12.3 Exit Criteria

- A user can represent the lot, house, deck, internal fence, gate, path, bed, tree, and plants.
- A garden may begin without scale or geographic coordinates.
- Coordinates cannot be confused with WGS84.
- Editing is command-based and undoable, and stable interaction boundaries produce mutations.
- Invalid geometry, unexpected overlap, detached gates, and conflicting scale are explained consistently.
- Generated or imported content cannot silently replace accepted objects.
- Map rendering and interaction meet measured representative budgets.
- G3 is approved.

### 12.4 Source Traceability

The canonical types, dual coordinate model, commands, layers, client renderers, accessibility, performance strategy, and completion criteria are defined in the map and data designs. [Source: architecture/map-rendering-and-editing.md, sections "3. Coordinate Spaces", "4. Canonical Object Categories", "7. Editor Command Model", "12. Layer Model", "13. Web Rendering", "14. Apple Rendering", "19. Accessibility", and "22. Completion Criteria"; architecture/data-and-geospatial-design.md, sections "7. Garden Object Model", "8. Local Coordinate Space", "9. Georeferencing", and "13. Revision Model"]

## 13. Phase 4 — Plants, Observations, History, and Manual Work

### 13.1 Outcome

The garden becomes useful care data rather than only a drawing. Users manage plants and plant groups, record condition updates, see chronological history, and create and complete manual work on both product surfaces.

### 13.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P4-DATA-01 | Add plant instances, taxonomy references, varieties, groups/rows, placements, lifecycle, garden facts, and archive/remove states | WS-DATA | P3-DATA-01, P0-PROD-03 | Migration and domain invariant tests |
| P4-DATA-02 | Add append-oriented observations, condition facts, measurements, amendments, history events, and provenance | WS-DATA | P4-DATA-01 | Chronology and amendment tests |
| P4-DATA-03 | Add manual tasks, target references, recurrence representation, assignments placeholder, attachments relationship, and state history | WS-DATA | P4-DATA-01 | Task transition tests |
| P4-BE-01 | Implement plants-inventory module, manual add/edit/group/move/lifecycle/archive commands, and read models | WS-BE | P4-DATA-01 | Module and API tests |
| P4-BE-02 | Implement observations-history module with append/amend flows and garden/area/plant timelines | WS-BE | P4-DATA-02 | Ordering, authorization, and history tests |
| P4-BE-03 | Implement task lifecycle for create, schedule, recur, complete, postpone, edit, dismiss, and delete | WS-BE | P4-DATA-03 | State-machine and idempotency tests |
| P4-CONTRACT-01 | Add plants, observations, history, and task contracts with stable errors and revision behavior | WS-CONTRACT | P4-BE-01..03 | Generated client compilation and examples |
| P4-IOS-01 | Implement plant list/detail, map-to-plant navigation, manual plant/group addition, lifecycle, observations, history, and manual tasks | WS-IOS | P4-CONTRACT-01 | Native care-record E2E |
| P4-WEB-01 | Implement equivalent plant, observation, history, and task management optimized for larger screens | WS-WEB | P4-CONTRACT-01 | Web care-record E2E |
| P4-DESIGN-01 | Validate unknown plant, incomplete data, group/row, dormant/dead/removed, correction, and empty-history UX | WS-DESIGN | P4 client flows | Usability findings resolved or tracked |
| P4-SEARCH-01 | Add PostgreSQL full-text/trigram search and structured filters for approved plant and garden fields | WS-DATA, WS-BE | P4-DATA-01 | Relevance, authorization, and query-plan tests |
| P4-OBS-01 | Add privacy-safe product events for garden setup, first useful area, first plant, observation, and task outcome | WS-OPS | P4 clients | Consent on/off tests and event catalog |
| P4-QA-01 | Test cross-object authorization, time zones, locale/units, recurrence edges, concurrent edits, and cross-client history consistency | WS-QA | All P4 implementation | G4 release evidence |

### 13.3 Exit Criteria

- Plants, rows, and groups link to the same accepted map objects and garden context.
- Unknown and partially known plants remain valid editable records.
- Observations and important history are append-oriented.
- Task transitions preserve outcome history and are idempotent where appropriate.
- English and Russian strings, metric and imperial presentation, and accessibility cover these workflows.
- G4 is approved.

### 13.4 Source Traceability

Plant, observation, work, and history behavior comes from the product requirements and module ownership. [Source: technical-specification.md, sections "FR-19: Plant Records", "FR-20: Plant Addition", "FR-21: Plant Lifecycle and Seasonal Planning", "FR-23: Monitoring and Observations", and "FR-25: Work Planner"; architecture/backend-modular-monolith.md, sections "6.3 Plants and Inventory", "6.4 Observations and History", and "6.5 Tasks and Recommendations"; architecture/data-and-geospatial-design.md, section "14. Append-Oriented Records"]

## 14. Phase 5 — Native Offline Synchronization and Web Continuity

### 14.1 Outcome

Native user changes survive disconnection and process termination, synchronize idempotently, and expose recoverable conflicts. Web remains online-first, preserves approved drafts, and shares authoritative revisions and conflict semantics.

### 14.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P5-DATA-01 | Finalize ordered sync change log, tombstones, snapshot boundary, cursor retention, authorization partitions, and idempotency retention | WS-DATA | P3/P4 schemas | Retention-gap and sequence tests |
| P5-API-01 | Implement versioned push, changes, acknowledge, snapshot, client registration, and upgrade-state contracts | WS-BE, WS-CONTRACT | P5-DATA-01 | Bounded resumable API tests |
| P5-BE-01 | Process dependency-aware push batches with per-operation accepted/duplicate/conflict/rejected/blocked/retry results | WS-BE | P5-API-01 | Partial-success and lost-response tests |
| P5-BE-02 | Implement deterministic incremental pull, initial snapshot, partition reset, full resync, revocation, and mobile-version policy | WS-BE | P5-API-01 | Cursor/revocation/version tests |
| P5-IOS-01 | Implement GRDB local read models, sync outbox, cursors, conflicts, operation results, media transfer references, and local drafts | WS-IOS | P5-API-01 | Migration and atomicity tests |
| P5-IOS-02 | Route every foundation offline-capable mutation through atomic local projection plus domain-command outbox | WS-IOS | P5-IOS-01 | Termination-at-boundary fault tests |
| P5-IOS-03 | Implement bounded push/pull engine, backoff, checkpointing, foreground/background triggers, explicit retry, and status model | WS-IOS | P5-IOS-02, P5-BE-01..02 | Offline/restart/convergence suite |
| P5-CONFLICT-01 | Implement durable recovery for stale geometry, task transitions, rejected operations, and dependency failures | WS-IOS, WS-DESIGN | P5-IOS-03 | User can keep server, reapply, compare, or duplicate when allowed |
| P5-SEC-01 | Remove protected local partitions and stop stale pushes after membership or account revocation | WS-IOS, WS-BE, WS-SEC | P5-BE-02 | Offline removal attack tests |
| P5-WEB-01 | Implement explicit stale/disconnected states and schema-versioned recoverable drafts for selected forms and map sessions | WS-WEB | P3/P4 web flows | Browser restart and disconnect tests |
| P5-OBS-01 | Instrument outbox age, push results, pull lag, full resync, conflicts, version distribution, and revocation cleanup without payloads | WS-OPS | P5 engine | Sync dashboard and alert candidates |
| P5-QA-01 | Add deterministic state-machine, randomized convergence, clock skew, large backlog, schema upgrade, and every-checkpoint fault injection | WS-QA | All P5 implementation | Required sync matrix passes |

### 14.3 Exit Criteria

- Every offline-capable mutation is atomic with a durable outbox command.
- Retrying after unknown server outcome cannot duplicate accepted effects.
- Pull application and cursor advancement are atomic.
- Same-object geometry conflicts never silently discard user work.
- Membership revocation removes protected local data and blocks stale commands.
- Supported app upgrades preserve pending work or expose explicit recovery.
- Web never presents a disconnected draft as a confirmed server save.
- G5 is approved through real-device field tests.

### 14.4 Source Traceability

Authority, local tables, protocols, conflicts, revocation, background execution, and the test matrix come directly from the offline design. [Source: architecture/offline-synchronization.md, sections "4. Authority Model", "5. Local Tables", "8. Push Protocol", "10. Pull Protocol", "11. Authorization Changes", "14. Conflict Categories", "19. Background Execution", "24. Testing Matrix", and "25. Completion Criteria"; architecture/web-application-design.md, section "9. Online-First Behavior"]

## 15. Phase 6 — Media, Photos, and Property-Plan Import

### 15.1 Outcome

Native and web clients upload ordinary photos and sensitive property plans directly and recoverably. Users preview, calibrate, trace, hide, and revisit plan backgrounds. The system verifies, derives, authorizes, retains, and deletes media correctly.

### 15.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P6-PLAT-01 | Provision private per-environment user-media, raw-capture, derived, and export buckets with public-access prevention and lifecycle shells | WS-PLAT, WS-SEC | P1-PLAT-01 | Terraform and public-access tests |
| P6-DATA-01 | Add media identity, ownership, class, checksum, upload/processing/retention state, variants, relationships, and quota reservations | WS-DATA | P4 schemas | Migration and state-machine tests |
| P6-API-01 | Implement media registration, authorized resumable session, completion verification, status, and authorized short-lived access | WS-BE, WS-CONTRACT | P6-DATA-01, P6-PLAT-01 | Contract, authorization, and replay tests |
| P6-ASYNC-01 | Implement transactional outbox relay and Cloud Tasks paths for media verification and derivatives with durable job state | WS-BE, WS-PLAT | P6-API-01 | Duplicate delivery and relay crash tests |
| P6-WORKER-01 | Build constrained validators for MIME signature, size, dimensions/duration, checksum, malformed files, metadata, and malware outcome | WS-MEDIA, WS-SEC | P6-ASYNC-01 | Malicious fixture suite |
| P6-WORKER-02 | Build idempotent thumbnails, screen previews, metadata stripping, PDF page previews, and plan tile derivatives | WS-MEDIA | P6-WORKER-01 | Checksum/version reproducibility tests |
| P6-IOS-01 | Implement background-capable registration/upload/verify coordination, local file durability, observation photo attachment, progress, pause, retry, and recovery | WS-IOS | P6-API-01 | Termination and network-interruption tests |
| P6-WEB-01 | Implement direct resumable upload, recoverable browser metadata where allowed, progress, retry, and authorized previews | WS-WEB | P6-API-01 | Browser upload interruption tests |
| P6-PLAN-01 | Implement document selection, local safety validation, private upload, page selection, perspective/orientation handling, and background management | WS-IOS, WS-WEB, WS-MEDIA | P6-WORKER-02 | Image and PDF plan E2E |
| P6-PLAN-02 | Implement known-distance calibration, residual error, scale revision, trace tools, plan-to-map transforms, and recalibration command | WS-MAP, WS-BE | P6-PLAN-01, P3-MAP-01 | Shared calibration fixtures pass |
| P6-PLANT-01 | Integrate one evaluated photo-identification adapter behind editable uncertain candidates and unknown-plant fallback | WS-BE, WS-GUIDE | P0-PROV-01, P6 media | Quality, privacy, timeout, and fallback report |
| P6-RET-01 | Implement ordinary-media retention, orphan reconciliation, derivative cleanup, deletion workflow, and user-visible raw-capture policy foundation | WS-MEDIA, WS-OPS | P6-ASYNC-01 | Lifecycle/deletion race tests |
| P6-OBS-01 | Add upload, verification, processing, stored-byte, orphan, retention, and deletion-lag dashboards | WS-OPS | P6 media pipeline | Dashboard and runbook evidence |
| P6-QA-01 | Test unauthorized cross-garden access, viewer restrictions, malformed inputs, parser limits, signed-access expiry, and plan accuracy labels | WS-QA, WS-SEC | All P6 implementation | G6 release evidence |

### 15.3 Exit Criteria

- Media bytes bypass the interactive API.
- Unverified uploads remain isolated.
- The only local copy is not removed before verified durability or deliberate discard.
- Plan backgrounds are private, calibrated with explicit uncertainty, and independently hideable.
- Users can trace and edit lot, house, deck, fence, path, and beds from a plan.
- Signed access cannot bypass current garden authorization.
- Originals, derivatives, orphan cleanup, retention, and deletion are observable.
- G6 is approved.

### 15.4 Source Traceability

Media state, direct upload, verification, derivatives, plan handling, retention, and completion criteria are defined in the media design. Plan flow and calibration behavior are also defined in the capture and map designs. [Source: architecture/media-storage-and-processing.md, sections "3. Media Classes", "6. Upload State Machine", "7. Upload Flow", "8. File Validation", "11. Plan Documents", "15. Retention and Lifecycle", and "21. Completion Criteria"; architecture/garden-capture-and-scan.md, section "8. Plan Import Flow"; architecture/map-rendering-and-editing.md, section "16. Plan Import and Calibration"]

## 16. Phase 7 — Weather, Recommendations, Today, and Notifications

### 16.1 Outcome

Structured garden facts, weather, care history, and reviewed rules produce prioritized, explainable actions. Users act on those items through Today, and durable in-app/FCM notification behavior respects preference, freshness, quiet hours, authorization, and deduplication.

### 16.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P7-INT-01 | Implement provider registry and normalized weather adapter with source, effective time, freshness, units, quality, license, timeout, cache, and quota | WS-BE, WS-GUIDE | P0-PROV-01 | Provider contract and stale-data tests |
| P7-INT-02 | Implement normalized plant-content adapter with stable application taxonomy, source/version/license metadata, and user-fact separation | WS-BE, WS-GUIDE | P0-PROV-01, P4 plants | Provider replacement tests |
| P7-DATA-01 | Add recommendation candidates, evidence, rule versions, priority factors, presentation state, feedback, and supersession history | WS-DATA | P4 data | Migration and lifecycle tests |
| P7-RULE-01 | Build deterministic versioned rule engine, eligibility filters, safety tiers, timing, duplicate suppression, priority, and fallback explanations | WS-GUIDE, WS-BE | P0-PROD-03..04, P7-DATA-01 | Horticulture-reviewed fixture suite |
| P7-ASYNC-01 | Schedule weather refresh and recommendation generation through Scheduler, Tasks/Jobs, and transactional outbox | WS-BE, WS-PLAT | P7-INT-01, P7-RULE-01 | Duplicate-safe scheduled runs |
| P7-AI-01 | Add Vertex AI adapter for bounded explanation only after deterministic baseline; enforce schemas, evidence references, unsupported-action rejection, budget, fallback, and version flag | WS-GUIDE, WS-SEC | P7-RULE-01 | Bilingual evaluation and rollback evidence |
| P7-BE-01 | Implement Today queries and commands for complete, postpone, dismiss, irrelevant feedback, and task conversion | WS-BE | P7-RULE-01 | Priority and outcome history tests |
| P7-IOS-01 | Implement Today, recommendation detail/evidence, feedback, history linkage, and safe degraded states | WS-IOS | P7-BE-01 | Native complete care-loop E2E |
| P7-WEB-01 | Implement equivalent Today, evidence, actions, history, and administration on web | WS-WEB | P7-BE-01 | Web complete care-loop E2E |
| P7-NOTIF-01 | Add notification intents, inbox, preferences, quiet hours, time zones, deduplication, expiry, and deep links | WS-BE | P7-BE-01 | Notification policy tests |
| P7-NOTIF-02 | Integrate FCM device records and delivery worker; recheck access, preference, and recommendation freshness at send time | WS-BE, WS-IOS | P7-NOTIF-01 | Invalid-token and stale-intent tests |
| P7-ANALYTICS-01 | Implement consented care-loop analytics and quality dashboards for presentation, completion, postponement, rejection, irrelevance, freshness, and fallback | WS-OPS, WS-PROD | P7 clients | Event schema and consent tests |
| P7-SAFE-01 | Complete horticultural review for launch rules and explicitly exclude or constrain chemical, toxicity, pest-treatment, structural, medical, and legal-boundary guidance | WS-GUIDE, WS-SEC | P7-RULE-01 | Reviewed safety catalog |
| P7-QA-01 | Test missing/contradictory facts, stale weather, provider outage, model outage, hallucinated facts, prompt injection, time zones, duplicate alerts, and bilingual output | WS-QA | All P7 implementation | G7 care-loop evidence |

### 16.3 Exit Criteria

- Every recommendation references structured evidence and a versioned rule.
- Missing facts remain missing; no system fills them by invention.
- The system functions when weather, FCM, or Vertex AI is degraded according to documented fallbacks.
- Generated text cannot add unsupported actions or bypass safety filters.
- Today presents a small prioritized set with reason, urgency, uncertainty, and controls.
- Action outcome reaches task/recommendation history and product-quality measurement.
- In-app intent remains correct even when push delivery fails.
- G7 is approved for a controlled US private beta.

### 16.4 Source Traceability

The recommendation pipeline, safety, fallback, evaluation, and completion criteria are defined in the recommendation design. Weather normalization and notification ownership are defined in their detailed designs. [Source: architecture/recommendations-and-ai.md, sections "3. Recommendation Pipeline", "5. Rule Engine", "8. Vertex AI Boundary", "13. Safety Tiers", "16. Evaluation and Release", and "19. Completion Criteria"; architecture/external-integrations.md, section "5. Weather"; architecture/notifications.md, sections "3. Ownership", "5. Flow", "9. Scheduling", and "17. Completion Criteria"]

## 17. Phase 8 — Foundation Beta, Hardening, and United States GA

### 17.1 Outcome

Turn the complete care loop into an operable, supportable, private, accessible, recoverable, and cost-controlled production product for the United States.

### 17.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P8-EXPORT-01 | Implement account/garden export request, consistent boundary, checkpointed ZIP job, JSON/GeoJSON/CSV/media/checksums/README, private expiry, and notification | WS-BE, WS-MEDIA | P6, P7 async | Export privacy and consistency tests |
| P8-DELETE-01 | Implement garden and account deletion with recent auth, 30-day recovery, access revocation, ownership resolution, jobs/providers/media cleanup, purge, and completion evidence | WS-BE, WS-SEC | P2 identity, P5 sync, P6 media | End-to-end deletion verification |
| P8-SEC-01 | Complete formal threat model covering object authorization, invitations, offline replay, uploads/parsers, SSRF, signed URLs, AI/tool abuse, supply chain, cost abuse, and support access | WS-SEC | Foundation implementation | Signed mitigation register |
| P8-SEC-02 | Move CSP and selected Cloud Armor rules from observe to enforce; enforce App Check on validated expensive endpoints; complete IAM and secret reviews | WS-SEC, WS-PLAT | Beta telemetry | Enforcement canary and rollback evidence |
| P8-NET-01 | Finalize production load balancer, TLS, Cloud Armor, restricted Cloud Run ingress, Direct VPC egress, private Cloud SQL, exact CORS, domains, and subnet alarms | WS-PLAT | P1 infrastructure | Ingress bypass and connectivity tests |
| P8-DB-01 | Enable regional HA, backups, PITR, deletion protection, capacity alerts, and safe connection limits | WS-PLAT, WS-DATA | P8-NET-01 | Failover and restore report |
| P8-REL-01 | Write and exercise rollback, database restore, queue/dead-letter, provider outage, credential compromise, authorization incident, deletion, cost, and regional recovery runbooks | WS-OPS | Foundation implementation | Timed exercise records |
| P8-SLO-01 | Approve numeric SLOs, error-budget alerts, performance budgets, quotas, retention schedule, and operational owners from beta evidence | WS-OPS, WS-PROD | Private beta | Approved launch scorecard |
| P8-LOAD-01 | Run interactive, sync backlog, upload burst, recommendation batch, provider slowdown, failover, and cost load tests | WS-QA, WS-OPS | Production-like staging | Capacity and unit-cost report |
| P8-UX-01 | Complete iPhone, iPad, desktop/laptop responsive, keyboard, screen-reader, outdoor-use, reduced-motion, English/Russian, unit, date, and time-zone acceptance | WS-DESIGN, WS-QA | All client features | Accessibility/localization sign-off |
| P8-PRIV-01 | Finalize US privacy notice, permission copy, consent, provider disclosures, data-processing terms, support access, raw retention, backup deletion language, and App Store privacy declarations | WS-SEC, WS-PROD | Provider contracts | Legal/privacy launch approval |
| P8-SAFE-01 | Validate non-survey disclaimers, measurement uncertainty, plant-identification uncertainty, recommendation exclusions, and incident escalation | WS-PROD, WS-GUIDE | Beta feedback | Safety launch approval |
| P8-STORE-01 | Prepare App Store metadata, screenshots, review notes, account-deletion path, privacy details, support links, staged rollout, and rollback communication | WS-PROD, WS-IOS | P8 approvals | Store submission accepted |
| P8-SUPPORT-01 | Establish support intake, incident severity, privacy-safe diagnostic collection, feature-disable controls, and escalation ownership | WS-OPS, WS-SEC | Runbooks | Support simulation passes |
| P8-GA-01 | Run release-candidate E2E suite, migration rehearsal, backup/restore, security tests, documentation audit, artifact promotion, canary, and post-deploy validation | WS-QA, WS-PLAT | All P8 work | Signed G8 checklist |

### 17.3 Exit Criteria

- All documented foundation acceptance outcomes pass on supported native and web surfaces.
- Production database, storage, ingress, service identities, queues, backups, dashboards, budgets, alerts, and runbooks meet approved launch thresholds.
- Export is private and machine-readable; deletion reaches all in-scope authoritative and derived systems.
- Cross-garden authorization, offline replay, malicious upload, web session, and AI boundary tests pass.
- English/Russian localization and launch accessibility matrix pass.
- Restore and rollback are timed and rehearsed.
- Documentation matches the release candidate.
- G8 is approved and the same immutable artifacts are promoted to production.

### 17.4 Source Traceability

Launch work derives from the delivery, security, reliability, testing, export, networking, observability, and cost completion criteria. [Source: architecture/environments-and-delivery.md, sections "18. Release Verification" and "20. Completion Criteria"; architecture/networking.md, sections "3. Production Topology" and "22. Completion Criteria"; architecture/security-and-privacy.md, sections "23. Vulnerability Management", "24. Incident Response", and "27. Completion Criteria"; architecture/reliability-and-disaster-recovery.md, sections "8. Restore Testing", "18. Runbooks", and "20. Completion Criteria"; architecture/data-export-and-deletion.md, sections "3. Export Scope", "11. Account Deletion", and "19. Completion Criteria"; architecture/testing-strategy.md, sections "20. End-to-End Scenarios" and "22. CI Gates"]

## 18. Phase 9 — Collaboration and Seasonal Context

### 18.1 Outcome

Validated single-user gardens become safely shareable. Owners invite editors and viewers, assign work, transfer ownership, and see attribution without weakening garden isolation. In parallel, the care model adds reviewed seasonal planning and richer garden context.

### 18.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P9-COLLAB-01 | Finalize capability matrix for owner/editor/viewer across every existing resource, expensive operation, export, raw media, and administration | WS-PROD, WS-SEC | Foundation usage evidence | Approved capability matrix |
| P9-DATA-01 | Complete invitation, membership, ownership transfer, assignment, attribution, and collaboration audit schema | WS-DATA | P2 identity, P4 tasks | Migration and invariant tests |
| P9-BE-01 | Implement invitation create/revoke/accept/expire, membership change/removal, ownership transfer, and role commands | WS-BE | P9-DATA-01 | Idempotency, expiry, recent-auth, and audit tests |
| P9-BE-02 | Add task assignment, assignee changes, shared history attribution, and collaboration notification policies | WS-BE | P9-BE-01, P7 notifications | Concurrent assignment tests |
| P9-SYNC-01 | Synchronize membership grants/revocations, attribution, task assignment, and conflicts without leaking inaccessible prior data | WS-BE, WS-IOS | P9-BE-01..02 | Offline membership-change scenarios |
| P9-IOS-01 | Implement invitation, member management, role display, assignments, removal, ownership transfer, and revoked-access UX | WS-IOS | P9 APIs | Native collaboration E2E |
| P9-WEB-01 | Implement collaboration administration, invitation links, member table, assignments, and ownership transfer | WS-WEB | P9 APIs | Web collaboration E2E |
| P9-CONTEXT-01 | Add reviewed facts for sunlight, soil, drainage, irrigation, microclimate, greenhouse/container/open-ground, and their source/quality | WS-DATA, WS-GUIDE | Foundation garden model | Context provenance tests |
| P9-SEASON-01 | Implement supported seasonal calendars, succession planning, crop rotation, recurrence, and location-aware schedule rules | WS-GUIDE, WS-BE | P9-CONTEXT-01 | Horticulture-reviewed seasonal fixtures |
| P9-UX-01 | Expose seasonal plan, context quality, shared responsibilities, and conflicts without overwhelming the Today view | WS-DESIGN | P9 features | Usability validation |
| P9-QA-01 | Run full capability matrix for member/non-member/removed/suspended/support actors and daylight-saving/season boundaries | WS-QA | All P9 implementation | G9 release evidence |

### 18.3 Exit Criteria

- Invitations are opaque, expiring, revocable, idempotent, and audited.
- Every resource and command has explicit role-capability tests, including cross-garden denial.
- Removing access affects the next server operation and produces correct native local cleanup.
- Shared task attribution and conflicting changes remain understandable and recoverable.
- Seasonal and context guidance stores source, quality, location, and version.
- Collaboration and seasonal features can be disabled independently without damaging accepted garden data.
- G9 is approved.

### 18.4 Source Traceability

Collaboration follows the documented role, invitation, ownership, synchronization, and notification boundaries. Seasonal/context work comes from the proposed next scope. [Source: architecture/identity-and-authorization.md, sections "8. Garden Roles", "10. Invitations", and "11. Ownership Transfer"; architecture/offline-synchronization.md, section "11. Authorization Changes"; technical-specification.md, sections "FR-21: Plant Lifecycle and Seasonal Planning", "FR-22: Garden Context", and "FR-27: Shared Garden Care"]

## 19. Phase 10 — Assisted Photo/Video Capture and Plan Recognition

### 19.1 Outcome

The native client guides users through recoverable photo/video capture and the cloud produces reviewable object/line proposals. Property-plan processing gains assisted OCR and vectorization, while manual calibration and tracing remain complete fallbacks.

### 19.2 Research Gate

Before production implementation, approve a consented evaluation set covering garden layouts, structures, lighting/weather, devices, vegetation, occlusion, surface texture, and reference measurements. Approve thresholds for capture abandonment, useful-proposal precision/recall, geometry error, correction time, processing time, privacy, and unit cost. [Source: architecture/garden-capture-and-scan.md, section "20. Evaluation"]

### 19.3 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P10-RESEARCH-01 | Collect consented representative data, ground truth, annotation guide, privacy controls, and reproducible baseline | WS-CV, WS-PROD, WS-SEC | Research Gate | Dataset card and approval |
| P10-DATA-01 | Add capture session, capability class, media references, quality observations, calibration, processing state, and cancellation/recovery fields | WS-DATA | P6 media | Migration and lifecycle tests |
| P10-IOS-01 | Build capture coordinator over AVFoundation, Vision/Core ML where approved, location/motion metadata, local checkpoints, and explicit user confirmation | WS-IOS, WS-MEDIA | P10-DATA-01 | Lifecycle interruption tests |
| P10-IOS-02 | Implement safe movement guidance, coverage, blur, exposure, rotation, featureless surface, lost tracking, duration, storage, partial save, and recapture guidance | WS-IOS, WS-DESIGN | P10-IOS-01 | Real-device safety/usability report |
| P10-ASYNC-01 | Add manifests, job state, Cloud Tasks initiation, Cloud Run Job execution, progress, cancellation, checkpoint, retry, and terminal failure | WS-BE, WS-PLAT | P6 async | Duplicate/cancel/retry tests |
| P10-CV-01 | Implement versioned frame/document normalization, sampling, perspective correction, OCR, line/candidate extraction, and quality diagnostics | WS-CV | P10-ASYNC-01 | Reproducibility and benchmark report |
| P10-CV-02 | Map extracted candidates into immutable typed proposal packages with confidence, provenance, alignment, previews, limitations, and processor versions | WS-CV, WS-MAP | P10-CV-01, P3 map | Proposal schema and validation tests |
| P10-REVIEW-01 | Implement overlay comparison, per-object accept/edit/reject, bulk summary, stale-revision conflict, and problem reporting on supported clients | WS-IOS, WS-WEB, WS-BE | P10-CV-02 | Review E2E preserving accepted geometry |
| P10-RET-01 | Enforce raw media consent, processing disclosure, 30-day successful-extraction default, earlier deletion where allowed, and training prohibition | WS-SEC, WS-MEDIA | P10 capture | Retention and deletion tests |
| P10-COST-01 | Enforce duration, file, concurrency, stage, retry, CPU-first, and user-confirmation limits | WS-PLAT, WS-OPS | P10 pipeline | Cost per accepted/useful proposal report |
| P10-QA-01 | Test permissions, interruption, partial upload, malformed media, duplicate processing, stale acceptance, rejection, and version replay | WS-QA | All P10 implementation | G10 assisted-capture evidence |

### 19.4 Exit Criteria

- Capture interruption preserves completed recoverable work.
- On-device guidance communicates limitations without promising reconstruction.
- Every proposal references exact inputs and processor/model versions.
- Users can accept, edit, or reject each result; rejection preserves accepted geometry.
- Manual plan calibration and tracing remain available when extraction fails.
- Raw media retention and remote processing are explicit and enforced.
- Evaluation shows lower user effort for the selected use cases at approved quality and cost.

### 19.5 Source Traceability

This phase implements Stages 1 and 2 of the capture design and its proposal/review pipeline. [Source: architecture/garden-capture-and-scan.md, sections "3. Staged Capability Plan", "6. Capture Session", "7. Safety UX Requirements", "10. Video Capture Guidance", "11. Processing Pipeline", "13. Proposal Model", and "14. User Review"]

## 20. Phase 11 — AR and LiDAR Measurement

### 20.1 Outcome

Supported Apple devices can mark points, segments, and polygons on site, show estimated dimensions and tracking quality, align results to the garden-local map, and optionally use depth/LiDAR to improve proposals. Unsupported devices retain complete manual and plan flows.

### 20.2 Research Gate

Approve device capability tiers and use-case-specific error thresholds using physical reference measurements across representative outdoor surfaces, distances, light, weather, motion, occlusion, and garden layouts. Do not use one global accuracy claim.

### 20.3 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P11-RESEARCH-01 | Benchmark ARKit tracking, relocalization, segment length, accumulation error, alignment methods, depth, and LiDAR across launch device tiers | WS-IOS, WS-CV | Research Gate | Device/use-case capability matrix |
| P11-IOS-01 | Implement runtime capability detection, permission flow, AR session lifecycle, point/line/polygon marking, undo, close/cancel, partial save, and live quality | WS-IOS | P10 capture coordinator | Real-device interaction tests |
| P11-MEASURE-01 | Convert AR observations to application-owned SI measurements, transforms, quality, uncertainty, and calibration records | WS-IOS, WS-MAP | P11-IOS-01 | Reference-measurement fixtures |
| P11-ALIGN-01 | Implement first-segment local origin, two-control-point alignment, explicit later realignment, residual error, and versioned alignment record | WS-MAP, WS-IOS, WS-BE | P11-MEASURE-01 | Alignment and disagreement tests |
| P11-SEGMENT-01 | Support long-object segmented capture, shared control points, accumulated-error warning, and independent segment correction | WS-IOS, WS-DESIGN | P11-ALIGN-01 | Long fence/path field tests |
| P11-LIDAR-01 | Add optional depth and scene observations behind capability checks; evaluate plane, edge, obstacle, and scale improvement | WS-IOS, WS-CV | P11-RESEARCH-01 | Quality delta versus non-LiDAR baseline |
| P11-PROPOSAL-01 | Convert accepted AR/depth results into ordinary editable map proposal commands with provenance and stale-revision protection | WS-BE, WS-MAP | P11-ALIGN-01 | Proposal acceptance E2E |
| P11-SAFE-01 | Implement continuous recording state, tracking degradation pause, obstacle/private-property guidance, no backward-walking instruction, and estimate disclaimers | WS-DESIGN, WS-SEC | P11-IOS-01 | Safety review and observed field study |
| P11-QA-01 | Test permission denial/regrant, interruption, poor tracking, relocalization failure, unsupported devices, alignment conflicts, and manual fallback | WS-QA | All P11 implementation | G10 AR/LiDAR evidence |

### 20.4 Exit Criteria

- Supported use cases meet approved error and completion thresholds; unsupported cases are disabled or labeled experimental.
- AR framework objects do not become persistent domain geometry.
- Every result is editable, source-labeled, uncertainty-bearing, and non-survey.
- Relocalization failure has explicit alignment and manual recovery.
- LiDAR changes capability quality, not product availability.
- G10 is approved independently for each enabled capability tier.

### 20.5 Source Traceability

AR measurement, alignment, capability tiers, safety, and manual fallback are specified in the product and capture designs. [Source: technical-specification.md, sections "FR-13: On-Site AR Marking" and "FR-14: AR-to-Map Alignment"; architecture/garden-capture-and-scan.md, sections "5. Capture Capability Tiers", "7. Safety UX Requirements", "9. AR Measurement Flow", and "15. Alignment and Reconciliation"]

## 21. Phase 12 — Guided Garden Scan and Advanced Reconstruction

### 21.1 Outcome

Users capture gardens in manageable zones with live quality guidance. A versioned, observable, cost-bounded pipeline can reconcile supported captures and propose semantic objects without changing accepted geometry automatically.

### 21.2 Research Gate

Garden Scan proceeds only if assisted capture and AR evidence show that additional automation can materially reduce map-creation effort at acceptable correction cost, privacy risk, processing reliability, and unit economics. The exact reconstruction technology requires a licensing, security, reproducibility, and compute ADR.

### 21.3 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P12-RESEARCH-01 | Benchmark owned and specialist reconstruction approaches, including CPU/GPU requirements, licensing, data retention, model training terms, and failure modes | WS-CV, WS-SEC, WS-PLAT | Research Gate | Accepted technology ADR or stop decision |
| P12-CAPTURE-01 | Add zone planning, overlap/coverage guidance, segment checkpoints, capability-aware observations, and resumable multi-zone sessions | WS-IOS | P10/P11 capture | Multi-zone interruption tests |
| P12-WF-01 | Implement Workflows only where multiple long remote stages justify orchestration; retain authoritative job state in PostgreSQL | WS-BE, WS-PLAT | P12-RESEARCH-01 | Retry/cancel/late-result tests |
| P12-CV-01 | Implement versioned normalization, association, alignment, reconstruction, semantic candidate extraction, and quality reports | WS-CV | P12-WF-01 | Reproducible benchmark pipeline |
| P12-MERGE-01 | Reconcile zones through anchors, control points, measurements, geographic context, imagery features, and accepted geometry with residual errors | WS-CV, WS-MAP | P12-CV-01 | Disagreement produces alternatives/warnings |
| P12-VALIDATE-01 | Validate proposals with PostGIS, category rules, accepted measurements, coverage, tracking, residual, and model confidence | WS-BE, WS-DATA | P12-CV-01 | Invalid proposals cannot reach review as valid |
| P12-REVIEW-01 | Provide zone/package review, confidence explanations, per-object edits, bulk change summary, recapture guidance, and version-safe acceptance | WS-IOS, WS-WEB | P12-VALIDATE-01 | Review and stale-acceptance E2E |
| P12-COST-01 | Add preflight estimate, explicit high-cost confirmation, per-account concurrency/allowance, early rejection, stage caching, cancellation, and actual cost reporting | WS-PLAT, WS-OPS | P12 pipeline | Budget-protection tests |
| P12-PRIV-01 | Verify processing disclosure, neighboring-property handling, provider restrictions, raw retention/deletion, derivative minimization, and no-training policy | WS-SEC | P12 pipeline | Privacy impact assessment |
| P12-QA-01 | Evaluate object precision/recall, geometry/calibration error, correction effort, success, cost, device/garden cohorts, safety events, and manual fallback | WS-QA, WS-PROD | All P12 implementation | G11 evidence report |

### 21.4 Exit Criteria

- Every pipeline stage is versioned, retryable, independently observable, and reproducible where retained inputs permit it.
- Duplicate or late work cannot duplicate effects or overwrite newer state.
- Quality diagnostics translate into useful correction or recapture actions.
- Raw media is deleted according to the approved explicit policy.
- Optional processing can be constrained without disabling garden access.
- G11 is approved for a controlled cohort before broad rollout.

### 21.5 Source Traceability

Garden Scan remains a future, proposal-only capability with hybrid processing, staged checkpoints, explicit quality, cost, privacy, and evaluation requirements. [Source: technical-specification.md, section "FR-16: Guided Garden Scan"; architecture/garden-capture-and-scan.md, sections "4. Hybrid Processing Boundary", "11. Processing Pipeline", "16. Quality Model", "17. Privacy and Retention", and "20. Evaluation"; architecture/asynchronous-processing.md, sections "7. Cloud Run Jobs", "9. Workflows", and "10. Job State Machine"]

## 22. Phase 13 — Constrained Conversational Assistance

### 22.1 Outcome

Users can ask typed and, where supported, spoken questions about authorized garden facts, recommendations, tasks, and history. The assistant is optional, evidence-bound, and unable to mutate data without explicit confirmation.

### 22.2 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P13-PROD-01 | Select a narrow launch task set and explicitly define unsupported, elevated-risk, and restricted topics | WS-PROD, WS-GUIDE, WS-SEC | Foundation feedback | Approved assistant policy |
| P13-DATA-01 | Define authorized retrieval projections, conversation metadata, consent, retention, deletion, and audit boundaries | WS-DATA, WS-SEC | P13-PROD-01 | Data-flow review |
| P13-TOOL-01 | Implement server-side read tools for garden facts, recommendations, tasks, and history with per-call authorization and bounded output | WS-BE | P13-DATA-01 | Cross-garden and prompt-content attacks fail |
| P13-TOOL-02 | Implement draft-observation/task tools that always require structured user confirmation before domain command execution | WS-BE | P13-TOOL-01 | Confirmation and replay tests |
| P13-AI-01 | Extend the Vertex adapter with strict schemas, minimal evidence packets, source references, safety filters, timeout/token/cost budgets, and deterministic refusal/fallback | WS-GUIDE, WS-SEC | P7 AI adapter | Evaluation suite passes |
| P13-IOS-01 | Add typed UI and optional speech input with visible evidence, uncertainty, confirmation, cancellation, and non-voice alternative | WS-IOS | P13 APIs | Native accessibility and interruption tests |
| P13-WEB-01 | Add typed assistant with the same evidence, confirmation, and authorized-history behavior | WS-WEB | P13 APIs | Web assistant E2E |
| P13-QA-01 | Test hallucinated facts, indirect prompt injection, cross-garden references, unsafe guidance, refusal, provider outage, bilingual quality, deletion, and cost | WS-QA | All P13 implementation | G12 assistant evidence |

### 22.3 Exit Criteria

- The assistant retrieves only current actor-authorized data.
- Garden facts and general guidance are distinguishable.
- Free-form text cannot execute commands.
- Core recommendations remain available without the assistant or Vertex AI.
- Russian and English evaluations meet approved quality and safety thresholds.
- G12 is approved for the selected tasks only.

### 22.4 Source Traceability

Assistant scope and safety boundaries are specified in the recommendation and product designs. [Source: architecture/recommendations-and-ai.md, sections "12. Conversational Assistant", "13. Safety Tiers", "15. Privacy", and "16. Evaluation and Release"; technical-specification.md, section "FR-28: Conversational Assistance"]

## 23. Phase 14 — 3D Garden and Time Machine

### 23.1 Outcome

The product derives a selectable 3D representation and illustrative time-based views from the same accepted garden objects used by 2D, without introducing a duplicate garden model or claiming exact growth prediction.

### 23.2 Research Gate

Approve concrete user problems, rendering technology, supported devices/browsers, performance budgets, visual language, height/volume data requirements, seasonal content sources, accessibility fallback, and validation metrics. If a simpler 2D seasonal overlay solves the validated problem, do not proceed to full 3D.

### 23.3 Work Packages

| ID | Work package | Primary | Dependencies | Completion evidence |
|---|---|---|---|---|
| P14-PROD-01 | Validate planning and inspection jobs that require 3D or temporal visualization | WS-PROD, WS-DESIGN | Research Gate | Research report with proceed/stop decision |
| P14-ADR-01 | Select rendering stacks and asset format through an ADR after native/web capability, licensing, accessibility, and performance evaluation | WS-IOS, WS-WEB, WS-MAP | P14-PROD-01 | Accepted ADR |
| P14-DATA-01 | Extend accepted objects with optional height, volume, canopy, lifecycle, and visualization parameters without changing 2D identity | WS-DATA, WS-MAP | P14-ADR-01 | Migration and round-trip tests |
| P14-PROJ-01 | Implement deterministic 2D-to-3D scene projection, simplified assets, level of detail, picking, and shared object navigation | WS-MAP | P14-DATA-01 | Same object opens from 2D and 3D |
| P14-IOS-01 | Implement native 3D viewer with device budgets, graceful fallback, and accessibility-compatible object controls | WS-IOS | P14-PROJ-01 | Device performance matrix |
| P14-WEB-01 | Implement web 3D viewer with browser budgets, fallback, and accessible structured object navigation | WS-WEB | P14-PROJ-01 | Browser performance matrix |
| P14-TIME-01 | Implement versioned illustrative seasonal/growth states with ranges, assumptions, source metadata, and clear non-prediction language | WS-GUIDE, WS-MAP | P14-PROJ-01 | Content review and uncertainty tests |
| P14-AR-01 | Evaluate optional AR visualization only after 3D value and AR capability evidence; reuse accepted object identity and transforms | WS-IOS | P14-IOS-01, P11 AR | Separate proceed/stop gate |
| P14-QA-01 | Test identity consistency, geometry alignment, lifecycle states, unsupported data, visual accessibility, performance, and misleading-precision risk | WS-QA | All enabled P14 work | G12 3D/Time evidence |

### 23.4 Exit Criteria

- 2D and 3D select the same domain objects and open the same records.
- 3D does not become an independent editing or storage authority.
- Missing height/growth facts remain visibly approximate.
- Time Machine is presented as illustration, not exact prediction.
- Each supported platform meets its approved performance and accessibility fallback.
- G12 is approved independently for 3D, Time Machine, and any AR visualization.

### 23.5 Source Traceability

The same-data requirement and non-prediction boundary are explicit product requirements. [Source: technical-specification.md, sections "FR-29: 3D Garden View" and "FR-30: Time Machine"; architecture/decisions/ADR-0005-dual-space-geospatial-model.md, section "Decision"]

## 24. Continuous Work Across All Phases

### 24.1 Security and Privacy

- Update the threat model whenever a phase adds a trust boundary, provider, sensitive data flow, parser, expensive endpoint, or administrative action.
- Add cross-garden denial tests for every new resource.
- Keep credentials in Secret Manager or platform credential stores; never introduce long-lived cloud keys.
- Review permission prompts, analytics consent, retention, export, deletion, provider training terms, and log redaction in the same change as the capability.
- Rehearse incident response for the new failure class before broad release.

[Source: architecture/security-and-privacy.md, sections "4. Trust Boundaries", "6. Authorization Controls", "18. Privacy Controls", "23. Vulnerability Management", and "25. Threat-Model Review Areas"]

### 24.2 Quality Engineering

- Add unit tests for policies and state transitions.
- Use real PostgreSQL/PostGIS for persistence and migration behavior.
- Compile generated Swift and TypeScript clients against OpenAPI.
- Extend language-neutral geometry, sync, provider, and recommendation fixtures.
- Inject failures at every durable boundary.
- Add accessibility, localization, performance, security, resilience, and E2E evidence proportional to the change.
- Treat flaky security, synchronization, migration, and release tests as blocking defects.

[Source: architecture/testing-strategy.md, sections "2. Principles", "4. Shared Test Assets", "6. Backend Integration Tests", "11. Offline Synchronization Tests", "16. Security Tests", and "23. Flaky-Test Policy"]

### 24.3 Observability and Operations

- Propagate trace and correlation context through API, outbox, Tasks, Pub/Sub, Jobs, Workflows, and providers.
- Add metrics, dashboards, SLO impact, alert conditions, cost labels, runbooks, and ownership before release.
- Keep raw media, prompts, notes, precise location, geometry, signed URLs, tokens, and secrets out of ordinary telemetry.
- Separate durable audit from sampled diagnostics and consented product analytics.

[Source: architecture/observability-and-analytics.md, sections "4. Correlation", "6. Prohibited Telemetry", "13. Dashboards", "16. Audit Versus Diagnostic Logs", and "18. Runbooks"]

### 24.4 Documentation and Architecture Governance

- Update requirements, detailed design, API examples, data dictionaries, runbooks, ADRs, provider decisions, and user-facing behavior with the implementation.
- Create an ADR before replacing an approved critical dependency, extracting a service, adding a second data authority, introducing vector search, or selecting critical reconstruction/3D technology.
- Keep source code files at or below 600 lines and split responsibilities before exceeding the limit.
- Keep all file content in English and all user-facing collaboration explanations in Russian.

[Source: AGENTS.md; architecture/README.md, section "8. Change Process"; architecture/backend-modular-monolith.md, section "23. Extraction Criteria"]

## 25. Foundation Surface Matrix

This matrix is the proposed Phase 0 baseline. It must be approved before feature implementation.

| Capability | iPhone/iPad | Web | Foundation behavior |
|---|---|---|---|
| Authentication and account settings | Required | Required | Apple, Google, email magic link as applicable; secure platform-specific sessions |
| Garden list and settings | Required | Required | Same authoritative gardens |
| Blank 2D garden | Required | Required | Full manual editor |
| Geographic context | Required | Required | MapKit on native; MapLibre/provider on web |
| Property-plan import | Required | Required | Image/PDF, calibration, tracing, background controls |
| Plants and groups | Required | Required | Add, edit, place, lifecycle, history |
| Observations and photos | Required | Required | Direct/recoverable media upload |
| Manual tasks | Required | Required | Full lifecycle and consolidated view |
| Today and recommendations | Required | Required | Evidence, uncertainty, feedback, history |
| Offline authoritative work | Required | Not in foundation | Native GRDB/outbox; web is online-first with selected drafts |
| Push notifications | Required | Not required | Web receives durable in-app inbox; browser push requires later decision |
| Export and deletion | Required | Required | Web may be preferred for large export; both expose status |
| AR, depth, and LiDAR capture | Post-foundation; capable devices only | View results only | Manual fallback remains available |
| Guided Garden Scan | Future | Review results where useful | Separate quality/cost/privacy gate |

The native and web roles, online-first web behavior, and device-specific limitations follow the detailed client designs. [Source: architecture/ios-application-design.md, sections "7. Local Persistence", "8. Synchronization Integration", and "12. Capture Architecture"; architecture/web-application-design.md, sections "2. Product Role", "9. Online-First Behavior", and "21. Completion Criteria"]

## 26. Functional Requirements Traceability

| Requirement | Primary phases | Principal implementation evidence |
|---|---|---|
| FR-1 Authentication and Onboarding | P0, P2 | Provider/session matrix, profile provisioning, onboarding E2E |
| FR-2 Garden Management | P2, P8 | Garden lifecycle, revisions, archive/delete tests |
| FR-3 Today View | P7 | Prioritization, action controls, reason, history, analytics |
| FR-4 Garden Map Fundamentals | P3 | Cross-platform editor and command fixtures |
| FR-5 Geometry Types | P0, P3 | Canonical geometry schema and round-trip tests |
| FR-6 Map Layers | P3 | Visibility, lock, order, and accessibility tests |
| FR-7 Structural Map Objects | P3 | Required-object E2E garden |
| FR-8 Garden and Plant Map Objects | P3, P4 | Bed/area/plant/group placement tests |
| FR-9 Progressive Map Creation | P3, P6, P10–P12 | Blank, imagery, plan, manual, capture, proposal paths |
| FR-10 Satellite or Map-Image Start | P0, P3 | Provider/license decision, attribution, tracing, outage fallback |
| FR-11 Property Plan Import | P6, P10 | Import, calibration, tracing, optional proposal tests |
| FR-12 Manual Map Editing | P3 | Creation/edit/dimensions/unknown-scale/undo tests |
| FR-13 On-Site AR Marking | P11 | Device benchmark and real-world marking tests |
| FR-14 AR-to-Map Alignment | P11 | Control-point, residual, relocalization, realignment tests |
| FR-15 GPS and Geographic Positioning | P3, P11 | Optional location context and precision-warning tests |
| FR-16 Guided Garden Scan | P10, P12 | Capture/pipeline/proposal/evaluation evidence |
| FR-17 Plot Area Estimate | P3 | Scaled/approximate area and uncertainty tests |
| FR-18 Map Provenance and Accuracy | P3, P6, P10–P12 | Provenance, accuracy state, verification, revision fixtures |
| FR-19 Plant Records | P4, P6 | Plant details, photos, placement, lifecycle, history |
| FR-20 Plant Addition | P4, P6 | Manual, unknown, individual/group, editable photo candidate |
| FR-21 Plant Lifecycle and Seasonal Planning | P4, P9 | Lifecycle transitions and reviewed seasonal fixtures |
| FR-22 Garden Context | P7, P9 | Weather/context freshness, source, quality, recommendation use |
| FR-23 Monitoring and Observations | P4, P6, P10 | Append history, media, uncertain analysis suggestions |
| FR-24 Recommendations | P7 | Rule/evidence/priority/feedback/safety/model fallback suite |
| FR-25 Work Planner | P4, P7, P9 | Manual/suggested/assigned/recurring work lifecycle |
| FR-26 Notifications | P7 | Inbox, FCM, preference, quiet-hour, deduplication tests |
| FR-27 Shared Garden Care | P9 | Role/invitation/assignment/attribution/sync tests |
| FR-28 Conversational Assistance | P13 | Authorized retrieval, confirmation, safety, bilingual evaluation |
| FR-29 3D Garden View | P14 | Same-object projection and platform performance tests |
| FR-30 Time Machine | P14 | Illustrative ranges, sources, uncertainty, non-prediction copy |
| FR-31 Offline Use and Synchronization | P1–P5 | Atomic outbox, push/pull, conflicts, revocation, fault injection |
| FR-32 Import, Export, and Data Ownership | P6, P8 | Private export, retention, garden/account deletion verification |
| FR-33 Web Application | P1–P9, P13–P14 | Web surface matrix, accessibility, online-first continuity, E2E |

Requirements are defined in [technical-specification.md](technical-specification.md), section "9. Functional Requirements". A release cannot close a requirement by completing only server or UI code; it must produce the evidence in this table.

## 27. Forecast Model

### 27.1 Important Limitation

The source documentation contains no staffing, funding, velocity, procurement lead time, design readiness, or committed launch date. The following ranges are planning hypotheses under Assumptions A-1 and A-2, not promises.

### 27.2 Indicative Phase Ranges

| Phase | Indicative elapsed range | Main uncertainty | Parallelism note |
|---|---:|---|---|
| P0 Product closure | 2–4 weeks | Decision and research access | Must start first |
| P1 Engineering foundation | 4–6 weeks | Cloud organization and CI access | Client/platform scaffolds parallelize |
| P2 First garden | 4–6 weeks | Firebase/provider setup and UX | Native/web parallelize after API contract |
| P3 2D map | 8–12 weeks | Editor UX, geometry semantics, performance | Native/web parallelize around shared fixtures |
| P4 Care records | 6–8 weeks | Domain scope and UX | Can overlap late P3 |
| P5 Offline synchronization | 8–12 weeks | Conflict UX, failure testing, migrations | Backend/native parallelize after protocol |
| P6 Media and plan import | 8–12 weeks | resumable transfer, PDF security, calibration | Workers and clients parallelize |
| P7 Care loop | 8–12 weeks | horticultural rules, providers, safety review | Today, integrations, notifications parallelize |
| P8 Beta and GA hardening | 6–10 weeks | legal, security, restore/load results, store review | Begins incrementally before P7 ends |
| P9 Collaboration/seasonal | 8–12 weeks | conflict behavior and content breadth | Two substreams can separate |
| P10 Assisted capture | 10–16 weeks | dataset, model quality, device/media variability | Research begins before production build |
| P11 AR/LiDAR | 10–16 weeks | outdoor accuracy and device diversity | Can overlap P10 research |
| P12 Garden Scan | 16–28+ weeks | reconstruction feasibility and unit cost | Research-gated; may stop |
| P13 Assistant | 8–12 weeks | safety scope and evaluation quality | Independent after structured data stabilizes |
| P14 3D/Time Machine | 12–20+ weeks | validated value, rendering choice, content model | Research-gated; may split into releases |

Under the reference team, a realistic foundation planning envelope is approximately 9–12 months because P3/P4 and several platform/client activities overlap while P5 remains on the critical path. Advanced product completion should not receive one combined date; P9–P14 are independent investment decisions and may be reordered, reduced, or stopped after evidence gates.

### 27.3 Reforecast Rules

Reforecast after:

- Named staffing and availability are known.
- Phase 0 decisions and provider lead times are approved.
- G2 reveals actual multi-client vertical-slice throughput.
- G3 establishes measured map-editor complexity.
- G5 establishes synchronization defect and test volume.
- Beta supplies quality, support, cost, and store-review evidence.
- Any advanced capability passes or fails its research gate.

## 28. Proposed First Twelve Increments

This is a dependency-aware starting sequence, not a fixed sprint commitment.

| Increment | Primary outcome | Demonstration |
|---:|---|---|
| 1 | Product decisions, domain glossary, launch surface matrix, repo skeleton | Approved G0 package and all shells building locally |
| 2 | CI/CD, OpenAPI/error baseline, PostGIS migration, dev cloud shell | One traced health/API request deployed keylessly |
| 3 | Firebase native/web authentication and profile provisioning | Same user signs in on native and web |
| 4 | Garden create/list/open with revisions and authorization | G2 first-garden vertical slice |
| 5 | Coordinate spaces, garden object schema, shared geometry fixtures | Same fixtures pass in backend, Swift, TypeScript |
| 6 | Basic point/line/polygon editor on web and native | Lot, house, fence, and bed created and reopened |
| 7 | Full required object tools, layers, undo/redo, scale/provenance | G3 representative garden |
| 8 | Plants/groups, placement, observations, and history | Plant selected from map opens shared record |
| 9 | Manual tasks, lifecycle, localization, accessibility, care analytics | G4 care-data workflow |
| 10 | Sync push/pull, local outbox, initial snapshot | Offline create survives restart and syncs |
| 11 | Conflicts, tombstones, revocation, full resync, upgrades | G5 fault-injected convergence |
| 12 | Direct photo upload and verification foundation | Interrupted upload resumes without duplicate record |

Later increments continue P6 plan import, P7 care loop, and P8 hardening. Every increment must end in a demonstrable integrated state; incomplete hidden layers do not count as completed product outcomes.

## 29. Decision Register

### 29.1 Decisions Required Before G0

| Decision | Why it matters | Source status | Proposal | Owner | Deadline |
|---|---|---|---|---|---|
| First-release segment | Determines onboarding, content, fixtures, research cohort | Open | Select one primary segment and 2–3 garden archetypes | WS-PROD | Before P1 |
| Guest onboarding | Changes local data ownership and account migration | Open | Prefer a disposable pre-auth demo unless research proves guest-created durable data is necessary | WS-PROD, WS-SEC | Before P2 schema |
| Foundation domain scope | Prevents uncontrolled object/lifecycle/rule breadth | Open | Freeze minimum types; keep extensible custom labels | WS-PROD | Before P3/P4 |
| Foundation surface parity | Determines parallel client scope | Open in product spec | Approve Section 25 | WS-PROD | Before P1 backlog |
| Supported platform versions | Controls frameworks and test matrix | Implementation-time | Use current public major plus supported predecessor where capability permits | WS-IOS, WS-WEB | Before scaffold |
| Browser offline scope | Avoids accidental second sync protocol | Product question; architecture is online-first | No full offline web in foundation; preserve selected drafts only | WS-PROD, WS-WEB | Before web state design |
| Providers | Affects licensing, privacy, quality, cost, and UX | Implementation-time | Score capability-specific adapters; one active provider per environment | WS-PROD, WS-BE, WS-SEC | Before dependent phase |
| Safety exclusions | Controls recommendation and assistant release | Open | Exclude restricted tiers until reviewed policy exists | WS-GUIDE, WS-SEC | Before P7 rules |

### 29.2 Decisions Required Before Foundation GA

| Decision | Proposal | Evidence required |
|---|---|---|
| Exact SLOs and performance budgets | Set from staging load and beta device data | P3/P5/P6/P7 performance and load reports |
| Quotas and cost guardrails | Protect core access; constrain optional expensive work first | Cost per active garden, upload, sync operation, provider call |
| Retention schedule and legal exceptions | Keep documented baseline unless US legal/privacy review requires change | Data inventory, provider terms, backup behavior |
| App Check/CSP/Cloud Armor enforcement | Observe first; enforce validated paths with rollback | Compatibility and false-positive telemetry |
| Supported browser/device matrix | Publish tested release lines and capability tiers | Automated matrix plus real-device field results |
| Recommendation launch catalog | Release only reviewed rules with evidence and fallback | Horticultural/safety review and beta outcomes |
| Analytics consent behavior | Apply current US requirements while retaining privacy-minimized schema | Legal review and consent on/off tests |

## 30. Gaps and Proposals

| Gap | Evidence | Impact | Priority | Proposal |
|---|---|---|---:|---|
| No committed foundation scope | Priorities are explicitly proposed. [Source: technical-specification.md, section "6. Proposed Product Priorities"] | Schedule and acceptance can drift | Critical | Approve included/deferred/excluded scope in G0 |
| No staffing or ownership | Not stated in source | Forecast cannot become a commitment | Critical | Assign workstream owners and capacity in P0-DEL-01 |
| No product/design artifacts | Repository currently contains documentation only | Implementation may encode unvalidated flows | High | Prototype and test core journeys before P2/P3 |
| Guest lifecycle unresolved | Guest behavior is open while native architecture permits a disposable pre-auth store. [Source: technical-specification.md, section "FR-1: Authentication and Onboarding"; architecture/ios-application-design.md, section "7. Local Persistence"] | Data loss or complex migration risk | High | Decide durable versus disposable behavior before schema work |
| Recoverable web draft scope is not selected | Product requirements retain this implementation question while the web architecture is online-first. [Source: technical-specification.md, sections "FR-33: Web Application" and "18. Open Product Questions"; architecture/web-application-design.md, section "9. Online-First Behavior"] | Unsaved work may be lost or scope may expand informally | High | Select map/form drafts and expiry behavior in Phase 0 without adding full web sync |
| Numeric quality thresholds absent | Versions, tolerances, quotas, budgets, SLOs, alerts remain implementation-time selections. [Source: technical-specification.md, section "14.2 Implementation-Time Selections"] | Gates cannot be objectively passed | High | Define initial hypotheses in P0 and calibrate before GA |
| Provider contracts absent | Commercial providers are not selected. [Source: architecture/README.md, section "7. Remaining Implementation-Time Selections"] | Licensing, privacy, coverage, and cost uncertainty | High | Run provider scorecards before dependent implementation |
| Horticultural governance not defined | Safety-sensitive recommendations require expert review. [Source: technical-specification.md, section "FR-24: Recommendations"] | Unsafe or low-trust guidance | Critical | Name reviewers, sources, versioning, review cadence, escalation |
| Capture evaluation dataset absent | Capture design requires a representative consented dataset. [Source: architecture/garden-capture-and-scan.md, section "20. Evaluation"] | AR/scan quality cannot be proven | High for advanced scope | Build dataset governance before P10/P11/P12 commitment |
| Support organization not defined | Runbooks are required, but people and rotation are not stated | Incidents cannot be owned | High before beta | Define severity, on-call/support responsibility, escalation, hours |
| Monetization is open | Monetization is an explicit product question. [Source: technical-specification.md, section "18. Open Product Questions"] | Quotas and expensive-feature economics may change | Medium | Decide before broad Scan/AI rollout; do not block foundation core loop |

## 31. Contradictions and Tensions

No direct contradiction remains between the approved architecture documents after Draft 0.6 synchronization. The following product-to-implementation tensions still require explicit handling.

### 31.1 Web Recoverable Draft Scope

- **Source tension:** The approved web design is online-first, while the exact map/form drafts that survive browser restart are not selected. [Source: technical-specification.md, sections "FR-33: Web Application" and "18. Open Product Questions"; architecture/web-application-design.md, section "9. Online-First Behavior"]
- **Resolution used by this plan:** Foundation web uses explicit disconnected state and only Phase 0-approved recoverable drafts. A full web sync engine requires a future ADR and product decision.
- **Confidence:** High.

### 31.2 Proposed Product Priority Versus Approved Architecture

- **Source tension:** Architecture is approved, but the product priority sequence is still described as proposed. [Source: technical-specification.md, sections "6. Proposed Product Priorities" and "14.1 Approved Baseline"]
- **Resolution used by this plan:** Architecture choices constrain implementation, while G0 still approves which product capabilities form the first release.
- **Confidence:** High.

### 31.3 Guest Storage Versus Guest Product Behavior

- **Source tension:** Native design reserves a disposable pre-authentication store, but the product has not decided whether guests can create durable data or migrate it. [Source: architecture/ios-application-design.md, section "7. Local Persistence"; technical-specification.md, section "FR-1: Authentication and Onboarding"]
- **Resolution used by this plan:** Do not implement durable guest garden migration until P0 explicitly approves it.
- **Confidence:** High.

## 32. Risk Register

| Risk | Evidence | Severity | Confidence | Early indicator | Mitigation and decision |
|---|---|---:|---:|---|---|
| Scope overload | Product risk explicitly identifies too many categories. [Source: technical-specification.md, section "17. Major Risks"] | Critical | High | Increasing parallel unfinished epics | Foundation scope lock, feature flags, research gates, independent advanced releases |
| Map setup takes too much effort | Initial map effort is a documented risk. [Source: technical-specification.md, section "17. Major Risks"] | Critical | High | High time-to-first-area or abandonment | Prototype first, manual primitives, blank/imagery/plan choices, measure correction effort |
| Users mistake estimates for exact dimensions | Accuracy misuse is an explicit product risk and safety constraint. [Source: technical-specification.md, sections "13. Accuracy and Safety Policy" and "17. Major Risks"] | Critical | High | Support questions or unsafe use | Persistent provenance/uncertainty, non-survey copy, no false precision, safety testing |
| Map semantics diverge across clients | Mobile/web parity and multi-source consistency are documented risks. [Source: technical-specification.md, section "17. Major Risks"] | High | High | Same command produces different geometry | Shared fixtures, canonical commands, generated contracts, semantic CI gate |
| Offline sync silently loses work | Sync is classified as a critical system. [Source: architecture/testing-strategy.md, section "2. Principles"] | Critical | High | Unrecoverable conflicts or unknown outcomes | Durable outbox, stable operation IDs, fault injection, recovery UI, no universal LWW |
| Mobile release lag blocks schema/API change | The delivery design requires a supported compatibility window. [Source: architecture/environments-and-delivery.md, section "13. Mobile Compatibility"] | High | High | Forced upgrades or stuck outbox | Additive/versioned contracts, expand/contract migrations, protocol distribution telemetry |
| Media parser or signed URL compromise | Sensitive content and parser threats are explicit. [Source: architecture/security-and-privacy.md, sections "12. Cloud Storage Security" and "16. Untrusted Content Processing"] | Critical | High | Unexpected egress, type confusion, URL leakage | Constrained workers, signature/type checks, short-lived access, redaction and attack fixtures |
| Provider licensing prevents imagery/plan behavior | Provider terms and caching remain implementation-time selections. [Source: architecture/external-integrations.md, sections "3. Adapter Contract" and "6. Basemap and Imagery"] | High | Medium | Required use violates terms or cost | Provider scorecard, adapter boundary, attribution, replaceability, no provider IDs as domain keys |
| Recommendation causes unsafe action | Safety-sensitive treatment requires review. [Source: technical-specification.md, section "FR-24: Recommendations"] | Critical | High | Unsupported high-risk output | Rules-first, safety tiers, expert review, deterministic fallback, model output validation |
| Low-value notifications cause disengagement | Repetition is a documented product risk. [Source: technical-specification.md, section "17. Major Risks"] | High | High | Disablement/dismissal rate rises | Durable intent, preference/freshness checks, dedupe, quiet hours, value metrics |
| Outdoor AR error is unacceptable | Outdoor AR error is a documented product risk. [Source: technical-specification.md, section "17. Major Risks"] | High | High | Error/correction exceeds use-case threshold | Device/use-case benchmark, segmented capture, realignment, disclaimers, stop gate |
| Garden Scan cost exceeds value | Scan has explicit cost controls but no measured unit economics. [Source: architecture/garden-capture-and-scan.md, section "19. Cost Controls"] | High | Medium | Cost per useful proposal or failure rate rises | Early rejection, CPU-first, quotas, checkpoints, explicit confirmation, cohort rollout |
| Cross-garden data exposure | Preventing cross-garden access is a core security objective. [Source: architecture/security-and-privacy.md, section "2. Security Objectives"] | Critical | High | Any authorization test or incident fails | Central capabilities, negative matrix per resource, current membership check, audited response |
| Deletion is incomplete across systems | Deletion spans identity, database, media, jobs, caches, and providers. [Source: architecture/data-export-and-deletion.md, section "11. Account Deletion"] | Critical | High | Residual objects after deadline | Idempotent workflow, reconciliation, completion evidence, restore reapplies deletion |
| Cloud SQL exhausted by serverless scaling | Serverless connection pressure is an explicit architecture concern. [Source: architecture/networking.md, section "11. Connection Pooling"] | High | High | Pool saturation or acquisition latency | Max instances × pool budget, load tests, backpressure, measured scaling sequence |
| Observability leaks garden content | Telemetry prohibitions explicitly include precise location, geometry, plans, media, notes, and prompts. [Source: architecture/observability-and-analytics.md, section "6. Prohibited Telemetry"] | Critical | High | Sensitive field appears in logs/traces | Schema allowlist/redaction, malicious log tests, privacy review, access separation |

## 33. Definition of Ready

A work package is ready only when:

- Its user or operational outcome is clear.
- Required product decisions and dependencies are complete.
- API, data, event, geometry, or provider contract changes are identified.
- Authorization capability and data classification are stated.
- Offline, retry, idempotency, revision, deletion, and failure behavior are stated where relevant.
- Accessibility, localization, analytics consent, telemetry, and support impact are identified.
- Acceptance examples and required test layers are written.
- Provider license/privacy/cost constraints are understood.
- Documentation files to update are listed.

## 34. Definition of Done

A work package is done only when:

1. The intended end-to-end outcome works on every in-scope surface.
2. Domain behavior is separated from framework/provider details according to the detailed design.
3. Migrations are reviewed, tested from supported prior states, and compatible with deployed clients/services.
4. API and message contracts are versioned, linted, compatible, and compiled by affected clients.
5. Authorization, cross-garden denial, idempotency, concurrency, offline/retry, deletion, and failure tests pass where applicable.
6. Accessibility, localization, performance, privacy, security, and cost acceptance pass for the risk level.
7. Logs, metrics, traces, dashboards, alerts, audit events, and runbooks are added without prohibited content.
8. Feature flags, rollout, rollback, support, and migration behavior are documented.
9. Source code follows clean-code boundaries and every source file remains at or below 600 lines.
10. All affected documentation under `docs/` is accurate, complete, English, linked, and changed in the same work.
11. No unresolved critical or high-severity defect is silently deferred; any accepted exception has owner, reason, expiry, and approval.
12. Release evidence is attached to the applicable gate.

[Source: AGENTS.md; architecture/environments-and-delivery.md, section "18. Release Verification"; architecture/testing-strategy.md, section "22. CI Gates"]

## 35. Delivery Governance

### 35.1 Review Cadence

- Weekly: dependency, risk, scope, provider, cost, and research review during active development.
- Every increment: integrated demonstration, quality trend, documentation audit, and backlog reordering.
- Before each gate: evidence review by product, engineering, QA, security/privacy, design/accessibility, and relevant domain experts.
- Monthly in production: cost, reliability, security, privacy, retention, provider, and product-quality review.
- Quarterly before material scale: database restore and access/IAM review; regional-recovery tabletop according to operational risk.

The cost and restore cadences are based on the detailed operational designs. [Source: architecture/cost-and-scaling.md, section "20. Cost Review Cadence"; architecture/reliability-and-disaster-recovery.md, sections "8. Restore Testing" and "19. Exercises"]

### 35.2 Scope Change

Any scope addition must state:

- Which release outcome it improves.
- Which phase and workstream own it.
- What it displaces or whether capacity increases.
- New contracts, data, provider, security, privacy, support, and cost consequences.
- New or changed acceptance evidence.
- Whether an ADR or requirements update is required.

### 35.3 Stop Conditions

Pause or stop a capability when:

- It cannot meet a safety, privacy, authorization, or deletion requirement.
- It creates silent data loss or irreconcilable accepted-state ambiguity.
- Its measured user correction effort is not better than the manual fallback.
- Its provider terms conflict with documented ownership, retention, or training policy.
- Its unit cost cannot be bounded without harming core garden access.
- It lacks a testable user outcome or duplicates another representation of garden meaning.

## 36. Immediate Next Actions

1. Approve or revise the foundation outcome and Section 25 surface matrix.
2. Assign owners and capacity to the workstreams in Section 6.
3. Resolve all G0 decisions in Section 29.1.
4. Run the core journey prototypes and user research in P0-DESIGN-01.
5. Create the provider scorecards and legal/privacy data inventory.
6. Convert P1 and P2 work packages into repository issues with dependencies and acceptance evidence.
7. Start the monorepo, contract, database, CI/CD, and cloud-environment foundation only after version and access prerequisites are recorded.
8. Reforecast after G2 using actual throughput and defect evidence.

## 37. Plan Maintenance

- Update this plan when a phase, dependency, gate, release surface, or major estimate changes.
- Link implemented work and release evidence from the relevant work package or tracking system.
- Move completed work to an execution record rather than deleting historical intent without explanation.
- Update product requirements, architecture, ADRs, and this plan together when their shared assumptions change.
- Increase the plan version and last-updated date for material revisions.

## Appendix A — Architecture Source Coverage

### A.1 Detailed Designs

| Source | Primary plan coverage |
|---|---|
| [Architecture index](architecture/README.md) | P0–P14, governance |
| [Native Apple application](architecture/ios-application-design.md) | P1–P7, P9–P14 |
| [Web application](architecture/web-application-design.md) | P1–P9, P10 review, P13–P14 |
| [Map rendering and editing](architecture/map-rendering-and-editing.md) | P0, P3, P6, P10–P14 |
| [Backend modular monolith](architecture/backend-modular-monolith.md) | P1–P14 |
| [REST API and contracts](architecture/api-design.md) | P1–P13 |
| [Data and geospatial model](architecture/data-and-geospatial-design.md) | P1–P14 |
| [Offline synchronization](architecture/offline-synchronization.md) | P1–P6, P9, P10–P12 |
| [Identity and authorization](architecture/identity-and-authorization.md) | P0–P2, P8–P9, P13 |
| [Media storage and processing](architecture/media-storage-and-processing.md) | P6, P8, P10–P12 |
| [Garden capture and scan](architecture/garden-capture-and-scan.md) | P0, P6, P10–P12 |
| [Asynchronous processing](architecture/asynchronous-processing.md) | P1, P6–P8, P10–P13 |
| [Recommendations and AI](architecture/recommendations-and-ai.md) | P7, P9, P13–P14 |
| [External integrations](architecture/external-integrations.md) | P0, P3, P6–P7, P13 |
| [Notifications](architecture/notifications.md) | P7–P9 |
| [Security and privacy](architecture/security-and-privacy.md) | Every phase; G0–G12 |
| [Networking](architecture/networking.md) | P1, P8, continuous operations |
| [Observability and analytics](architecture/observability-and-analytics.md) | Every phase; release gates |
| [Environments and delivery](architecture/environments-and-delivery.md) | P1, P8, every release |
| [Reliability and disaster recovery](architecture/reliability-and-disaster-recovery.md) | P1, P5–P8, production operations |
| [Testing strategy](architecture/testing-strategy.md) | Every phase; every gate |
| [Cost and scaling](architecture/cost-and-scaling.md) | P0–P1, P6–P8, P10–P14 |
| [Data export and deletion](architecture/data-export-and-deletion.md) | P2 foundations, P8 completion, P9 collaboration |

### A.2 Architecture Decisions

| Source | Implementation consequence |
|---|---|
| [ADR-0001](architecture/decisions/ADR-0001-monorepo-and-client-separation.md) | P1 creates one repository with separate native and web clients |
| [ADR-0002](architecture/decisions/ADR-0002-firebase-google-cloud-and-postgresql.md) | P1–P2 establish Firebase/GCP with PostgreSQL/PostGIS authority |
| [ADR-0003](architecture/decisions/ADR-0003-modular-monolith-and-rest-api.md) | P1 creates Fastify modules and REST/OpenAPI contracts |
| [ADR-0004](architecture/decisions/ADR-0004-application-owned-offline-sync.md) | P5 implements GRDB and application-owned sync |
| [ADR-0005](architecture/decisions/ADR-0005-dual-space-geospatial-model.md) | P3 implements local planar geometry and optional WGS84 georeference |
| [ADR-0006](architecture/decisions/ADR-0006-google-cloud-asynchronous-primitives.md) | P6 onward uses outbox, Tasks, Pub/Sub, Jobs, and justified Workflows |
| [ADR-0007](architecture/decisions/ADR-0007-us-central1-production-baseline.md) | P1/P8 deploy the United States regional baseline |
| [ADR-0008](architecture/decisions/ADR-0008-rules-first-recommendations-and-vertex-ai.md) | P7 builds deterministic recommendations before optional AI explanations |
