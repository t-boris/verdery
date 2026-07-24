-- Media derivative identity (P6-WORKER-02).
--
-- `media.media_record` already models a derivative as its own row —
-- `derived_from_media_id`/`transformation_version`, added by
-- 1785100000000_media-lifecycle-and-quotas.sql, enforced by
-- `media_record_transformation_version_requires_derivative_check`. What that
-- migration's own comment could not yet add: a real P6-WORKER-02 stage did
-- not exist yet to say WHICH derivative a given `(derived_from_media_id,
-- transformation_version)` pair identifies, when one source produces several
-- (a thumbnail, a screen preview, an optional high-resolution image, and —
-- for a raster plan — many XYZ map tiles, all from the SAME source and the
-- SAME transformation version). This migration adds that missing dimension:
-- `derivative_kind`, plus XYZ tile coordinates for the one kind that needs
-- them, and turns "regenerating the same derivative for the same source and
-- version is a safe no-op" (architecture/media-storage-and-processing.md
-- section 9: "Derivative generation is idempotent and addressed by source
-- checksum plus transformation version") into a REAL, database-enforced
-- guarantee via two partial unique indexes — the same "enforce the
-- invariant with a real CHECK/index, not just application code" posture
-- `media_record_transformation_version_requires_derivative_check` itself
-- already set.
--
-- Why `derivative_kind` is a real enumerated CHECK, unlike `job_kind`'s own
-- deliberately-open free text (1785200000000_media-processing-jobs.sql):
-- that migration's own comment left `job_kind` open because "a real
-- P6-WORKER-01 stage will need its own kind alongside it" and this session
-- had no authority to name it yet. This migration IS that later, real stage
-- for derivatives specifically — architecture section 9 names exactly four
-- kinds by name ("Small thumbnail... Standard screen preview...
-- High-resolution review image where required... Metadata-stripped
-- derivative") plus section 11's "Tile pyramids" for plans, so a closed,
-- enumerated vocabulary is now grounded in that document rather than
-- invented. ("Metadata-stripped" is not its own fifth kind: every derivative
-- this stage produces is ALWAYS metadata-stripped and orientation-normalized
-- — see this stage's own report — so it is a property of every row here,
-- not a separate kind alongside the other four.)
--
-- Idempotency addressing, concretely: two partial unique indexes below cover
-- the two shapes a derivative identity takes. A non-tile derivative
-- (`thumbnail`/`screen_preview`/`high_resolution`) is unique per
-- `(derived_from_media_id, transformation_version, derivative_kind)` — one
-- row per kind per version. A tile is unique per `(derived_from_media_id,
-- transformation_version, tile_zoom_level, tile_x, tile_y)` — one row per
-- tile coordinate per version, `derivative_kind = 'tile'` implied by the
-- index's own partial predicate. Two indexes, not one, because Postgres
-- treats every NULL as distinct from every other NULL in a unique index: a
-- single index across all six columns would let an unlimited number of
-- non-tile rows (whose tile_* columns are always NULL) share the same
-- `(derived_from_media_id, transformation_version, derivative_kind)` without
-- ever conflicting, silently defeating the very guarantee this migration
-- exists to add.
--
-- Source: implementation-plan.md work package P6-WORKER-02;
--         architecture/media-storage-and-processing.md, sections
--         "9. Image Derivatives", "11. Plan Documents".

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE media.media_record
  ADD COLUMN derivative_kind text,
  ADD COLUMN tile_zoom_level integer,
  ADD COLUMN tile_x integer,
  ADD COLUMN tile_y integer;

ALTER TABLE media.media_record
  ADD CONSTRAINT media_record_derivative_kind_requires_derivative_check
    CHECK (derivative_kind IS NULL OR derived_from_media_id IS NOT NULL),
  -- Every derivative row this stage produces carries a transformation
  -- version alongside its kind — the idempotency key described above is
  -- meaningless without it. Tighter than the pre-existing
  -- `media_record_transformation_version_requires_derivative_check` (which
  -- only requires the REVERSE direction: a version implies a derivative, not
  -- that a derivative implies a version), because THIS migration's own
  -- unique indexes below need both columns set together to do their job.
  ADD CONSTRAINT media_record_derivative_kind_requires_version_check
    CHECK (derivative_kind IS NULL OR transformation_version IS NOT NULL),
  ADD CONSTRAINT media_record_derivative_kind_check
    CHECK (derivative_kind IS NULL OR derivative_kind IN (
      'thumbnail', 'screen_preview', 'high_resolution', 'tile'
    )),
  -- All three tile columns are set together or not at all — mirrors
  -- `media_record_storage_target_pairing_check`'s own
  -- "(bucket_name IS NULL) = (object_key IS NULL)" shape, extended to three
  -- columns.
  ADD CONSTRAINT media_record_tile_coordinates_pairing_check
    CHECK (
      (tile_zoom_level IS NULL) = (tile_x IS NULL)
      AND (tile_x IS NULL) = (tile_y IS NULL)
    ),
  ADD CONSTRAINT media_record_tile_coordinates_require_tile_kind_check
    CHECK (tile_zoom_level IS NULL OR derivative_kind = 'tile'),
  ADD CONSTRAINT media_record_tile_coordinates_non_negative_check
    CHECK (
      (tile_zoom_level IS NULL)
      OR (tile_zoom_level >= 0 AND tile_x >= 0 AND tile_y >= 0)
    );

-- The idempotency guarantee itself — see this migration's own header
-- comment for why two partial indexes, not one.
CREATE UNIQUE INDEX media_record_derivative_identity_key
  ON media.media_record (derived_from_media_id, transformation_version, derivative_kind)
  WHERE derived_from_media_id IS NOT NULL AND derivative_kind IS DISTINCT FROM 'tile';

CREATE UNIQUE INDEX media_record_tile_derivative_identity_key
  ON media.media_record (
    derived_from_media_id, transformation_version, tile_zoom_level, tile_x, tile_y
  )
  WHERE derivative_kind = 'tile';

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS media.media_record_tile_derivative_identity_key;
DROP INDEX IF EXISTS media.media_record_derivative_identity_key;

ALTER TABLE media.media_record
  DROP CONSTRAINT IF EXISTS media_record_tile_coordinates_non_negative_check,
  DROP CONSTRAINT IF EXISTS media_record_tile_coordinates_require_tile_kind_check,
  DROP CONSTRAINT IF EXISTS media_record_tile_coordinates_pairing_check,
  DROP CONSTRAINT IF EXISTS media_record_derivative_kind_check,
  DROP CONSTRAINT IF EXISTS media_record_derivative_kind_requires_version_check,
  DROP CONSTRAINT IF EXISTS media_record_derivative_kind_requires_derivative_check,
  DROP COLUMN IF EXISTS tile_y,
  DROP COLUMN IF EXISTS tile_x,
  DROP COLUMN IF EXISTS tile_zoom_level,
  DROP COLUMN IF EXISTS derivative_kind;

RESET ROLE;
