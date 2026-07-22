/**
 * Coordinate space identity.
 *
 * The product stores accepted editable geometry in a garden-local planar space
 * measured in metres. That space is registered in PostGIS as SRID 0 — an
 * undefined Cartesian system — so that no consumer can mistake it for
 * EPSG:4326. Application-level identity lives in `coordinateSpaceId`.
 *
 * Source: ADR-0010, "Coordinate space registration";
 * architecture/data-and-geospatial-design.md, section "8. Local Coordinate Space".
 */

/**
 * PostGIS SRID used for garden-local planar geometry.
 *
 * SRID 0 means "no reference system declared". It is deliberately not a
 * registered projected system: the origin is per garden and arbitrary.
 */
export const LOCAL_PLANAR_SRID = 0;

/** PostGIS SRID for geographic geometry, used only where a garden is georeferenced. */
export const GEOGRAPHIC_SRID = 4326;

/**
 * Which space a set of coordinates belongs to.
 *
 * Standard GeoJSON carries no such marker, so every geometry envelope crossing
 * the API states it explicitly.
 *
 * Source: architecture/api-design.md, section "18. Geometry Contracts".
 */
export type CoordinateSpaceKind = 'localPlanarMetres' | 'geographicWgs84';

/** Axis orientation of a garden-local space. Recorded once and stable afterwards. */
export type AxisConvention = 'xEastYNorth';

/** A garden's local planar coordinate space. */
export interface LocalCoordinateSpace {
  /** UUIDv7 identifying this space. */
  readonly id: string;
  readonly kind: 'localPlanarMetres';
  readonly axisConvention: AxisConvention;
  /** Human-readable description of what the origin corresponds to on the ground. */
  readonly originDescription: string;
}

/** Returns the PostGIS SRID for a coordinate space kind. */
export function sridForKind(kind: CoordinateSpaceKind): number {
  return kind === 'localPlanarMetres' ? LOCAL_PLANAR_SRID : GEOGRAPHIC_SRID;
}

/**
 * True when a SRID denotes local planar coordinates.
 *
 * Used at persistence boundaries to reject geometry that would otherwise be
 * written into the wrong column.
 */
export function isLocalPlanarSrid(srid: number): boolean {
  return srid === LOCAL_PLANAR_SRID;
}
