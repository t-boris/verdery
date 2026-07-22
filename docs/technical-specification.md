# Grow Garden Technical Specification

> Status: Draft 0.6  
> Document type: Product and functional requirements specification  
> Last updated: July 22, 2026  
> Architecture status: Approved high-level and detailed baseline; see [high-level-architecture.md](high-level-architecture.md) and [architecture/README.md](architecture/README.md)

## 1. Document Purpose

This document is the single source of truth for the current Grow Garden product definition and requirements. It consolidates the application description, garden-mapping proposal, product priorities, functional requirements, constraints, risks, and unresolved questions.

This document defines what the product must accomplish. The approved system structure, technology categories, cloud platform, storage systems, and deployment model are defined separately in [high-level-architecture.md](high-level-architecture.md).

The proposed product-wide delivery sequence, work packages, dependencies, release gates, and requirements traceability are defined in [implementation-plan.md](implementation-plan.md).

References in this document to platform capabilities or third-party products are research context unless the high-level architecture or a later architecture decision explicitly selects them.

### 1.1 Requirement Language

The terms in this document have the following meanings:

- **Must** indicates a required product behavior.
- **Should** indicates a strongly preferred behavior that may be revised after validation.
- **May** indicates an optional or future behavior.
- **Proposed** indicates a recommendation that has not yet been approved as committed scope.
- **Future** indicates a capability that must not block the initial release.

## 2. Product Definition

Grow Garden is a cross-device product with mobile applications and a web application for people who maintain an outdoor garden, vegetable plot, yard, orchard, greenhouse, or other planted space.

The application creates a progressively refined digital representation of a real garden, records what grows there and where, tracks observations and work, and helps the user understand what requires attention now.

The central product promise is:

> Grow Garden knows what grows where, considers current conditions and care history, and explains what the user should do in the garden today.

The garden map, plant records, weather context, observations, recommendations, and task planner must contribute to one continuous care loop:

```text
Garden context
      ↓
Prioritized recommendation
      ↓
User action or dismissal
      ↓
New observation or result
      ↓
Improved future recommendation
```

## 3. Product Goals

Grow Garden should help users:

- Create a useful representation of a garden without measuring everything first.
- Progressively improve the garden map using plans, imagery, manual editing, and on-site capture.
- Identify plants and add them with minimal manual entry.
- Understand where plants, growing areas, buildings, fences, and paths are located.
- See a short, prioritized list of actions that matter today.
- Understand why each recommendation exists and how reliable it is.
- Detect changing plant-care needs and emerging problems.
- Plan recurring, seasonal, and one-time garden work.
- Track plant development, completed work, problems, and outcomes.
- Coordinate care with other people when a garden is shared.
- Review and manage a garden from a desktop or laptop when a larger workspace is more convenient.
- Explore future garden growth without presenting an illustration as an exact prediction.

## 4. Initial Target Users

The proposed initial audience is people managing an existing private outdoor garden, especially a mixed garden containing beds, fruit trees, shrubs, lawns, greenhouses, or ornamental areas.

Target users include:

- Home gardeners.
- Vegetable growers.
- Owners of primary or secondary residential plots.
- Beginners who need practical, contextual guidance.
- Experienced gardeners who want structured records and planning.
- Families or small groups sharing garden work.

Indoor-only plant care and professional agricultural operations are not the proposed initial focus.

## 5. Product Principles

### 5.1 Action Before Decoration

The application must prioritize useful daily actions over visually impressive but rarely used functionality.

### 5.2 Progressive Setup

Users must be able to start with incomplete or approximate information and improve it over time.

### 5.3 User Control

All recognized, imported, measured, estimated, or generated information must remain editable.

### 5.4 Transparent Uncertainty

The application must distinguish sketches, estimates, measurements, document-derived information, and user-verified information.

### 5.5 Shared Garden Context

The map, plant records, observations, recommendations, tasks, 3D representations, and future projections must refer to the same conceptual garden information without duplicate user entry.

### 5.6 Explainable Guidance

Recommendations must explain why an action is suggested, what evidence was used, how urgent it is, and what uncertainty exists.

### 5.7 Graceful Capability Tiers

Core garden management must remain usable when advanced camera, depth, AR, conversational, or network capabilities are unavailable.

### 5.8 Privacy by Design

The application must treat garden imagery, property plans, addresses, location, and video as sensitive user data.

## 6. Proposed Product Priorities

