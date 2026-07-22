# ADR-0005: Local Planar Geometry with Optional WGS84 Georeferencing

> Status: Accepted  
> Date: July 21, 2026

## Context

Garden editing and measurement operate over a small property where stable planar coordinates are easier to reason about than latitude and longitude. The product also needs optional placement over aerial imagery and regional weather context.

## Decision

Store accepted editable garden geometry in a garden-local planar coordinate space measured in meters. Store an optional georeferencing transform that maps the local space to WGS84. Use PostGIS for geometry validity, indexing, transformations, and spatial queries. Exchange geometry through GeoJSON plus explicit coordinate-space, provenance, uncertainty, and revision metadata.

## Consequences

- Small-site editing avoids geographic projection distortion and floating-origin instability.
- A garden can exist without a known real-world location.
- Imagery alignment can be revised without rewriting every local object.
- API consumers must never assume that GeoJSON coordinates are WGS84 unless the coordinate-space metadata says so.
- Exporters must transform or label coordinates correctly.

## Rejected Alternatives

- WGS84-only geometry was rejected because it is awkward for local measurement and unlocated gardens.
- Local-only geometry was rejected because imagery, regional context, and interoperable export require optional georeferencing.
- Full event sourcing was rejected; current geometry plus immutable revisions provides the required auditability with less complexity.
