-- Background calibration transform (P6-PLAN-02).
--
-- `gardens_mapping.calibration` (garden-map baseline, P3-DATA-02) already
-- models per-background calibration exactly the way section 16 describes:
-- one row per calibration attempt, `revision` monotonically increasing per
-- background ("recalibration creates a new background transform revision"),
-- reference points, and a `residual_error_metres` column that P3 left NULL
-- because computing it "needs a best-fit local-to-image transform" — this
-- work package. So P6-PLAN-02 EXTENDS that table rather than building a
-- parallel mechanism on the details table:
--
-- - `known_distance` (jsonb `{pointA, pointB, distanceMetres}`) is the
--   section-16 "one known-distance segment for uniform scale". Plan points
--   here and in `reference_points` are plan-fraction coordinates (pixel x
--   AND y divided by the page rendition's WIDTH, y down) — resolution
--   independent, because every derivative preserves the page's aspect
--   ratio; see packages/geometry-contracts/src/calibration.ts. NULL only
--   on legacy P3-shaped rows; every row the reworked `upsertCalibration`
--   command writes carries it.
-- - `page_aspect_ratio` (height / width, client-measured from the displayed
--   raster — the API deliberately exposes no raster dimensions) bounds plan
--   points and shapes the derived page-footprint geometry.
-- - `manual_adjustment` (jsonb `{rotationRadians, translationMetres}`) is
--   the section-16 "manual origin and orientation adjustment", stored as
--   INPUT so recalibration re-derives instead of overwriting.
-- - `metres_per_plan_unit`, `rotation_radians`, `translation_x_metres`,
--   `translation_y_metres` are the DERIVED similarity transform (uniform
--   scale + rotation + translation — deliberately not a 6-DOF affine,
--   which would absorb noise into shear and manufacture precision). All
--   four are set together or not at all (legacy rows).
-- - `point_residuals_metres` (jsonb number array, aligned with
--   `reference_points`) and the now actually-populated
--   `residual_error_metres` (aggregate RMS, NULL below two control points
--   — never a fabricated zero) are the section-16 error report.
--
-- `imported_background_details.calibration_state` widens to its promised
-- second value. The details table gains NO transform columns: the latest
-- calibration row is the single source of truth the read path joins, so
-- state and transform cannot drift apart in storage.
--
-- The reference-points CHECK is relaxed: a known-distance segment plus
-- manual placement is a legitimate calibration with zero control points,
-- so the old "at least one reference point" rule now only applies to rows
-- without a known distance (i.e. legacy-shaped rows).
--
-- Source: implementation-plan.md work package P6-PLAN-02;
--         architecture/map-rendering-and-editing.md, section
--         "16. Plan Import and Calibration";
--         architecture/garden-capture-and-scan.md, section
--         "8. Plan Import Flow".

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.calibration
  ADD COLUMN known_distance jsonb,
  ADD COLUMN page_aspect_ratio double precision,
  ADD COLUMN manual_adjustment jsonb,
  ADD COLUMN metres_per_plan_unit double precision,
  ADD COLUMN rotation_radians double precision,
  ADD COLUMN translation_x_metres double precision,
  ADD COLUMN translation_y_metres double precision,
  ADD COLUMN point_residuals_metres jsonb;

ALTER TABLE gardens_mapping.calibration
  DROP CONSTRAINT calibration_reference_points_not_empty_check,
  ADD CONSTRAINT calibration_inputs_present_check CHECK (
    known_distance IS NOT NULL OR jsonb_array_length(reference_points) > 0
  ),
  ADD CONSTRAINT calibration_page_aspect_ratio_positive_check CHECK (
    page_aspect_ratio IS NULL OR page_aspect_ratio > 0
  ),
  ADD CONSTRAINT calibration_scale_positive_check CHECK (
    metres_per_plan_unit IS NULL OR metres_per_plan_unit > 0
  ),
  -- The derived transform is atomic: a row either carries the whole
  -- similarity transform or none of it.
  ADD CONSTRAINT calibration_transform_atomic_check CHECK (
    (
      metres_per_plan_unit IS NOT NULL
      AND rotation_radians IS NOT NULL
      AND translation_x_metres IS NOT NULL
      AND translation_y_metres IS NOT NULL
      AND known_distance IS NOT NULL
      AND page_aspect_ratio IS NOT NULL
    ) OR (
      metres_per_plan_unit IS NULL
      AND rotation_radians IS NULL
      AND translation_x_metres IS NULL
      AND translation_y_metres IS NULL
    )
  );

ALTER TABLE gardens_mapping.imported_background_details
  DROP CONSTRAINT imported_background_details_calibration_state_check,
  ADD CONSTRAINT imported_background_details_calibration_state_check CHECK (
    calibration_state IN ('uncalibrated', 'calibrated')
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

-- Re-narrowing the state CHECK requires no calibrated rows to remain; the
-- rollback resets them, matching the up migration's premise that only the
-- reworked command ever produces 'calibrated'.
UPDATE gardens_mapping.imported_background_details
  SET calibration_state = 'uncalibrated'
  WHERE calibration_state <> 'uncalibrated';

ALTER TABLE gardens_mapping.imported_background_details
  DROP CONSTRAINT imported_background_details_calibration_state_check,
  ADD CONSTRAINT imported_background_details_calibration_state_check CHECK (
    calibration_state IN ('uncalibrated')
  );

-- Rows written by the reworked command may carry zero reference points,
-- which the restored CHECK forbids; they are P6-PLAN-02 data and cannot
-- survive a rollback to the P3 shape.
DELETE FROM gardens_mapping.calibration
  WHERE jsonb_array_length(reference_points) = 0;

ALTER TABLE gardens_mapping.calibration
  DROP CONSTRAINT calibration_inputs_present_check,
  DROP CONSTRAINT calibration_page_aspect_ratio_positive_check,
  DROP CONSTRAINT calibration_scale_positive_check,
  DROP CONSTRAINT calibration_transform_atomic_check,
  ADD CONSTRAINT calibration_reference_points_not_empty_check CHECK (
    jsonb_array_length(reference_points) > 0
  ),
  DROP COLUMN known_distance,
  DROP COLUMN page_aspect_ratio,
  DROP COLUMN manual_adjustment,
  DROP COLUMN metres_per_plan_unit,
  DROP COLUMN rotation_radians,
  DROP COLUMN translation_x_metres,
  DROP COLUMN translation_y_metres,
  DROP COLUMN point_residuals_metres;

RESET ROLE;