The following sequence is a proposal and requires validation before becoming a release commitment.

### 6.1 Foundation Scope

- Garden creation and management.
- Progressive 2D garden mapping.
- Satellite or map-image starting point when available.
- Property-plan image or PDF import with manual calibration and tracing.
- Manual garden-map editor.
- Web application for map editing, plan import, planning, history review, and garden administration.
- Structural, garden-area, and plant layers.
- Manual plant entry and photo-assisted plant identification.
- Plant records, observations, photos, and lifecycle status.
- Weather-aware garden context.
- A prioritized "Today" action list.
- Manual and suggested tasks.
- Recommendation explanations and user feedback.
- Offline capture for essential on-site actions.

### 6.2 Proposed Next Scope

- On-site AR line and area marking.
- LiDAR-enhanced capture on supported devices.
- Seasonal calendars, succession planting, and crop rotation.
- Shared garden access and task assignment.
- Better plan recognition and assisted vectorization.
- Context for soil, drainage, sunlight, irrigation, and microclimates.
- Data export and expanded synchronization.

### 6.3 Future Scope

- Guided Garden Scan with object suggestions.
- Automatic multi-zone scan merging.
- Full 3D garden view.
- AR garden overlays.
- Time Machine growth visualization.
- Contextual typed and voice assistance.
- Professional measurement-device integrations.

## 7. Core Domain Concepts

These concepts define product meaning only. They do not prescribe persistence models, schemas, services, or code structure.

### 7.1 User

A person who owns, manages, views, or contributes to one or more gardens.

### 7.2 Garden

The primary workspace representing one physical or conceptual growing location.

### 7.3 Garden Map

An editable, top-down semantic representation of the garden. It may be approximate, scaled, or geographically referenced.

### 7.4 Map Object

A semantic object placed on the garden map, such as a building, deck, fence, path, bed, lawn, tree, plant, or planting group.

### 7.5 Garden Area

A named map region that contains or groups plants and activities, such as a bed, greenhouse, orchard, lawn, or container area.

### 7.6 Plant Record

A record describing an individual plant, plant row, or plant group, including identity, location, lifecycle, observations, recommendations, and history.

### 7.7 Observation

A user-created or system-assisted record of garden or plant condition at a point in time.

### 7.8 Recommendation

A contextual suggestion that explains a proposed garden-care action and its urgency.

### 7.9 Task

A planned, suggested, completed, skipped, or dismissed unit of garden work.

### 7.10 Capture Source

The origin of map geometry or other information, such as manual entry, satellite imagery, an imported plan, AR, LiDAR, GPS, or an AI-assisted scan.

## 8. Primary User Journeys

### 8.1 First Useful Garden

1. The user opens the application.
2. The user may sign in or continue to a limited local setup if guest onboarding is approved.
3. The user creates or accepts an initial garden.
4. The user identifies the garden location or skips location entry.
5. The user starts from satellite imagery, a property plan, or a blank sketch.
6. The user marks at least one garden area.
7. The user adds one or more plants.
8. The application presents the first useful care information or action.

The proposed product target is to make this journey possible without requiring a complete or measured map.

### 8.2 Daily Care Loop

1. The user opens the "Today" view or follows a notification.
2. The application shows a small number of prioritized actions.
3. The user reviews the reason, urgency, and affected garden object.
4. The user completes, postpones, edits, or dismisses the action.
5. The user may add a photo or condition update.
6. The action and observation become part of garden history.

### 8.3 Progressive Map Improvement

1. The user opens the existing garden map.
2. The application identifies approximate or incomplete objects.
3. The user selects an object to improve.
4. The user edits it manually, traces it from a plan, or measures it on site.
5. The application stores the new geometry and its source.
6. The user reviews and confirms the change.

## 9. Functional Requirements

### FR-1: Authentication and Onboarding

- The application must support sign-in with Google and Apple accounts unless product validation changes this requirement.
- The application must not require a separate application-specific password.
- The application should minimize sign-in friction before the user sees product value.
- The final guest-mode and account-migration behavior remains undecided.
- Onboarding should collect only information required for immediate value.
- Location, experience level, garden type, preferred units, and goals may be collected progressively.

### FR-2: Garden Management

- A new user must be able to create or receive an initial garden.
- A user should be able to create multiple gardens.
- Each garden must have a name and may have a location.
- Each garden must contain its map, areas, plants, observations, recommendations, tasks, and history.
- The application must support archiving or deleting a garden subject to retention and recovery rules that remain to be defined.

