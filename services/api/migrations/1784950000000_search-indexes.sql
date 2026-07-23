-- Search indexes: PostgreSQL trigram search support for approved plant and
-- garden fields.
--
-- Adds the `pg_trgm` extension and GIN trigram indexes backing fuzzy,
-- misspelling-tolerant search — `plants_inventory.plant.display_name` (the
-- new `SearchPlants` query), `plants_inventory.taxonomy_reference.
-- scientific_name` and `.common_name` (the upgraded `SearchTaxonomyReferences`,
-- replacing its previous plain `ILIKE` substring match), and `gardens_mapping.
-- garden.name` (the new `ListGardens` `nameQuery` filter).
--
-- No new tables: this migration only adds an extension and indexes to tables
-- `1784900000000_plants-observations-tasks-baseline.sql` and
-- `1784736116655_identity-and-gardens-baseline.sql` already created —
-- mirroring how `1784800000000_garden-map-baseline.sql`'s
-- `garden_object_geometry_gist_idx` adds a GiST spatial index alongside (not
-- inside) the migration that created `garden_object` itself.
--
-- `pg_trgm`, like `postgis` in `1784710800000_platform-baseline.sql`, is a
-- database-wide extension, not a per-schema one: `CREATE EXTENSION` installs
-- its objects into exactly one schema (here, `public` — the same schema
-- `postgis` itself already occupies, since neither role's `search_path` names
-- any other schema for `verdery_migration` to create into), but the
-- functions, operators, and operator classes it defines (`similarity()`, `%`,
-- `gin_trgm_ops`) are then visible unqualified to every role whose
-- `search_path` includes `public` — which every role's default `search_path`
-- (`"$user", public`) already does, the same way this schema's own PostGIS
-- functions (`ST_GeomFromText`, `ST_Distance`, ...) are already called
-- unqualified throughout this codebase without any extra grant. Unlike
-- PostGIS, no `VERSION` is pinned: `pg_trgm` is a stable, first-party
-- contrib module that ships with the PostgreSQL server itself and versions
-- alongside it, not a separately-versioned third-party extension whose
-- geometry semantics a silent upgrade could change from under the
-- application, which is the specific risk `1784710800000_platform-baseline.
-- sql`'s own version pin and version-assertion block guard against for
-- PostGIS.
--
-- This lands in its own Phase-4-search migration rather than being folded
-- into the platform baseline: the platform baseline exists to establish the
-- invariants every later migration depends on (roles, schemas, PostGIS), and
-- until this migration no column existed yet for a trigram index to target —
-- retrofitting `pg_trgm` into a migration that predates every one of these
-- columns would misrepresent when the dependency actually starts. This is
-- the same judgment `garden_object_geometry_gist_idx` already makes by living
-- with `garden_object` in the garden-map migration rather than with PostGIS
-- in the platform baseline.
--
-- Source: implementation-plan.md work package P4-SEARCH-01.

-- Up Migration

-- Installed as the connecting migration-runner identity, before `SET ROLE
-- verdery_migration` below — the same placement `1784710800000_platform-
-- baseline.sql` already uses for `CREATE EXTENSION postgis`, and for the
-- same reason: confirmed directly against a real Postgres 17 instance while
-- writing this migration that `verdery_migration` (which holds `CREATE` on
-- specific schemas only, per that migration's least-privilege design, never
-- `CREATE` on the database itself) gets `ERROR: permission denied to create
-- extension "pg_trgm" — Must have CREATE privilege on current database to
-- create this extension` if this statement runs after `SET ROLE
-- verdery_migration`. The four indexes below are still created as
-- `verdery_migration`, same as every other migration's indexes: unlike
-- installing the extension itself, creating an index only requires
-- ownership of (or an appropriate privilege on) the target table, which
-- `verdery_migration` already has for every table it created.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

SET ROLE verdery_migration;

-- Backs `SearchPlants`'s trigram match against `displayName`.
CREATE INDEX plant_display_name_trgm_idx
  ON plants_inventory.plant USING GIN (display_name gin_trgm_ops);

-- Backs the upgraded `SearchTaxonomyReferences`'s trigram match against
-- `scientificName` and `commonName` — replacing the plain `ILIKE '%query%'`
-- substring match this same read path used before this migration.
CREATE INDEX taxonomy_reference_scientific_name_trgm_idx
  ON plants_inventory.taxonomy_reference USING GIN (scientific_name gin_trgm_ops);

CREATE INDEX taxonomy_reference_common_name_trgm_idx
  ON plants_inventory.taxonomy_reference USING GIN (common_name gin_trgm_ops);

-- Backs `ListGardens`'s new `nameQuery` filter.
CREATE INDEX garden_name_trgm_idx
  ON gardens_mapping.garden USING GIN (name gin_trgm_ops);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS gardens_mapping.garden_name_trgm_idx;
DROP INDEX IF EXISTS plants_inventory.taxonomy_reference_common_name_trgm_idx;
DROP INDEX IF EXISTS plants_inventory.taxonomy_reference_scientific_name_trgm_idx;
DROP INDEX IF EXISTS plants_inventory.plant_display_name_trgm_idx;

-- `pg_trgm` is deliberately left installed — the same reasoning
-- `1784710800000_platform-baseline.sql`'s own down migration already gives
-- for leaving PostGIS installed: an extension this migration did not create
-- is not this migration's to remove, and reversing these four indexes does
-- not require reversing the availability of the trigram functions that back
-- them. Unlike PostGIS, `pg_trgm` has no dependent extensions that would make
-- `DROP EXTENSION` fail outright, but the principle is the same.

RESET ROLE;
