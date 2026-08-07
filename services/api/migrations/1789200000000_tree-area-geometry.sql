-- Trees created in the map editor use their visible canopy/ground extent as
-- the primary geometry. Preserve legacy trunk points while allowing the
-- canonical Polygon geometry already accepted by geometry-contracts.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE gardens_mapping.garden_object
  DROP CONSTRAINT garden_object_geometry_type_check,
  ADD CONSTRAINT garden_object_geometry_type_check CHECK (
    (category IN ('lot', 'structure', 'zone', 'bed', 'waterFeature', 'utilityExclusion')
      AND GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON'))
    OR (category IN ('fence', 'path') AND GeometryType(geometry) IN ('LINESTRING', 'MULTILINESTRING'))
    OR (category = 'gate' AND GeometryType(geometry) IN ('POINT', 'LINESTRING'))
    OR (category = 'tree' AND GeometryType(geometry) IN ('POINT', 'POLYGON'))
    OR (category = 'plant' AND GeometryType(geometry) IN ('POINT', 'POLYGON'))
    OR (category = 'annotation' AND GeometryType(geometry) IN ('POINT', 'LINESTRING'))
    OR (category = 'importedBackground' AND GeometryType(geometry) = 'POLYGON')
  );

RESET ROLE;

-- Down Migration

-- Polygon trees cannot be converted back to honest trunk points. Keep the
-- permissive constraint on rollback rather than deleting or inventing data.