### FR-3: Today View

- The main operational view should present a limited set of prioritized actions.
- Every suggested action must identify the relevant garden, area, or plant.
- Every suggested action must show urgency.
- Every suggested action should show an estimated effort or time when practical.
- Every suggested action must provide a reason.
- The user must be able to mark an action complete, postpone it, dismiss it, or report that it is not relevant.
- User feedback must be retained as product context for future recommendations.

### FR-4: Garden Map Fundamentals

- Every garden must support a 2D top-down map.
- The map must remain usable without exact dimensions.
- The map must support schematic, scaled, and geographically referenced states.
- The user must be able to create, select, move, rename, resize, reshape, rotate, duplicate, and remove supported objects.
- The editor must support undo and redo.
- The editor must support panning and zooming.
- The editor should support grid snapping, object snapping, dimension display, and layer locking.
- Selecting a plant on the map must open the same plant record used elsewhere.
- The map must not claim survey-grade or legal-boundary accuracy.

### FR-5: Geometry Types

The map must support the following conceptual geometries:

- **Point:** an individual plant, tree, marker, gate, or compact object.
- **Polyline:** a fence, wall, path centerline, planting row, or irrigation line.
- **Polygon:** a lot boundary, building, deck, lawn, bed, greenhouse, or planted area.
- **Polyline with width:** a path, hedge, or other linear area.
- **Point with radius:** a tree canopy, shrub, or approximate influence area.

Curves may be represented through editable control points. The map design requires a renderer-independent canonical approximation or curve representation; the exact encoding is selected during implementation and validated through shared fixtures.

### FR-6: Map Layers

The 2D editor must distinguish at least:

1. Background imagery.
2. Lot boundary.
3. Buildings and fixed structures.
4. Paths, fences, gates, and utilities.
5. Garden areas and planting zones.
6. Plants, rows, and plant groups.
7. Labels, measurements, and care overlays.

Users should be able to show, hide, and lock supported layers.

### FR-7: Structural Map Objects

The map should support:

- Lot boundaries.
- Houses and other buildings.
- Decks, verandas, patios, and terraces.
- Garages, sheds, and greenhouses.
- Fences that may run inside the lot rather than only along its boundary.
- Gates attached to fences.
- Paths and driveways.
- Ponds, fire-pit areas, compost areas, and custom structures.
- Areas where planting is not possible or not allowed.

### FR-8: Garden and Plant Map Objects

The map should support:

- Vegetable beds.
- Flower beds.
- Lawns.
- Orchards.
- Greenhouse beds.
- Container areas.
- Irrigation zones.
- Individual plants.
- Trees and shrubs.
- Planting rows.
- Dense or mixed planting areas.
- Custom user-defined areas.

The user must not be required to map every individual plant when a row or group is more appropriate.

### FR-9: Progressive Map Creation

- The product must offer more than one way to create a garden map.
- All creation methods must produce editable map objects.
- No advanced capture method may be required for core garden use.
- The proposed creation flow is:
  1. Find or describe the garden location.
  2. Start from satellite imagery, an imported property plan, or a blank canvas.
  3. Mark permanent structures.
  4. Mark garden areas.
  5. Add plants.
  6. Improve selected objects on site when useful.
  7. Review uncertainty and confirm the map.

### FR-10: Satellite or Map-Image Start

- The user should be able to search for or center on the garden location.
- The application should display available aerial or satellite imagery.
- The user should be able to trace lot boundaries and visible structures.
- The imagery must be treated as a visual reference, not an authoritative property survey.
- The application must tolerate imagery that is outdated, obscured, low resolution, or unavailable.
- MapLibre is the selected web geographic-context engine, MapKit supplies native Apple context, and the editable garden remains provider-independent. The initial commercial tile/imagery provider, licensing terms, and permitted caching require implementation-time review.

### FR-11: Property Plan Import

- The user should be able to photograph a paper property plan or import an image or PDF.
- The application should correct document perspective and orientation when possible.
- The user must be able to calibrate the plan by selecting a known dimension line and entering its value.
- The user must be able to trace objects over the plan.
- The user must be able to show or hide the plan background.
- Imported plans must remain editable because documents may be incomplete or outdated.
- Automatic text, dimension, symbol, and geometry recognition is proposed for a later phase.
- Automatically recognized plan elements must require user review before acceptance.

### FR-12: Manual Map Editing

