-- Garden map baseline: coordinate spaces, optional georeference, the hybrid
-- garden_object model with its category-specific detail tables, an
-- immutable per-object revision journal, and calibration records for
-- imported backgrounds. GiST spatial indexes and geometry validity
-- constraints ship alongside the tables they protect, not as a later pass.
--
-- Deliberately absent: a `proposal` table. `decideProposal` exists in the
-- canonical command model (packages/geometry-contracts) for forward
-- compatibility, but nothing in Phase 3 generates a proposal to decide on —
-- assisted capture arrives with Phase 10. Full plan-import asset handling
-- (the raster pipeline behind `importedBackground`) is Phase 6 scope;
-- `calibration` here only records reference points and a resulting
-- residual error, not the image asset itself.
--
-- Source: implementation-plan.md work packages P3-DATA-01, P3-DATA-02;
--         architecture/data-and-geospatial-design.md, sections
--         "7. Garden Object Model", "8. Local Coordinate Space",
--         "9. Georeferencing", "13. Revision Model";
--         architecture/map-rendering-and-editing.md, sections
--         "3. Coordinate Spaces", "4. Canonical Object Categories",
--         "16. Plan Import and Calibration".

-- Up Migration

SET ROLE verdery_migration;

-- Source: architecture/data-and-geospatial-design.md, section
-- "8. Local Coordinate Space"; ADR-0010.
CREATE TABLE gardens_mapping.coordinate_space (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  kind text NOT NULL DEFAULT 'localPlanarMetres',
  axis_convention text NOT NULL DEFAULT 'xEastYNorth',
  origin_description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Only 'localPlanarMetres' exists today; a fixed CHECK rather than an open
  -- text column because unlike identity_provider_link.provider (an external
  -- system's vocabulary), this is a value this schema itself defines and
  -- readers may rely on being exhaustive.
  CONSTRAINT coordinate_space_kind_check CHECK (kind = 'localPlanarMetres'),
  CONSTRAINT coordinate_space_axis_check CHECK (axis_convention = 'xEastYNorth')
);

-- "At least one" per the architecture doc leaves room for a future garden
-- with more than one local space; Phase 3 has exactly one, so this is
-- enforced today and revisited only if a real second-space need appears.
CREATE UNIQUE INDEX coordinate_space_garden_id_idx ON gardens_mapping.coordinate_space (garden_id);

-- Source: architecture/data-and-geospatial-design.md, section
-- "9. Georeferencing".
--
-- History-preserving, not update-in-place: "revision and validity interval"
-- in the source doc means changing georeferencing creates a new row rather
-- than overwriting the old one. The partial unique index below is what
-- enforces "exactly one current georeference per garden" while still
-- allowing history.
CREATE TABLE gardens_mapping.georeference (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  coordinate_space_id uuid NOT NULL REFERENCES gardens_mapping.coordinate_space (id),
  local_anchor geometry(Point, 0) NOT NULL,
  geographic_anchor geometry(Point, 4326) NOT NULL,
  rotation_degrees double precision NOT NULL DEFAULT 0,
  scale_correction double precision NOT NULL DEFAULT 1,
  accuracy_metres double precision,
  provenance text NOT NULL,
  method text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT georeference_local_anchor_srid_check CHECK (ST_SRID(local_anchor) = 0),
  CONSTRAINT georeference_geographic_anchor_srid_check CHECK (ST_SRID(geographic_anchor) = 4326),
  CONSTRAINT georeference_scale_positive_check CHECK (scale_correction > 0)
);

CREATE UNIQUE INDEX georeference_garden_current_idx ON gardens_mapping.georeference (garden_id)
  WHERE valid_until IS NULL;

-- Source: architecture/data-and-geospatial-design.md, section
-- "7. Garden Object Model"; architecture/map-rendering-and-editing.md,
-- sections "4. Canonical Object Categories" and "5. Geometry Types".
--
-- `geometry` is PostGIS's abstract type, not a fixed subtype: categories use
-- Point, LineString, or Polygon (and their Multi- forms) as section 5's
-- table specifies, and the per-category CHECK below is where that mapping
-- is enforced, not a column-level type per category.
CREATE TABLE gardens_mapping.garden_object (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  coordinate_space_id uuid NOT NULL REFERENCES gardens_mapping.coordinate_space (id),
  category text NOT NULL,
  geometry geometry(Geometry, 0) NOT NULL,
  label text,
  provenance text NOT NULL,
  -- 0..1 where the source supplies one; NULL means "not expressed," not
  -- "certain" — matching GeometryEnvelope.confidence in geometry-contracts.
  confidence double precision,
  lifecycle_state text NOT NULL DEFAULT 'active',
  current_revision bigint NOT NULL DEFAULT 1,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT garden_object_category_check CHECK (category IN (
    'lot', 'structure', 'fence', 'gate', 'path', 'zone', 'bed', 'waterFeature',
    'utilityExclusion', 'tree', 'plant', 'annotation', 'importedBackground'
  )),
  CONSTRAINT garden_object_provenance_check CHECK (provenance IN (
    'manualDrawing', 'userMeasurement', 'importedPlan', 'importedMapImagery',
    'arMeasurement', 'imageExtraction', 'depthCapture', 'externalProvider', 'processor'
  )),
  CONSTRAINT garden_object_lifecycle_state_check CHECK (lifecycle_state IN ('active', 'deleted')),
  CONSTRAINT garden_object_confidence_range_check CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  CONSTRAINT garden_object_geometry_valid_check CHECK (ST_IsValid(geometry)),
  CONSTRAINT garden_object_geometry_srid_check CHECK (ST_SRID(geometry) = 0),
  CONSTRAINT garden_object_geometry_type_check CHECK (
    (category IN ('lot', 'structure', 'zone', 'bed', 'waterFeature', 'utilityExclusion')
      AND GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON'))
    OR (category IN ('fence', 'path') AND GeometryType(geometry) IN ('LINESTRING', 'MULTILINESTRING'))
    OR (category = 'gate' AND GeometryType(geometry) IN ('POINT', 'LINESTRING'))
    OR (category = 'tree' AND GeometryType(geometry) = 'POINT')
    OR (category = 'plant' AND GeometryType(geometry) IN ('POINT', 'POLYGON'))
    OR (category = 'annotation' AND GeometryType(geometry) IN ('POINT', 'LINESTRING'))
    OR (category = 'importedBackground' AND GeometryType(geometry) = 'POLYGON')
  )
);

-- GiST index for spatial queries (viewport bounding-box lookups, overlap
-- checks); the two btree indexes below serve the ordinary "objects in this
-- garden" and "objects of this category in this garden" listing queries a
-- GiST index does not.
CREATE INDEX garden_object_geometry_gist_idx ON gardens_mapping.garden_object USING GIST (geometry);
CREATE INDEX garden_object_garden_lifecycle_idx
  ON gardens_mapping.garden_object (garden_id, lifecycle_state);
CREATE INDEX garden_object_garden_category_idx
  ON gardens_mapping.garden_object (garden_id, category);

-- Category-specific detail tables. One row per object of that category,
-- never more — the primary key is the object id itself, not a separate
-- surrogate, so "does this object have structure details" is an existence
-- check rather than a join condition on a nullable foreign key.
--
-- Source: architecture/data-and-geospatial-design.md, section
-- "7. Garden Object Model" ("specialized tables enforce category-specific
-- fields and relationships").

CREATE TABLE gardens_mapping.structure_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  structure_kind text NOT NULL,
  height_metres double precision,
  CONSTRAINT structure_details_kind_check CHECK (
    structure_kind IN ('house', 'shed', 'greenhouse', 'deck', 'garage', 'other')
  )
);

CREATE TABLE gardens_mapping.fence_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  fence_kind text NOT NULL,
  height_metres double precision,
  CONSTRAINT fence_details_kind_check CHECK (
    fence_kind IN ('wood', 'chainLink', 'vinyl', 'metal', 'hedge', 'other')
  )
);

-- A gate is always positioned along exactly one fence, per section 4
-- ("Positioned segment associated with a fence"). No ON DELETE CASCADE on
-- fence_object_id: deleting a fence with an attached gate must go through
-- application-level "detached gate" validation (section 11), not fall
-- through a database cascade silently.
CREATE TABLE gardens_mapping.gate_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  fence_object_id uuid NOT NULL REFERENCES gardens_mapping.garden_object (id),
  width_metres double precision
);

