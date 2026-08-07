# Garden Map Rendering and Editing Design

> Status: Draft 0.3
> Decision status: Approved baseline  
> Last updated: July 28, 2026

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
- Location and true-north-orientation accuracy and provenance.
- Revision.

Changing georeferencing updates the transform, not every accepted local coordinate.

When a georeference exists, the editor displays a true-north indicator. Authorized editors can
revise the geographic anchor or north rotation through location search, map pinning, manual rotation,
or approved control-point alignment. Device heading is only proposed evidence and never silently
changes an accepted map orientation.

View rotation is part of the local camera, not an object mutation. The editor provides 15-degree
clockwise/counter-clockwise steps, an exact degree input, and North up. The same camera transform is
applied to every local object and to the MapLibre bearing, so a lot, structures, labels and backdrop
cannot rotate or zoom independently. North up sets the view rotation to the inverse of the accepted
georeference rotation; it does not rewrite that georeference.

The web editor persists camera center, zoom, view rotation, backdrop choice, background opacity, and
layer visibility/lock state per garden. Reloading or returning to a garden restores that exact view;
selection and an active interaction tool remain transient.

#### Backdrops

A georeferenced garden may be drawn over a provider backdrop. Two exist, and the person chooses
between them and none:

- **Aerial imagery** (USGS National Map NAIP Plus), which is what a lot is traced from. United
  States coverage at 0.30 m per pixel — the service's own reported `pixelSizeX`, not an estimate —
  so a house, a driveway and a fence line are legible; an individual bed is not, and the interface
  says so rather than implying otherwise.
- **Street tiles** (OpenStreetMap Standard), for orientation rather than tracing.

Each provider declares the zoom range it can actually draw, and the editor obeys it rather than
discovering the limits by painting nothing:

- **Street tiles remain visible when enlarged.** OpenStreetMap Standard raster tiles are requested
  only through their supported zoom 19 and MapLibre overzooms the last tile through zoom 22. The
  result remains an orientation layer, not a tracing surface, but it never becomes a blank grid.
- **Imagery is requested only at the resolution it holds.** Past zoom 19 the service returns the
  same ground enlarged in hard blocks at four times the requests, so the tile source stops there
  and the renderer does the enlarging smoothly.
- **The camera may not outrun the backdrop.** MapLibre clamps its own zoom at 22 while the local
  camera scales to 400 px/m; the two would drift apart by up to eleven times. While a backdrop is
  shown the camera is held at the largest scale the backdrop still follows, and the editor says
  the backdrop must be turned off to go closer.
- **Enlargement is stated, not implied.** A map over imagery opens no closer than four times the
  imagery's own detail, and past that the scale badge reads how far the photograph has been
  stretched.

The metre grid stands down over a photograph, where it is noise on the ground, and stays over a
street map, which carries no sense of scale of its own.

`traceGardenFromAerial` is the assisted object-capture step after plat alignment. It requires exactly
one saved lot, reads a fixed 160 m, north-up USGS image centered on that polygon, and asks Vertex only
for structures, driveway/walk lines, parking surfaces, fences, water/utility areas and visible trees
inside it. It never creates or replaces a lot. No county adapter, parcel aggregator or
imagery-inferred boundary exists. The user can accept each proposal separately.

An uploaded plat remains the stronger source for surveyed shape and dimensions. Its bearings,
distances, chord and north arrow produce local geometry by arithmetic; the selected address supplies
the approximate geographic placement and the alignment overlay supplies the final translation.
During review, the boundary and every extracted structure, path, fence and easement form one
transient alignment group. Dragging that overlay or changing its rotation/scale applies one uniform
transform to the complete set before any object is created. Internal relative positions therefore
remain intact; acceptance persists the already-aligned geometries through ordinary map commands.
The review keeps checkbox state entirely in client-local primitives captured during the input
event; it never retains or later dereferences a framework event object. Selecting or clearing any
proposal therefore updates the accepted count without closing or crashing the review.

A backdrop is context, never geometry. No pixel of it enters the domain model: what someone traces
over it is their own drawing, carrying their own provenance. The projection between local metres and
WGS84 belongs to the garden's georeference rather than to a provider, so switching backdrop cannot
move an accepted point — a property the providers' shared transform makes structural rather than
conventional.

