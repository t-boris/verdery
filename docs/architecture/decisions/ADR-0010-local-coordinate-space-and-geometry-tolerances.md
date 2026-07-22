# ADR-0010: Local Coordinate Space Representation and Geometry Tolerances

> Status: Accepted  
> Date: July 22, 2026

## Context

ADR-0005 established the dual-space geospatial model: an editable local planar space in meters with
an optional WGS84 georeference. The data design left one question explicitly open — "the exact
custom SRID registration strategy is decided in schema implementation, but the database and API must
never label local coordinates as EPSG:4326". [Source: architecture/data-and-geospatial-design.md,
section "8. Local Coordinate Space"]

The map design likewise states that curves are "persisted through an approved canonical
approximation or curve metadata" without selecting between them, and requires a validation rule for
"geometry below useful size tolerance" without supplying numbers. [Source:
architecture/map-rendering-and-editing.md, sections "5. Geometry Types" and "11. Validation"]

Work package `P1-CONTRACT-02` must produce language-neutral geometry fixtures that pass identically
in the backend, Swift, and TypeScript. Those fixtures cannot be written until coordinate
representation, rounding, curve persistence, and tolerances are fixed, because floating-point noise
and undefined tolerances make cross-runtime equality untestable.

## Decision

### Coordinate space registration

Store accepted local geometry as PostGIS `geometry` with **SRID 0**, the PostGIS representation of an
undefined Cartesian reference system. The garden's `coordinate_space_id` column carries the
application-level identity of the space, its axis convention, origin description, and provenance.

No row is written to `spatial_ref_sys`. SRID 0 cannot be confused with EPSG:4326 by any consumer, it
requires no elevated database privilege in Cloud SQL, and planar functions such as `ST_Area` and
`ST_Distance` return meters directly because the space is defined in meters.

Geographic geometry, where a garden has a georeference, is stored separately in EPSG:4326 and is
never mixed into the same column as local geometry.

### Coordinate precision

Coordinates are stored as double precision and **rounded to 1 millimetre (3 decimal places) on
write**. Rounding happens in the application before persistence so that the backend, Swift, and
TypeScript all produce byte-identical fixture output.

One millimetre is orders of magnitude finer than any accuracy this product claims. The product is
explicitly not a survey, engineering measurement, or construction-layout tool, so this precision
exists to make revisions and fixtures deterministic, not to imply measurement quality.

### Curve persistence

Curves persist in **two parts**:

1. The `geometry` column holds an ordinary `LineString` or `Polygon` densified from the curve, with a
   maximum chord deviation of **10 millimetres**. Every PostGIS spatial function, GiST index, and
   GeoJSON serializer operates on this representation.
2. An optional `curve_metadata` field retains the curve kind and its control points, so a curved bed
   edge or path stays editable as a curve instead of degrading into a fixed vertex list.

PostGIS `CircularString` is rejected: GeoJSON cannot express it, the API contract requires GeoJSON,
many PostGIS functions do not accept it, and both renderers would densify it anyway.

### Geometry tolerances

| Tolerance | Value | Purpose |
|---|---|---|
| Vertex coalescing epsilon | 0.001 m | Matches storage precision; two vertices closer than this are the same vertex |
| Minimum polygon area | 0.01 m² | Rejects degenerate polygons from accidental taps; smaller than a plant pot |
| Minimum line length | 0.05 m | Rejects zero-length fence and path segments |
| Maximum coordinate magnitude | 10 000 m from origin | Bounds coordinates per the data design's "bounded coordinate magnitude" constraint |
| Snap tolerance | 12 screen pixels | Converted to local meters at the active zoom, per the map design's screen-space rule |
| Maximum chord deviation | 0.010 m | Curve densification limit |

## Consequences

- Fixtures compare exactly rather than with an epsilon, so a cross-runtime geometry disagreement is a
  hard CI failure instead of a tuning argument.
- Rounding is a lossy write. Clients must round before computing derived values locally, or a client
  and the server can disagree about an area by a negligible but nonzero amount. The shared geometry
  package owns this rounding so it is implemented once per runtime, not per feature.
- `curve_metadata` is advisory. Any consumer that ignores it still receives correct geometry, which
  keeps the sync protocol and generated clients simple.
- The tolerances are tuned for a private residential garden. A future commercial or agricultural
  segment would need to revisit the maximum coordinate magnitude in particular.
- Changing the maximum chord deviation later re-densifies stored geometry and produces a revision on
  every curved object, so the value is treated as a contract rather than a rendering preference.
