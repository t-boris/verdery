-- Widens `recommendation_evidence`'s evidence-kind vocabulary with
-- `seasonal_calendar` (P9D-SEASON-RULES-01): the new
-- `seasonal.sowing-window-check`, `succession.replanting-reminder`, and
-- `rotation.crop-rotation-caution` rules each cite the taxon's reviewed
-- seasonal fact (`plants_inventory.taxonomy_seasonal_fact`) as evidence, a
-- CONTEXT kind exactly like `garden_context`/`soil_moisture`/
-- `geometry_exposure` already are — no backing table row of its own (the
-- reviewed fact is snapshotted into `fact_value`, not referenced live), so
-- it joins that same "no structured reference" group in the second CHECK
-- below rather than needing a new referenced column.
--
-- No PL/pgSQL: both CHECKs are replaced whole (`DROP CONSTRAINT` + `ADD
-- CONSTRAINT` under the same name), the identical pattern
-- `1785500000000_background-calibration-transform.sql` already uses to
-- widen a CHECK's own enumerated vocabulary.
--
-- Source: tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 2 —
--         P9D-SEASON-RULES-01"; domain/recommendation-evidence.ts.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE tasks_recommendations.recommendation_evidence
  DROP CONSTRAINT recommendation_evidence_kind_check,
  ADD CONSTRAINT recommendation_evidence_kind_check CHECK (evidence_kind IN (
    'plant_identity', 'garden_context', 'weather', 'soil_moisture', 'observation',
    'task', 'lifecycle_stage', 'geometry_exposure', 'user_preference', 'seasonal_calendar'
  ));

ALTER TABLE tasks_recommendations.recommendation_evidence
  DROP CONSTRAINT recommendation_evidence_reference_consistency_check,
  ADD CONSTRAINT recommendation_evidence_reference_consistency_check CHECK (
    (evidence_kind = 'observation' AND source_observation_id IS NOT NULL
      AND source_task_id IS NULL AND source_plant_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind = 'task' AND source_task_id IS NOT NULL
      AND source_observation_id IS NULL AND source_plant_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind IN ('plant_identity', 'lifecycle_stage') AND source_plant_id IS NOT NULL
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind = 'weather' AND source_weather_record_id IS NOT NULL
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_plant_id IS NULL)
    OR (evidence_kind IN ('garden_context', 'soil_moisture', 'geometry_exposure',
        'user_preference', 'seasonal_calendar')
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_plant_id IS NULL AND source_weather_record_id IS NULL)
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE tasks_recommendations.recommendation_evidence
  DROP CONSTRAINT recommendation_evidence_reference_consistency_check,
  ADD CONSTRAINT recommendation_evidence_reference_consistency_check CHECK (
    (evidence_kind = 'observation' AND source_observation_id IS NOT NULL
      AND source_task_id IS NULL AND source_plant_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind = 'task' AND source_task_id IS NOT NULL
      AND source_observation_id IS NULL AND source_plant_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind IN ('plant_identity', 'lifecycle_stage') AND source_plant_id IS NOT NULL
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_weather_record_id IS NULL)
    OR (evidence_kind = 'weather' AND source_weather_record_id IS NOT NULL
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_plant_id IS NULL)
    OR (evidence_kind IN ('garden_context', 'soil_moisture', 'geometry_exposure',
        'user_preference')
      AND source_observation_id IS NULL AND source_task_id IS NULL
      AND source_plant_id IS NULL AND source_weather_record_id IS NULL)
  );

ALTER TABLE tasks_recommendations.recommendation_evidence
  DROP CONSTRAINT recommendation_evidence_kind_check,
  ADD CONSTRAINT recommendation_evidence_kind_check CHECK (evidence_kind IN (
    'plant_identity', 'garden_context', 'weather', 'soil_moisture', 'observation',
    'task', 'lifecycle_stage', 'geometry_exposure', 'user_preference'
  ));

RESET ROLE;