An empty georeferenced garden opens with one piece of guidance, not thirteen: trace the lot. Every
other object is placed inside it, and a garden with no location is pointed at its Location settings
instead, since a drawing with nothing to sit on is advice that cannot be followed.

Map panning updates the shared local camera continuously during the pointer gesture. Konva geometry
and the MapLibre backdrop therefore move through the same transform on every frame; native Konva
stage dragging is not used because it would move only the drawing during the gesture and make the
photograph jump to the new camera position on release.

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

| Domain object                                      | Primary geometry                             |
| -------------------------------------------------- | -------------------------------------------- |
| Lot, structure, deck, zone, bed                    | Polygon or multipolygon where approved       |
| Fence, path centerline, utility                    | LineString or MultiLineString where approved |
| Gate                                               | Positioned segment associated with a fence   |
| Tree trunk, legacy point plant, marker             | Point                                        |
| Tree canopy, new plant placement, grouped planting | Polygon or circle-derived polygon            |
| Imported background                                | Calibrated raster transform                  |

Curves are edited through application control points and persisted through an approved canonical approximation or curve metadata. The API cannot expose renderer-specific path objects.

## 6. Hybrid Data Model

All editable objects share identity, garden, category, geometry, provenance, confidence, revision, and lifecycle state. Specialized tables and domain types hold plant, fence, structure, and other category-specific behavior.

New plant and tree placement is a one-click action. The click creates a small circle-derived polygon
(a larger default canopy for a tree and a compact occupied area for an individual plant), so it is
immediately visible without asking the gardener to trace it.
The map object is the geometry; the plants-inventory record remains the actual plant identity and
references that object through `placementMapObjectId`. The regular polygon remains ordinary editable
geometry: it can be moved, resized, flattened, or edited vertex by vertex. After creation, the editor resolves the reverse
link and offers exactly three paths: attach an existing inventory plant with no map placement, create
a plant manually, or create one from a photograph. Plant search therefore supports both
`hasMapPlacement` and exact `placementMapObjectId` filters instead of downloading an arbitrary page
and guessing client-side. Legacy point plant objects remain readable and editable.

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

While a creation tool is active, accepted garden objects remain visible, but they must never consume
the placement gesture. On web, accepted objects leave the Konva hit graph while remaining snapping
candidates, so pointer events reach the stage even over a filled lot, house, zone, or bed. On iOS,
all geometry is pixels in one SwiftUI `Canvas`; the view model handles an armed creation before any
selection hit test. Object selection and dragging are restored when creation ends or the select tool
becomes active.

On web, an object drag uses a temporary Konva group offset only while the command is in flight. The
server response already returns geometry with the translation applied, so the temporary offset is
cleared after both successful and rejected commands. Keeping it would render the same translation
twice and make later drag deltas accumulate movement that the person did not perform.

## 9. Undo and Redo

Undo and redo are local editor-session capabilities operating on committed local commands that have not been invalidated by a remote revision.

- Undo creates the inverse domain command; it does not rewind the database.
- Once synchronized, undo remains a new explicit change.
- Remote changes that invalidate the local stack clear or rebase affected entries with a user-visible explanation.
- Accepted plan-extraction and AR proposals can be undone through revision restoration, not by
  deleting processing history. The same rule applies to future reconstruction proposals only if
  that research is promoted into delivery.

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

Layer visibility, locking, and opacity are per-garden user preferences. Domain objects do not store
arbitrary visual stacking that would invalidate semantic ordering. Every content layer starts
unlocked; locking is always an explicit user choice. A lock blocks creation, selection, dragging,
geometry/property edits, duplication, joining, and deletion until explicitly unlocked. The
version-2 preference migration preserves camera, rotation, visibility, opacity, and backdrop while
clearing the version-1 automatic lot/layout locks once.

The camera, geographic backdrop, and garden geometry share one local-metre-to-screen transform.
Panning, zooming, or rotating the view therefore keeps every traced object attached to the same
ground imagery and never mutates object coordinates. Whole-object movement must first be armed as
an explicit interaction mode from the selected object's toolbar; ordinary selection mode remains
safe for panning. Shift-selection creates a working group, and one `moveObjects` command translates
all selected objects atomically. Vertex editing remains a separate, single-geometry operation.

## 13. Web Rendering

