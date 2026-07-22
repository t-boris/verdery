# Garden Map Rendering and Editing Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the shared behavior and platform-specific rendering architecture of the Grow Garden 2D map editor. It covers coordinate spaces, objects, editing commands, rendering, selection, validation, undo, calibration, basemap context, accessibility, and performance.

## 2. Design Principles

- The garden model is independent of any rendering library or map provider.
- The same accepted objects and revisions are represented on iOS and web.
- The editable garden uses a stable local planar coordinate space measured in meters.
- Geographic context is optional.
- Approximate, measured, imported, and inferred geometry remains editable.
- Generated geometry is a proposal until user acceptance.
- Pointer or touch movement does not produce a server mutation per frame.

## 3. Coordinate Spaces

### 3.1 Garden Local Space

Every garden has a right-handed two-dimensional local coordinate space:

- Units are meters.
- The origin is stable after creation.
- The X/Y axis orientation is recorded explicitly.
- Z or height is stored as optional object metadata and does not change 2D topology.
- Editing calculations occur in this space.

### 3.2 Geographic Space

A garden may have an optional transformation to WGS84. The transformation includes:

- Geographic anchor.
- Local anchor.
- Rotation.
- Scale when derived from uncertain imagery.
- Accuracy and provenance.
- Revision.

Changing georeferencing updates the transform, not every accepted local coordinate.

### 3.3 Screen Space

Each client owns a viewport transform from local coordinates to device pixels. Screen-space hit testing uses a constant visual tolerance converted back to local space at the active zoom.

### 3.4 Imported Image Space

Plans and images begin in pixel coordinates. Calibration maps pixels into garden-local meters using one or more user-provided references. Calibration records are versioned and preserve residual error or uncertainty.

## 4. Canonical Object Categories

Initial categories are:

- Lot boundary.
- Structure, including house, shed, greenhouse, and deck.
- Fence and gate.
- Path and hardscape.
- Garden zone and bed.
- Water feature and utility exclusion.
- Tree canopy and trunk location.
- Individual plant or plant grouping.
- Annotation and measurement reference.
- Imported background or proposal layer.

Objects use typed domain records rather than arbitrary styling dictionaries. Presentation style is derived from category, state, confidence, selection, and accessibility preferences.

## 5. Geometry Types

| Domain object                   | Primary geometry                             |
| ------------------------------- | -------------------------------------------- |
| Lot, structure, deck, zone, bed | Polygon or multipolygon where approved       |
| Fence, path centerline, utility | LineString or MultiLineString where approved |
| Gate                            | Positioned segment associated with a fence   |
| Tree trunk, point plant, marker | Point                                        |
| Tree canopy, grouped planting   | Polygon or circle-derived polygon            |
| Imported background             | Calibrated raster transform                  |

Curves are edited through application control points and persisted through an approved canonical approximation or curve metadata. The API cannot expose renderer-specific path objects.

## 6. Hybrid Data Model

All editable objects share identity, garden, category, geometry, provenance, confidence, revision, and lifecycle state. Specialized tables and domain types hold plant, fence, structure, and other category-specific behavior.

The editor receives a normalized map document:

```text
GardenMapDocument
├── coordinateSpace
├── georeference?
├── layers[]
├── objectsById
├── acceptedRevision
└── validationSummary
```

## 7. Editor Command Model

User changes are expressed as typed commands:

- Create object.
- Move object.
- Replace geometry.
- Insert, move, or remove vertex.
- Split or join supported linework.
- Change object properties.
- Assign plant to bed or zone.
- Create or update calibration.
- Accept, modify, or reject a proposal.
- Delete or restore object.

Each command includes:

- Command identifier.
- Target garden and object identifiers.
- Expected base revision.
- Canonical values.
- Author and client timestamp metadata.
- Inverse information or a deterministic method to derive local undo.

## 8. Gesture Lifecycle

```text
pointer/touch down
      │
      ▼
begin transient edit
      │
      ▼
preview movement at frame rate
      │
      ▼
local validation and snapping
      │
      ▼
commit one editor command
      │
      ▼
durable local transaction or server mutation
```

Gesture previews are never synchronized directly. Only committed commands enter durable state.

## 9. Undo and Redo

Undo and redo are local editor-session capabilities operating on committed local commands that have not been invalidated by a remote revision.

- Undo creates the inverse domain command; it does not rewind the database.
- Once synchronized, undo remains a new explicit change.
- Remote changes that invalidate the local stack clear or rebase affected entries with a user-visible explanation.
- Accepted scan proposals can be undone through revision restoration, not by deleting processing history.

## 10. Snapping and Constraints

Initial snap targets include:

- Existing vertices.
- Edge projections.
- Horizontal and vertical directions in local space.
- Configurable angle increments.
- Known measurement distances.
- Lot and structure boundaries.

Snapping is advisory unless a domain rule requires a hard constraint. The user can temporarily disable it.