- Manual editing must be a permanent first-class capability, not only a fallback during onboarding.
- The editor should provide smart primitives rather than require freehand drawing.
- Supported tools should include point, line, rectangle, circle, polygon, path, and row creation.
- Users must be able to insert and remove control points.
- Users should be able to enter exact dimensions when they know them.
- Users must be able to leave dimensions unknown.
- The application should automatically calculate dimensions only when a valid scale exists.

### FR-13: On-Site AR Marking

AR marking is proposed after the core 2D editor is validated.

- The user must select the semantic object type before capture.
- The application should support marking line endpoints and polygon corners in the real environment.
- The application should show live dimensions, area, tracking quality, and capture progress.
- The user must be able to undo the last point and close or cancel the capture.
- LiDAR should improve capture on supported devices but must not be required for core mapping.
- Captured geometry must be converted into editable 2D map objects.
- AR measurements must be described as estimates unless independently verified.
- Long objects should be capturable in segments to limit accumulated tracking error.

### FR-14: AR-to-Map Alignment

- The application must not assume that a saved AR session will always relocalize outdoors.
- An AR capture should align to the garden map using stable reference points when needed.
- A proposed alignment flow uses two known real-world points also visible on the map.
- If the map has no reference points, the first captured segment may define a local origin and direction.
- A later session must support explicit realignment when automatic relocalization fails.
- The architecture uses a garden-local planar coordinate space with optional WGS84 georeferencing, persisted capture sessions, and explicit alignment records. Exact tracking and alignment algorithms remain subject to device evaluation.

### FR-15: GPS and Geographic Positioning

- GPS may be used to locate the garden and center background imagery.
- GPS may support approximate boundaries for large properties.
- GPS must not be presented as sufficiently precise for decks, building footprints, narrow beds, or legal lot boundaries.
- Geographic AR features must have a fallback because availability and accuracy vary by device and location.

### FR-16: Guided Garden Scan

Guided Garden Scan is a future capability and must not block earlier releases.

- Capture should occur inside the application rather than rely only on an ordinary uploaded video.
- The application should provide real-time movement, coverage, and quality guidance.
- Large gardens should be capturable as smaller zones.
- The scan may collect imagery, camera motion, depth, and surface information when available.
- Processing should propose semantic objects rather than silently replace the garden map.
- Every proposed object must support accept, edit, label, or ignore actions.
- The scan must clearly communicate incomplete coverage and uncertainty.
- Capture uses hybrid processing: device guidance and capability-specific observations are combined with cloud processing for heavy analysis. Successful raw scan media defaults to deletion 30 days after extraction, and all processing output remains a proposal until user acceptance.

### FR-17: Plot Area Estimate

- The application may calculate area from a scaled boundary polygon.
- The application may provide an approximate area from map imagery or supported capture methods.
- Approximate estimates must not be displayed as exact measurements.
- Calculations that depend on area must disclose the source and accuracy level.

### FR-18: Map Provenance and Accuracy

Every imported, created, or measured map object should retain its source and verification state.

Proposed sources include:

- Manual sketch.
- Satellite or aerial imagery.
- Imported property plan.
- AR marking.
- LiDAR-enhanced marking.
- GPS.
- AI-assisted scan.
- User correction.

Proposed accuracy states include:

- **Schematic:** no reliable scale or positional accuracy.
- **Approximate:** scaled or positioned with meaningful uncertainty.
- **Measured:** captured with a measurement tool but not survey verified.
- **Document-based:** derived from an imported plan.
- **User-verified:** reviewed and accepted by the user.

User verification must not be treated as professional surveying.

### FR-19: Plant Records

Each plant record should support:

- One or more photos.
- User-defined name.
- Species and variety when available.
- Planting, sowing, or acquisition date.
- Garden, area, and map position.
- Quantity or grouping when relevant.
- Current lifecycle stage.
- Current condition.
- Care guidance and recommendations.
- Observation and activity history.
- Archived, removed, dead, or dormant states.

### FR-20: Plant Addition

- Users must be able to add plants manually.
- Users should be able to add plants from a photo.
- Photo identification results must show uncertainty and remain editable.
- The application should prefill supported plant information after identification.
- Users should be able to add individual plants, rows, or groups.
- Unknown plants must be allowed and identifiable later.

### FR-21: Plant Lifecycle and Seasonal Planning

The product should support relevant stages such as:

- Planned.
- Seed.
- Seedling.
- Transplanted.
- Growing.
- Flowering.
- Fruiting.
- Ready to harvest.
- Dormant.
- Removed or dead.