- MapLibre renders optional geographic context, in the SAME rectangle as the Konva stage — as its
  child, not as a sibling of the canvas area. A backdrop aligned to any other box slides against
  the drawing whenever that box changes, which is what the editor's drawing hint used to do at
  precisely the moment someone was tracing.
- Konva renders garden-local objects and interactive handles.
- The canvas is the workspace: tools, backdrop choice, zoom, the drawing hint and the draft
  controls float over it, and what were five stacked side panels — properties, object index,
  layers, imported background and calibration, warnings — share one collapsible drawer of tabs.
  Plant and tree tools place a circle-derived editable area immediately on one click and select it,
  opening the inventory-link choices without a Finish/Cancel drafting phase. Other polygon and line
  tools retain bottom-center Finish/Cancel controls and the double-click shortcut.
  Below the tablet breakpoint the drawer becomes an overlay; on a phone it becomes a bottom sheet
  capped at 45% of the height, so the drawing always keeps the larger half.
- Selecting an object raises a small panel at the object itself: explicitly arm move,
  rotate/resize, edit
  vertices, delete. The same actions remain in the properties tab, which is the keyboard and
  screen-reader route.
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

### 16.1 Implemented import profile (P6-PLAN-01)

The `importedBackground` category now carries a real detail payload
(`ImportedBackgroundDetails`, stored in `gardens_mapping.imported_background_details` — the same
one-row-per-object detail-table shape every other detail-bearing category uses):

- `planMediaId` — the `imported_plan` media record the background displays, validated at command
  time to be an `available` + `processed` plan in the same garden (a real cross-schema foreign key
  plus application-level class/garden/state checks, mirroring the gate → fence precedent).
- `sourcePageNumber` — the section-8 page-selection step, modeled honestly: 1-based, only above 1
  for a PDF source, and not yet driving rendering (PDF page rendering remains deferred,
  P6-WORKER-02).
- `isBackgroundVisible` — the per-background persisted visibility flag ("independently hideable").
  Distinct from the web client's client-local layer-2 visibility preference, which hides every
  imported background at once and resets on reload; the persisted flag hides one background's plan
  imagery while its object outline stays selectable.
- `calibrationState` — `'uncalibrated'` at creation: a fresh background has no plan-to-map
  transform, and the UI shows an explicit "not calibrated" indication instead of pretending a 1:1
  transform is meaningful. P6-PLAN-02 widened it to `'uncalibrated' | 'calibrated'` — see
  section 16.2.

Creation, visibility toggling, and removal are the EXISTING map commands (`createObject`,
`changeProperties`, `deleteObject`) — revision-guarded and idempotent like every other category,
never a parallel command model. A created background records `importedPlan` provenance. Cross-object
geometry validation (overlaps, containment) is not yet implemented for any category
(`GetGardenMap.validationSummary` is honestly empty), so there is nothing an imported background
needs a special exemption from yet; when those rules land, a background's non-authoritative nature
(this section) excludes it by design.

`deleteObject` and its inverse `restoreObject` update lifecycle metadata only: lifecycle state,
revision, and update timestamp. They do not serialize or rewrite unchanged geometry, provenance,
labels, confidence, or category-detail rows. This keeps deletion independent from geometry editing,
avoids unnecessary PostGIS validation work in the interaction path, and lets an existing object be
removed even when its stored geometry predates the current serializer.

Web display renders the plan's screen-preview derivative "contain"-fit inside the background
object's placeholder polygon, under all garden geometry. Tile CONSUMPTION is deferred even though
the server-side pyramid exists (section 11.1 of the media design) — see
`docs/development/deferred-capabilities.md`.

### 16.2 Implemented calibration profile (P6-PLAN-02)

Calibration extends the P3-era `gardens_mapping.calibration` table and `upsertCalibration`
command — which already modeled per-background revisions ("recalibration is a new row") and a
then-unpopulated residual-error column — rather than building a parallel mechanism. Verified
against the real code: that table was always plan-background calibration; garden-level geographic
placement is the separate `georeference` table.

- **Inputs (stored, so recalibration re-derives instead of restarting):** the one known-distance
  segment (two plan points + a distance in metres), zero or more control points (plan point ↔
  local point), an optional manual adjustment (rotate about the local origin, then translate),
  and the page aspect ratio (height/width, client-measured — the API exposes no raster
  dimensions). Plan points are "plan-fraction" coordinates: pixel x AND y divided by the displayed
  rendition's WIDTH, y down — isotropic and resolution-independent, since every derivative
  preserves the page's aspect ratio.