CREATE INDEX gate_details_fence_object_id_idx ON gardens_mapping.gate_details (fence_object_id);

CREATE TABLE gardens_mapping.zone_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  zone_kind text NOT NULL,
  CONSTRAINT zone_details_kind_check CHECK (
    zone_kind IN ('lawn', 'garden', 'mulch', 'gravel', 'groundCover', 'other')
  )
);

CREATE TABLE gardens_mapping.bed_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  bed_kind text NOT NULL,
  soil_notes text,
  CONSTRAINT bed_details_kind_check CHECK (bed_kind IN ('inGround', 'raised', 'container'))
);

-- Canopy is a second, optional geometry — section 5: "Tree canopy... Polygon
-- or circle-derived polygon" is distinct from the trunk Point that
-- garden_object.geometry already holds.
CREATE TABLE gardens_mapping.tree_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  canopy_geometry geometry(Geometry, 0),
  common_name text,
  estimated_height_metres double precision,
  estimated_spread_metres double precision,
  CONSTRAINT tree_details_canopy_valid_check CHECK (
    canopy_geometry IS NULL OR ST_IsValid(canopy_geometry)
  ),
  CONSTRAINT tree_details_canopy_srid_check CHECK (
    canopy_geometry IS NULL OR ST_SRID(canopy_geometry) = 0
  ),
  CONSTRAINT tree_details_canopy_type_check CHECK (
    canopy_geometry IS NULL OR GeometryType(canopy_geometry) IN ('POLYGON', 'MULTIPOLYGON')
  )
);

