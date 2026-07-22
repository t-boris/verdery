/**
 * PostGIS `geometry` column conversion.
 *
 * Kysely has no PostGIS-aware column type, so every geometry column in this
 * module is read as `ST_AsGeoJSON(column)::text` and written as
 * `ST_GeomFromGeoJSON($1)`, via `sql` raw expressions — never through the
 * typed query builder's own `.select()`/`.set()`, which do not know PostGIS
 * functions. Written once here and reused by every repository that touches a
 * geometry column, rather than repeated per call site.
 *
 * Verified directly against a real PostGIS 17/3.5 container before any
 * repository was built on top of it (see the module's integration test).
 *
 * Source: task instructions, "THE ONE GENUINELY NEW TECHNICAL PROBLEM:
 * PostGIS geometry columns."
 */

import type { Geometry } from '@verdery/geometry-contracts';
import { sql, type RawBuilder } from 'kysely';

/** Raw SQL expression selecting a geometry column as GeoJSON text. Always SRID 0 (local planar) in this schema — see the migration's SRID CHECK constraints. */
export function geometrySelectExpression(column: string): RawBuilder<string> {
  return sql<string>`ST_AsGeoJSON(${sql.ref(column)})`;
}

/** Same as {@link geometrySelectExpression}, for the nullable `tree_details.canopy_geometry` column. */
export function nullableGeometrySelectExpression(column: string): RawBuilder<string | null> {
  return sql<string | null>`ST_AsGeoJSON(${sql.ref(column)})`;
}

/**
 * Raw SQL expression producing a PostGIS geometry value from a `Geometry`,
 * for use as an INSERT/UPDATE value. Typed `RawBuilder<string>` — not because
 * the runtime value is a JS string (it is whatever PostGIS's `geometry` type
 * stores), but because every geometry column's Kysely row type is declared
 * `string` for the read side (see `schema.ts`'s doc comment), and Kysely
 * requires a write expression's type to match the column's declared type.
 *
 * Wrapped in `ST_SetSRID(..., 0)`: `ST_GeomFromGeoJSON` defaults an input
 * with no explicit `crs` member to SRID 4326 (WGS84), not SRID 0 — found
 * directly, by every one of this module's own insert-path integration tests
 * failing `garden_object_geometry_srid_check` the first time this helper ran
 * against a real column with that `CHECK` (a SRID-0-typed geometry column
 * itself does not enforce a SRID via its typmod, since 0 conventionally
 * means "unspecified" to PostGIS, so nothing catches this except the
 * migration's own explicit `CHECK (ST_SRID(geometry) = 0)`). Every
 * coordinate in this schema is already garden-local planar metres, never
 * WGS84 — see ADR-0010 — so forcing SRID 0 here is correct, not a
 * workaround for bad input.
 */
export function geometryToGeoJsonInsertExpression(geometry: Geometry): RawBuilder<string> {
  return sql<string>`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 0)`;
}

/** Parses the GeoJSON text `geometrySelectExpression` produces back into a `Geometry`. */
export function parseGeometryFromGeoJson(raw: string): Geometry {
  return JSON.parse(raw) as Geometry;
}
