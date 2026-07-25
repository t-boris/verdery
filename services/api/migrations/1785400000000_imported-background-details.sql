-- Imported-background details (P6-PLAN-01).
--
-- `importedBackground` has been a canonical `garden_object` category since
-- 1784800000000_garden-map-baseline.sql, but — unlike structure, fence,
-- gate, zone, bed, tree, plant, utility exclusion, and annotation — it
-- carried no category-specific detail table: nothing in the application
-- could create one yet (plan import is Phase 6 scope), so there was nothing
-- real for a table to store. P6-PLAN-01 is that stage: a background is now
-- created FROM a real `imported_plan` media record, so the category gains
-- its detail table, in exactly the shape every other detail table already
-- uses (primary key IS the object id — existence check, not a nullable
-- join; see the baseline migration's own comment on the detail tables).
--
-- Column decisions:
--
-- - `plan_media_id` is a real cross-schema foreign key to
--   `media.media_record`, the same way `plants_inventory.plant_photo.media_id`
--   already references it. No ON DELETE CASCADE: deleting a media record out
--   from under a background must fail loudly at the database (media deletion
--   is its own governed workflow — architecture/media-storage-and-processing.md
--   section 16), not silently orphan or destroy a map object.
--   Class/garden/state validation (`imported_plan`, same garden,
--   available + processed) is an application rule — a foreign key cannot
--   restrict the referenced row's class or garden, the same reasoning
--   `plant_placement_details.assigned_to_object_id`'s own comment gives.
--
-- - `source_page_number` models the plan-import flow's page-selection step
--   (architecture/garden-capture-and-scan.md section 8) honestly: 1-based,
--   NULL means "the only page" (every raster plan; a PDF defaulting to its
--   first page). PDF pages cannot render yet (P6-WORKER-02's documented
--   deferral), so this column selects, it does not yet drive rendering.
--
-- - `is_background_visible` is the Phase 6 exit criterion's "independently
--   hideable" — a per-background, persisted flag, distinct from the web
--   client's client-local layer-visibility preference (which hides every
--   imported background at once and resets on reload; see
--   apps/web/features/map/map-layers.ts).
--
-- - `calibration_state` is pinned to its one current value by CHECK, the
--   same "database-defaulted single-value column today; a future kind is a
--   migration away" posture `coordinate_space.kind`/`axis_convention`
--   already established. P6-PLAN-02 (known-distance calibration, control
--   points, residual error, transform revisions — see
--   `gardens_mapping.calibration`, which that stage builds on) widens the
--   CHECK and attaches real transform data. No transform columns exist yet
--   on purpose: an uncalibrated background HAS no transform, and a nullable
--   column pretending otherwise would be false precision
--   (architecture/map-rendering-and-editing.md section 16).
--
-- Source: implementation-plan.md work package P6-PLAN-01;
--         architecture/map-rendering-and-editing.md, section
--         "16. Plan Import and Calibration";
--         architecture/garden-capture-and-scan.md, section
--         "8. Plan Import Flow".

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE gardens_mapping.imported_background_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  plan_media_id uuid NOT NULL REFERENCES media.media_record (id),
  source_page_number integer,
  is_background_visible boolean NOT NULL DEFAULT true,
  calibration_state text NOT NULL DEFAULT 'uncalibrated',
  CONSTRAINT imported_background_details_page_number_positive_check CHECK (
    source_page_number IS NULL OR source_page_number >= 1
  ),
  CONSTRAINT imported_background_details_calibration_state_check CHECK (
    calibration_state IN ('uncalibrated')
  )
);

-- "Which backgrounds display this plan document" — the reverse lookup a
-- media-deletion workflow (P6-RET-01) will need before it can release an
-- imported plan, mirroring gate_details_fence_object_id_idx's role for the
-- equivalent gate -> fence reference.
CREATE INDEX imported_background_details_plan_media_id_idx
  ON gardens_mapping.imported_background_details (plan_media_id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS gardens_mapping.imported_background_details CASCADE;

RESET ROLE;