-- Deliberately without a plant-catalog reference: the species/care catalog
-- is Phase 4 scope. `assigned_to_object_id` is nullable and not constrained
-- to zone/bed by a CHECK — "assign plant to bed or zone" is an application
-- rule (garden-mapping's AssignPlant command), not something a foreign key
-- alone can express, since a foreign key cannot restrict which category the
-- referenced object belongs to.
CREATE TABLE gardens_mapping.plant_placement_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  common_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  spacing_metres double precision,
  assigned_to_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  CONSTRAINT plant_placement_details_quantity_positive_check CHECK (quantity >= 1)
);

CREATE INDEX plant_placement_details_assigned_to_idx
  ON gardens_mapping.plant_placement_details (assigned_to_object_id);

CREATE TABLE gardens_mapping.utility_exclusion_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  utility_exclusion_kind text NOT NULL,
  notes text,
  CONSTRAINT utility_exclusion_details_kind_check CHECK (
    utility_exclusion_kind IN ('undergroundUtility', 'septicField', 'wellRadius', 'setback', 'other')
  )
);

-- The "Annotation and measurement reference" category is where a
-- Measurement (packages/geometry-contracts) attaches. An ordinary object's
-- length or area is derived from its geometry at render time and is never
-- stored — only a dedicated measurement reference needs this table.
CREATE TABLE gardens_mapping.annotation_details (
  garden_object_id uuid PRIMARY KEY REFERENCES gardens_mapping.garden_object (id) ON DELETE CASCADE,
  measurement_value double precision,
  measurement_unit text,
  acquisition_method text,
  original_entry text,
  uncertainty double precision,
  reference_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  calibration_revision bigint,
  CONSTRAINT annotation_details_unit_check CHECK (
    measurement_unit IS NULL OR measurement_unit IN ('metres', 'squareMetres', 'degrees')
  ),
  CONSTRAINT annotation_details_method_check CHECK (
    acquisition_method IS NULL OR acquisition_method IN (
      'userEntered', 'derivedFromGeometry', 'arMeasurement', 'imageExtraction',
      'depthCapture', 'importedPlan'
    )
  )
);

-- Immutable per-object revision journal. Written once per accepted command,
-- alongside (never instead of) updating garden_object's current row, so
-- "what did this object look like at revision N" is answerable without
-- reconstructing it from command replay — and so an accepted proposal can be
-- undone "through revision restoration, not by deleting processing
-- history" per section 9.
--
-- Source: architecture/data-and-geospatial-design.md, section
-- "13. Revision Model" ("Writes an immutable revision snapshot").
CREATE TABLE gardens_mapping.garden_object_revision (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  garden_object_id uuid NOT NULL REFERENCES gardens_mapping.garden_object (id),
  revision bigint NOT NULL,
  command_type text NOT NULL,
  geometry geometry(Geometry, 0),
  label text,
  lifecycle_state text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT garden_object_revision_object_revision_key UNIQUE (garden_object_id, revision)
);

CREATE INDEX garden_object_revision_object_id_idx
  ON gardens_mapping.garden_object_revision (garden_object_id, revision);

-- Records only reference points and the resulting residual error, not an
-- image asset — the raster pipeline behind an imported plan is Phase 6
-- scope. Recalibration is a new row, not an update, matching "recalibration
-- creates a new background transform revision" (section 16).
CREATE TABLE gardens_mapping.calibration (
  id uuid PRIMARY KEY,
  background_object_id uuid NOT NULL REFERENCES gardens_mapping.garden_object (id),
  revision bigint NOT NULL DEFAULT 1,
  reference_points jsonb NOT NULL,
  residual_error_metres double precision,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calibration_background_revision_key UNIQUE (background_object_id, revision),
  CONSTRAINT calibration_reference_points_not_empty_check CHECK (
    jsonb_array_length(reference_points) > 0
  )
);

CREATE INDEX calibration_background_object_id_idx
  ON gardens_mapping.calibration (background_object_id, revision DESC);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS gardens_mapping.calibration CASCADE;
DROP TABLE IF EXISTS gardens_mapping.garden_object_revision CASCADE;
DROP TABLE IF EXISTS gardens_mapping.annotation_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.utility_exclusion_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.plant_placement_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.tree_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.bed_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.zone_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.gate_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.fence_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.structure_details CASCADE;
DROP TABLE IF EXISTS gardens_mapping.garden_object CASCADE;
DROP TABLE IF EXISTS gardens_mapping.georeference CASCADE;
DROP TABLE IF EXISTS gardens_mapping.coordinate_space CASCADE;

RESET ROLE;