Future seasonal planning should consider sowing, transplanting, pruning, fertilizing, harvesting, succession planting, and crop rotation.

### FR-22: Garden Context

Recommendations should be able to consider, when available:

- Local weather.
- Recent rain and heat.
- User-recorded watering.
- Garden location and seasonal conditions.
- Sun and shade.
- Soil and drainage.
- Irrigation method.
- Greenhouse, container, or open-ground context.
- Plant lifecycle stage.
- Previous observations and actions.
- User goals and available time.

The source and quality of each context type must be understood before it influences high-impact guidance.

### FR-23: Monitoring and Observations

- Users must be able to add a condition update and photos at any time.
- The application may request periodic photos of selected plants or beds.
- Image analysis may suggest visible stress, disease, or pests.
- Automated analysis must not present uncertain diagnoses as confirmed facts.
- The application should ask for additional views or context when evidence is insufficient.
- Observations must accumulate into a chronological garden and plant history.

### FR-24: Recommendations

Each recommendation should include:

- Proposed action.
- Affected garden, area, or plant.
- Reason.
- Urgency.
- Relevant deadline or time window.
- Evidence used.
- Confidence or uncertainty.
- Expected consequence of delaying or ignoring the action when appropriate.
- Completion, postponement, dismissal, and relevance feedback controls.

Safety-sensitive treatment recommendations require additional product, legal, and horticultural review.

### FR-25: Work Planner

- Users must be able to create manual tasks.
- The application may suggest tasks from observations and recommendations.
- Tasks may belong to a garden, area, or plant.
- Tasks may have dates, time windows, recurrence, urgency, notes, and attachments.
- The user must be able to complete, reschedule, edit, dismiss, or delete tasks.
- Work across multiple gardens should be visible in one consolidated view.

### FR-26: Notifications

- Notifications may be generated for urgent recommendations, expected weather, requested check-ins, and scheduled work.
- Opening a notification must deep-link to the relevant object or action.
- Users must control notification categories, timing, and quiet periods.
- The application must avoid repeated low-value alerts.

### FR-27: Shared Garden Care

Shared care is proposed after single-user workflows are validated.

- Garden owners should be able to invite other people.
- Initial roles are owner, editor, and viewer with server-enforced capabilities.
- Shared users should be able to see relevant history and tasks.
- Tasks should be assignable.
- Conflicting changes and attribution must be handled.
- Membership, ownership transfer, audit, notifications, invitation expiry, and removal follow the detailed identity and notification designs.

### FR-28: Conversational Assistance

- On supported devices, users may ask typed or spoken questions.
- Answers should use known garden context rather than only generic gardening information.
- The assistant must communicate uncertainty and avoid inventing garden facts.
- Core recommendations must remain available without the conversational interface.
- Voice is an input convenience, not the only way to use the application.

### FR-29: 3D Garden View

The 3D view is a future representation of the same accepted garden information.

- It should use the same objects and positions as the 2D map.
- Objects may have height and volume.
- Users may rotate and inspect the garden.
- Selecting an object should open the same details as in 2D.
- 3D editing must not create disconnected duplicate data.
- The initial visual style may be simplified and block-based.

### FR-30: Time Machine

- Time Machine may show illustrative future plant size and seasonal appearance.
- It must be described as a planning visualization, not an exact prediction.
- It should show general changes in height, width, density, and lifecycle.
- It may be shown in 3D or AR when those capabilities exist.

### FR-31: Offline Use and Synchronization

- Essential garden viewing, map access, task completion, notes, and photo capture should work with weak or unavailable connectivity.
- Users must be informed when an action is pending synchronization.
- Failed uploads must not silently discard user data.
- The native application uses GRDB over SQLite, atomic local changes with a durable outbox, a versioned REST synchronization API, server revisions, incremental pull cursors, tombstones, and domain-specific conflict resolution.
- Cloud SQL for PostgreSQL is the synchronized source of truth, and Cloud Storage is the media store.
- Same-object stale geometry changes must not use universal last-write-wins behavior or silently discard user intent.

### FR-32: Import, Export, and Data Ownership

- Users must be able to delete their data subject to clearly documented retention rules.
- The product should provide a useful export of garden records and media.
- The baseline export is a private short-lived ZIP containing versioned JSON, GeoJSON, useful CSV tables, entitled original media, checksums, and a human-readable format description.
- Future optional exports may add PDF or GeoPackage.
- Exported measurements must retain uncertainty and non-survey disclaimers.