- **Derived transform:** a SIMILARITY transform (uniform scale + rotation + translation),
  `local = t + s · R(θ) · (u, −v)` — exactly the degrees of freedom this section's own vocabulary
  names. A 6-DOF affine was rejected: shear would absorb input noise and manufacture precision.
  Scale comes from the known distance alone; rotation and translation from a least-squares rigid
  fit (2D Kabsch, scale fixed) over the control points; the manual adjustment composes on top.
  The math lives once in `@verdery/geometry-contracts` (`calibration.ts`), pinned by the shared
  `geometry/calibration.json` fixtures, so client previews and the server's authoritative
  derivation are the same computation.
- **Quality, honestly:** per-control-point residuals and their RMS are computed against the final
  stored transform. RMS is `null` below two control points — a one-point fit is exact by
  construction, and reporting zero would be false precision. Every surface (canvas badge, panels)
  shows "±N cm estimated error" or explicitly states that accuracy is not estimated.
- **Transform revisions:** each (re)calibration inserts a new `calibration` row with a
  per-background monotonically increasing `revision`, surfaced as
  `details.calibration.transformRevision` — deliberately distinct from the object's
  optimistic-concurrency revision, so a consumer can tell "the background moved under me" apart
  from ordinary edits. The details table stores only the state flag; the read path joins the
  latest calibration revision, so state and transform cannot drift in storage.
