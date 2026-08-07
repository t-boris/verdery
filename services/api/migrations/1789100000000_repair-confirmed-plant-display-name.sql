-- Photo-created plants used to retain the literal "Unidentified plant"
-- display name after a catalog-backed identification was confirmed. Repair
-- those rows from their immutable taxonomy reference, preserving manually
-- edited names, and publish normal revision/sync entries for offline clients.

-- Up Migration

SET ROLE verdery_migration;

WITH repaired AS (
  UPDATE plants_inventory.plant AS plant
  SET display_name = COALESCE(taxonomy.common_name, taxonomy.scientific_name),
      revision = plant.revision + 1,
      updated_at = now()
  FROM plants_inventory.taxonomy_reference AS taxonomy
  WHERE plant.taxonomy_reference_id = taxonomy.id
    AND plant.display_name = 'Unidentified plant'
  RETURNING
    plant.id,
    plant.garden_id,
    plant.revision,
    plant.created_by_profile_id,
    plant.taxonomy_reference_id
), journaled AS (
  INSERT INTO plants_inventory.plant_revision (
    plant_id,
    revision,
    command_type,
    actor_profile_id,
    taxonomy_reference_id
  )
  SELECT
    id,
    revision,
    'confirmIdentificationRepair',
    created_by_profile_id,
    taxonomy_reference_id
  FROM repaired
  RETURNING plant_id
)
INSERT INTO platform.sync_change (
  garden_id,
  record_id,
  record_type,
  operation,
  record_revision
)
SELECT
  repaired.garden_id,
  repaired.id,
  'plant',
  'upsert',
  repaired.revision
FROM repaired
JOIN journaled ON journaled.plant_id = repaired.id;

RESET ROLE;

-- Down Migration

-- The previous placeholder cannot be restored safely: after this correction,
-- the same plant may have been renamed manually. Data repairs are therefore
-- intentionally forward-only.