### FR-33: Web Application

- Grow Garden must provide a web application in addition to its mobile experiences.
- A signed-in user must be able to access the same gardens from supported mobile and web clients after synchronization.
- The web application must be treated as a first-class product surface rather than only a read-only companion.
- The web application should prioritize workflows that benefit from a larger display, keyboard, mouse, or trackpad.
- The web application should support garden-map viewing and editing.
- The web application should support property-plan import, calibration, tracing, and background management.
- The web application should support plant-record management, photos, observations, recommendations, tasks, history, and account settings.
- The web application should support shared-garden administration when collaboration is implemented.
- Device-specific capture features such as LiDAR and mobile AR may be unavailable on the web.
- When a feature is unavailable on the current device, the web application must preserve and display its resulting data without pretending to provide the capture capability.
- Users should be able to begin work on one supported surface and continue it on another without recreating garden information.
- Supported browser release lines, responsive breakpoints, recoverable draft scope, installation options, and release timing remain to be defined. The approved foundation architecture is online-first and does not include a second full browser synchronization engine.

## 10. Garden Map Validation Rules

The editor should detect and communicate:

- Self-intersecting polygons.
- Unclosed boundaries.
- Plants placed inside blocked structures.
- Objects outside the lot boundary.
- Unexpected overlaps.
- Detached gates.
- Invalid or missing scale information.
- Conflicting measurements.
- Capture results with poor tracking quality.
- Significant differences between existing and newly captured geometry.

Validation should warn rather than block when uncertainty is acceptable for garden care.

## 11. User Experience Requirements

- The product must support iPhone, iPad, and web layouts.
- The web application should be optimized for desktop and laptop map editing while remaining usable at supported responsive sizes.
- Web workflows must support keyboard, mouse, and trackpad interaction where appropriate.
- Touch targets and map controls must remain usable outdoors.
- Core flows must support one-handed use when practical.
- AR capture should use visual, haptic, and optional audio feedback.
- Users must not be required to walk backward while looking at the screen.
- Long operations must show progress and allow safe cancellation or recovery.
- Russian and English interfaces, guidance, and notifications are required.
- Metric and imperial units should be supported.
- Accessibility requirements must be defined and tested before release.

## 12. Non-Functional Requirements

These requirements describe expected qualities. Their approved high-level allocation is defined in [high-level-architecture.md](high-level-architecture.md).

### 12.1 Reliability

- User-created map changes, notes, tasks, and observations must not be lost after an acknowledged save.
- Interrupted capture and upload flows should be recoverable where practical.
- Generated recommendations must retain enough context to explain their origin.

### 12.2 Performance

- Core navigation and map editing should feel responsive on supported devices.
- Large media processing must not block access to existing garden information.
- Specific performance budgets remain to be established after device support is defined.

### 12.3 Privacy

- Camera, photo, microphone, location, and notification permissions must be requested only with clear contextual explanations.
- Property plans, addresses, garden video, and nearby private property must be treated as sensitive.
- Users must understand whether analysis occurs locally or remotely.
- Raw scan retention must be explicit and controllable.

### 12.4 Security

- The detailed architecture defines identity, authorization, encryption, secret management, private networking, data isolation, media protection, retention, and deletion controls. A formal threat-model and privacy launch review remain required.
- Shared gardens must not expose private data to uninvited users.
- Security-sensitive decisions must be reviewed before implementation.

### 12.5 Localization

- Product text must support Russian and English.
- Dates, time, units, seasons, and regional gardening guidance must respect locale and garden location.

### 12.6 Maintainability

- Implementation must follow the repository clean-code rules.
- Documentation must remain synchronized with implemented behavior.
- Architecture decisions must be documented when they are made.

## 13. Accuracy and Safety Policy

- Grow Garden is not a cadastral, legal-survey, engineering, or construction-measurement tool.
- Property boundaries must be presented as approximate unless the user imports authoritative information.
- Imported authoritative information may still be outdated and must remain editable.
- Phone-based measurement must be presented as an estimate unless externally verified.
- GPS must not be used to imply precision beyond its reported uncertainty.
- Automated plant identification and diagnosis must display uncertainty.
- Chemical, pesticide, toxicity, and safety guidance requires separate policy and expert review.
- Users must remain in control of whether generated recommendations are acted upon.

## 14. Architecture Status