- **Server-owned state:** `calibrationState` flips only through `upsertCalibration` (now
  revision-guarded — it rewrites the object's details AND geometry). `createObject` requires
  `'uncalibrated'`; `changeProperties` must echo the current state and always keeps the stored
  `calibration` block. Applying a calibration replaces the placeholder polygon with the
  transformed page footprint, so the selectable outline and the rendered imagery coincide;
  geometry-editing commands are rejected for a calibrated background, and a drag on the web
  becomes a recalibration with the delta folded into the manual adjustment. Duplicating a
  calibrated background yields an uncalibrated copy (revisions belong to the source).
- **Tracing needs no new tools:** the calibrated image renders at its transform under all garden
  geometry, non-listening, and the ordinary drawing tools (P3) draw over it unchanged; the one
  added affordance is a client-local underlay-opacity control for dimming a dense plan while
  tracing. Geographic anchors remain deferred with reasoning
  (`docs/development/deferred-capabilities.md`) until `P12-GEO-01` supplies georeference authoring,
  after which plan→geographic composes for free.

### 16.2 Geographic and Solar Context

Geographic imagery remains a replaceable contextual layer behind accepted garden-local geometry.
The editor distinguishes imagery shadows from a calculated shadow overlay. A calculated overlay is
versioned against the georeference, selected date/time, obstacle geometry, height facts, terrain
inputs, and solar-model version.

The renderer exposes a north indicator, input-quality summary, date/time controls, representative
season shortcuts, and direct-sun-duration view where the analysis supports it. Missing obstacle
heights or terrain reduce the visible confidence and never produce false precision. Web and iOS use
the same analysis contract while retaining platform-appropriate interaction.

## 17. Generated Proposals

Proposals exist in a separate review state and include:

- Source capture or import.
- Processor and model version.
- Proposed geometry and category.
- Confidence.
- Coordinate-space transform.
- Validation diagnostics.

The user may accept, edit-and-accept, partially accept, or reject proposals. Acceptance creates ordinary versioned garden commands and preserves the proposal lineage.

### 17.1 Reading a plat of survey

The first real producer of proposals is `readPlatFromPlan` (ADR-0018): an uploaded plat is
transcribed, its boundary calls are walked into a lot polygon, and everything else drawn on the
sheet is carried into garden metres at the survey's own scale.

The reading is **synchronous and stores nothing** — the endpoint writes no proposal record, no
object, and no georeference. What comes back is reviewed in the client, next to the plan it came
from, and each accepted item becomes an ordinary `createObject` command. That is why acceptance
here has no `decideProposal` step: until the person accepts, nothing exists to decide.

What review shows, because it is what a person needs in order to disbelieve the reading:

- the traverse's **closure error** in metres, and whether it closes at all;
- the walked **area** beside the area the sheet itself states;
- the **page-fit residual** — how closely the drawing's own lot outline matched the walked
  polygon, which bounds every object placed by that fit;
- each object's own **confidence**, its category, and its size.

The printed calls and visible outline are independent evidence before a reading reaches review. A
first pass with fewer than four boundary calls is read again with an explicit missing-edge
correction; it is never closed into a new triangle. Their counts are deliberately not compared: one
surveyed chord can describe a curved frontage that needs several page points to trace visibly.
Completeness is checked by the independently walked traverse and its closure error. A geometrically
closed boundary is not preselected when its walked area differs from the sheet's stated area by more
than 15%.

Each proposal arrives as the geometry its category actually holds (section 5): an outline for a
structure or a zone, a centre line for a path or a fence, a trunk position for a tree. Extraction
includes a distinct whole-parcel visual pass for the house, garage, porch/deck, driveway, walks,
patios, fences, easements, and trees. Clearly drawn but unlabelled linework is proposed with an empty
label; printed labels are preserved verbatim. An accepted object records where it came from —
`importedPlan` for the boundary walked from printed measurements, `imageExtraction` for a shape
traced off the drawing — through `createObject`'s optional `source`, so a surveyed line is never
mistaken later for a hand-drawn one.

When the traverse does not close, the boundary is still returned and marked as not closing, but no
objects are proposed: without a trustworthy lot there is no scale, and an object placed by a guess
at scale is worse than no object.

When a garden already has a georeference, the surveyed lot and every page-derived object share one
additional transform into that garden's existing local space: the lot centroid is placed at the
saved local anchor, true-north rotation and scale correction are inverted, and every proposal rides
the same transform. This avoids placing the first survey corner at the address point and keeps the
plat aligned with the aerial camera. The address remains an approximate anchor, not cadastral proof.

## 18. Selection and Properties

Selection is identified by object ID, never by renderer node reference. The property panel reads the canonical object draft and exposes semantic fields, measurements, provenance, and uncertainty.

Multi-selection is allowed only for operations with clearly defined domain behavior. Bulk transformations must preserve each object's expected revision.

### 18.1 Web Editor Workspace

The desktop web editor uses three persistent workspace regions:

1. Utilities for layers, imported plans, calibration, and validation warnings.
2. The canvas as the flexible primary work area.
3. An inspector containing the object list followed immediately by properties.

Objects and properties must remain visible without scrolling past utility panels. The object list has
its own bounded scroll region, while the inspector and utility regions may scroll independently of
the canvas. At intermediate widths, the canvas and inspector remain adjacent and utilities move
below them. On narrow screens, the order becomes canvas, inspector, then utilities.

The workspace uses the available page width rather than the standard reading-column width. Drawing
tools are grouped by task, use a category icon plus a short category name, and preserve the full
action description in accessible labels and tooltips. Familiar reversible controls such as undo,
redo, layer visibility, and layer locking may be icon-only when they have accessible names.
Destructive or uncommon commands retain visible text when an icon alone could be ambiguous.

### 18.2 Exact Dimension Entry

The property inspector exposes editable geometry dimensions directly after object selection:

- Polygon and multipolygon objects expose overall map-axis-aligned width and depth in metres.
- Line and multiline objects expose total length in metres.
- Area and perimeter are derived read-only values for polygonal geometry.
- Point objects continue to use category-specific semantic size fields where applicable.

Applying polygon dimensions scales X and Y independently around the geometry bounding-box center.
Applying a line length scales the complete linework uniformly around its center. The client submits
one revision-guarded `replaceGeometry` command; canonical coordinates remain in garden-local metres.
Dimension entry is a planning aid, not a legal survey, and the interface must state that the result
is approximate. Rotated polygons therefore show their overall map-axis envelope, not an inferred
edge length.

### 18.3 Category Recognition

Every object category has a stable visual identity composed of:

- A distinct category color used by the drawing tool, object list, and canvas.
- A category-specific icon or glyph that remains meaningful without color.
- A high-contrast outline or halo so geometry remains legible over dark canvases and light imported
  plans.
- Selection styling layered on top of the category style without erasing category identity.

Color is never the only means of identifying a category. Labels, icons, line patterns, and geometry
shapes provide redundant cues for accessibility and dense gardens.

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