Constraint metadata must not depend on Konva, Core Graphics, MapLibre, or MapKit types.

## 11. Validation

Local validation provides immediate feedback. Server validation is authoritative.

Rules include:

- Polygon closure and minimum vertex count.
- Self-intersection.
- Invalid rings or holes.
- Object outside the lot.
- Unexpected overlaps.
- Plant inside blocked structure.
- Detached gate.
- Invalid scale or calibration.
- Geometry below useful size tolerance.
- Conflicting measurements.
- Stale object revision.

Validation results have stable codes, severity, affected object IDs, optional geometry, and localized display parameters.

Warnings do not block a save unless the corresponding rule protects data integrity or safety.

## 12. Layer Model

Logical layers are ordered independently from rendering implementation:

1. Geographic basemap.
2. Imported plan or image backgrounds.
3. Lot and fixed structures.
4. Zones, beds, paths, and fences.
5. Plants and annotations.
6. Generated proposals.
7. Selection, handles, measurements, and validation overlays.

Layer visibility and opacity are user preferences. Domain objects do not store arbitrary visual stacking that would invalidate semantic ordering.

## 13. Web Rendering

- MapLibre renders optional geographic context.
- Konva renders garden-local objects and interactive handles.
- A synchronization adapter keeps viewport transforms aligned without coupling domain state to either engine.
- The editor uses a dedicated client-side store for selection and transient state.
- Large immutable render snapshots are memoized by object revision.
- CPU-intensive geometry preparation may move to a Web Worker.

## 14. Apple Rendering

- MapKit renders optional geographic context.
- SwiftUI Canvas and Core Graphics render garden-local objects and interaction overlays.
- Gesture state is owned by a dedicated editor session.
- Render snapshots are immutable and `Sendable`.
- Metal is introduced only when representative profiling shows Canvas/Core Graphics cannot meet the frame budget.

## 15. Provider Independence

The map-provider adapter supplies:

- Raster or vector context tiles.
- Attribution requirements.
- Coverage and zoom metadata.
- Optional geocoding and imagery dates.

Provider terms, cache permissions, attribution, and image-processing rights are stored in configuration and reviewed before launch. Provider tiles never become authoritative garden geometry.

## 16. Plan Import and Calibration

The user may import PDF or raster plans. Processing creates a non-authoritative background asset and optional extracted line proposals.

Calibration supports:

- One known-distance segment for uniform scale.
- Multiple control points for rotation and error estimation.
- Optional geographic anchors.
- Manual origin and orientation adjustment.

The interface displays calibration quality and prevents false precision. Recalibration creates a new background transform revision.

## 17. Generated Proposals

Proposals exist in a separate review state and include:

- Source capture or import.
- Processor and model version.
- Proposed geometry and category.
- Confidence.
- Coordinate-space transform.
- Validation diagnostics.

The user may accept, edit-and-accept, partially accept, or reject proposals. Acceptance creates ordinary versioned garden commands and preserves the proposal lineage.

## 18. Selection and Properties

Selection is identified by object ID, never by renderer node reference. The property panel reads the canonical object draft and exposes semantic fields, measurements, provenance, and uncertainty.

Multi-selection is allowed only for operations with clearly defined domain behavior. Bulk transformations must preserve each object's expected revision.

## 19. Accessibility

Canvas content is accompanied by:

- A structured object tree or list.
- Keyboard selection and movement controls on web.
- Accessible property editing.
- Announced validation and save status.
- Non-color confidence and state indicators.
- Configurable handle and text sizes.

Not every freehand gesture requires a fully equivalent keyboard geometry editor in the first release, but essential object creation, selection, property editing, deletion, and measurement entry must be accessible.

## 20. Performance Strategy

- Viewport culling excludes off-screen shapes.
- Spatial indexes accelerate hit testing.
- Render snapshots are keyed by object revision.
- Gesture previews update only affected nodes.
- Labels use zoom-dependent density.
- Very large imported images use pyramids or appropriately sized derivatives.
- Server mutations occur at commit boundaries.

Representative performance fixtures include small, normal, large, and pathological gardens.

## 21. Geometry Test Contract

Shared language-neutral fixtures define:

- Valid and invalid geometries.
- Coordinate transformations.
- Calibration results.
- Snap calculations.
- Measurement conversions.
- Serialization round trips.
- Revision conflicts.
- Proposal acceptance.

Swift, TypeScript, and backend tests must produce equivalent semantic outcomes within documented floating-point tolerances.

## 22. Completion Criteria

The map design is satisfied when:

- House, deck, internal fence, gate, path, bed, tree, and plants can be represented.
- A garden can begin without geographic coordinates.
- Imported backgrounds can be calibrated and retraced.
- Local and geographic layers remain aligned within reported uncertainty.
- Editing is command-based and undoable.
- Validation is consistent across clients and server.
- Generated geometry never silently replaces accepted objects.
- Rendering libraries can be replaced without migrating domain data.