### 14.1 Approved Baseline

The approved architecture baseline is defined in [high-level-architecture.md](high-level-architecture.md), with detailed designs and ADRs indexed in [architecture/README.md](architecture/README.md). It selects:

- A native Swift and SwiftUI Apple client.
- A separate TypeScript, React, and Next.js web client.
- A TypeScript and Fastify modular-monolith backend with independently deployed TypeScript or Python workers.
- Firebase and Google Cloud as the cloud ecosystem.
- Cloud Run for the interactive backend.
- Cloud SQL for PostgreSQL with PostGIS as the synchronized domain source of truth.
- Cloud Storage for media.
- Firebase Authentication, App Check, Cloud Messaging, and Crashlytics.
- Firebase App Hosting on an active supported Next.js release.
- GRDB over SQLite and an application-owned offline synchronization protocol for native mobile behavior, with online-first web behavior.
- Versioned REST/OpenAPI contracts and generated client boundaries.
- Kysely, reviewed SQL migrations, and explicit PostGIS SQL.
- Local planar garden geometry with optional WGS84 georeferencing, GeoJSON interchange, and object-level revisions.
- Cloud Tasks, Pub/Sub, Cloud Run Jobs, and a transactional outbox.
- Vertex AI behind an application-owned adapter and a deterministic rules-first recommendation system.
- Terraform and GitHub Actions with workload identity federation.
- The United States as the first market and `us-central1` as the primary region.
- Private production Cloud SQL connectivity through Direct VPC egress and protected production API ingress through a global HTTPS Load Balancer and Cloud Armor.
- Hybrid on-device and cloud processing.

The baseline deliberately leaves only release-specific versions, commercial content providers, evaluated model versions, numeric thresholds, and legal-policy exceptions for implementation-time selection.

### 14.2 Implementation-Time Selections

The architecture strategy is approved. Implementation and launch review must select or calibrate:

- Minimum supported iOS and iPadOS versions.
- Exact active Firebase-supported Next.js and Cloud SQL PostgreSQL versions.
- Supported browser release lines and responsive breakpoints.
- Initial commercial map, imagery, geocoding, weather, plant-content, and transactional-email providers.
- Exact Vertex AI model for each evaluated use case.
- Exact geometry tolerances, quotas, performance budgets, SLOs, and alert thresholds.
- Final legal retention exceptions and provider data-processing terms.

### 14.3 Product Constraints on Architecture

The architecture must support:

- Progressive and partially complete garden data.
- Editable geometry from multiple sources.
- Provenance and uncertainty.
- Offline on-site work.
- Media-rich plant history.
- Multiple capability levels across devices.
- Consistent product meaning across mobile and web surfaces.
- Future sharing and collaboration.
- Evolution from 2D to AR and 3D without duplicating garden meaning.

These constraints remain authoritative when detailed architecture and implementation decisions are made.

## 15. Proposed Acceptance Criteria

The initial product should not be considered useful solely because users can create accounts or draw maps. Validation must demonstrate the complete care loop.

Proposed acceptance outcomes include:

- A user can create a garden without knowing exact dimensions.
- A user can create at least one useful garden area and add plants.
- A user can represent a house, deck, internal fence, path, bed, and tree.
- A user can start from imagery, an imported plan, or a blank canvas.
- Imported or captured geometry remains editable.
- A user can distinguish approximate and measured objects.
- A user receives an explainable action related to actual garden context.
- A user can complete, postpone, or reject that action.
- The outcome appears in garden history.
- Essential on-site updates survive connectivity interruptions.
- Advanced-device features are optional rather than blocking.
- A signed-in user can view and continue working with the same garden from supported mobile and web clients after synchronization.
- Core map editing, planning, history, and plant-management workflows do not require mobile AR.

## 16. Product Metrics

Proposed metrics include:

- Time to first garden.
- Time to first useful area.
- Time to first relevant action.
- Garden setup completion rate.
- Weekly gardens completing at least one care loop.
- Recommendation completion, postponement, dismissal, and irrelevance rates.
- Notification disablement rate.
- Map objects corrected after import or capture.
- AR capture failure and abandonment rates.
- Difference between AR measurements and physical reference measurements during validation.
- Percentage of objects remaining schematic over time.
- Weekly observation and photo update rate.
- Retention by garden type and experience level.
- Usage and task-continuation rates across mobile and web surfaces.

Numerical targets must be established through product validation rather than invented in this draft.

