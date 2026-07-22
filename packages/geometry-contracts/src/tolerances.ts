/**
 * Numeric geometry tolerances.
 *
 * Every value here is a contract, not a rendering preference. Changing one
 * changes stored geometry or validation outcomes across the backend, the Apple
 * client, and the web client simultaneously.
 *
 * Source: ADR-0010, "Geometry tolerances".
 */

/** Coordinate storage precision in metres. Coordinates are rounded to this grid on write. */
export const COORDINATE_PRECISION_METRES = 0.001;

/** Decimal places implied by {@link COORDINATE_PRECISION_METRES}. */
export const COORDINATE_DECIMAL_PLACES = 3;

/** Two vertices closer than this are the same vertex. Matches storage precision. */
export const VERTEX_EPSILON_METRES = 0.001;

/** Polygons smaller than this are rejected as degenerate. Smaller than a plant pot. */
export const MINIMUM_POLYGON_AREA_SQUARE_METRES = 0.01;

/** Line segments shorter than this are rejected as degenerate. */
export const MINIMUM_LINE_LENGTH_METRES = 0.05;

/** Coordinates further than this from the local origin are rejected. */
export const MAXIMUM_COORDINATE_MAGNITUDE_METRES = 10_000;

/** Maximum deviation between a curve and the polyline persisted for it. */
export const MAXIMUM_CHORD_DEVIATION_METRES = 0.01;

/**
 * Snap radius in screen pixels. Clients convert this to local metres at the
 * active zoom; it is never stored.
 *
 * Source: architecture/map-rendering-and-editing.md, section "3.3 Screen Space".
 */
export const SNAP_TOLERANCE_SCREEN_PIXELS = 12;

/** Minimum vertex count for a closed linear ring, counting the repeated closing vertex. */
export const MINIMUM_RING_VERTEX_COUNT = 4;

/** Minimum vertex count for an open line string. */
export const MINIMUM_LINE_VERTEX_COUNT = 2;