## 17. Major Risks

- The product may attempt too many categories at once.
- Initial map creation may require too much user effort.
- Users may interpret estimates as exact measurements.
- Outdoor AR may accumulate unacceptable error on large properties.
- Advanced capture may exclude users without supported devices.
- Garden imagery and plans create significant privacy concerns.
- Plant diagnosis may be trusted beyond the available evidence.
- Weather-based guidance may ignore irrigation and microclimate details.
- Notifications may become repetitive or low value.
- 3D and Time Machine may consume effort before the daily care loop is validated.
- Multiple data sources may conflict without clear provenance.
- Shared editing may create synchronization and ownership complexity.
- Mobile and web feature parity may increase delivery and testing complexity.

## 18. Open Product Questions

- What exact user segment will define the first release?
- Is guest onboarding required, and when is sign-in mandatory?
- What is the minimum information required before the first recommendation?
- Which garden and structure object types are required initially?
- Which plant lifecycle stages are required initially?
- Which recommendation urgency levels should exist?
- Which recommendation categories require expert review?
- How should confidence be shown without overwhelming users?
- What makes a garden map sufficiently complete?
- Which map-creation option should be the default in each region?
- How should users establish map scale when no reference is known?
- Which devices receive AR marking or LiDAR enhancements?
- What error is acceptable for each garden-care use case?
- How should separate AR captures be aligned and reconciled?
- Should users be able to shorten the default 30-day raw scan retention for each capture?
- Which offline actions beyond viewing, map editing, task completion, notes, and photo capture are mandatory in the first release?
- Which capabilities within the approved owner, editor, and viewer roles are required in the first collaboration release?
- Which optional export formats beyond JSON, GeoJSON, CSV, media, and package documentation are worth implementing?
- Which capabilities must launch simultaneously on mobile and web?
- Which web browsers and responsive layouts are required?
- Which web editor and form drafts must survive browser restart within the approved online-first foundation behavior?
- Which 3D and Time Machine capabilities provide validated user value?
- What monetization model, if any, is appropriate?

## 19. Architecture Documentation Status

System boundaries, client technologies, source of truth, API style, local persistence, synchronization, geometry, media, identity, processing, AI, security, networking, delivery, observability, recovery, testing, export, and cost controls are defined in [high-level-architecture.md](high-level-architecture.md) and [architecture/README.md](architecture/README.md). The proposed execution sequence and release gates are defined in [implementation-plan.md](implementation-plan.md).

Implementation-time provider, version, policy, and numeric selections must be recorded in the affected detailed design or a new ADR. Implemented behavior must not diverge from the approved documentation silently.

## 20. Research Context

The following sources informed the garden-mapping proposal. They are references, not selected dependencies:

- [Apple Measure guidance](https://support.apple.com/en-ca/guide/iphone/iphd8ac2cfea/ios)
- [Apple ARKit scene reconstruction](https://developer.apple.com/documentation/arkit/visualizing-and-interacting-with-a-reconstructed-scene)
- [Apple RoomPlan overview](https://developer.apple.com/augmented-reality/roomplan/)
- [Apple ARKit raycasting](https://developer.apple.com/documentation/arkit/arsession/raycast(_:))
- [Apple AR session persistence guidance](https://developer.apple.com/documentation/ARKit/managing-session-life-cycle-and-tracking-quality)
- [Apple VisionKit](https://developer.apple.com/documentation/visionkit)
- [Apple MapKit imagery](https://developer.apple.com/documentation/mapkit/mapstyle/imagery)
- [Magicplan feature overview](https://help.magicplan.app/about-magicplan)
- [Magicplan plan import and calibration](https://help.magicplan.app/import-and-digitalize-an-existing-floor-plan)
- [ArcSite drawing from a satellite map](https://support.arcsite.com/en/articles/10770115-create-drawing-from-map)
- [ArcSite outdoor AR measurement](https://support.arcsite.com/en/articles/14062455-how-to-draw-measure-and-place-products-in-your-drawing-with-ar)
- [Polycam floor-plan capture](https://poly.cam/floor-plans)
- [Outdoor mobile AR measurement research](https://www.mdpi.com/1424-8220/26/13/4063)

## 21. Document Maintenance

- This document must remain synchronized with approved product and code changes.
- New architecture decisions must be added only after they are explicitly made.
- Superseded requirements must be revised or removed rather than contradicted elsewhere.
- Significant changes should update the draft version and last-updated date.
