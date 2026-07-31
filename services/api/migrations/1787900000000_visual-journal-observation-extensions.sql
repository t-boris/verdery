-- Visual journal observation extensions (P11-MEDIA-01, first real pass):
-- purpose-labeled photos, typed measurements, and a garden-context/phenology
-- snapshot at observation time — additive columns/tables on the EXISTING
-- `observations_history.observation`/`observation_photo` tables, per
-- ADR-0016 section 3's own decision ("plant_observation*" maps onto these
-- tables, extended additively — never a new parallel table family).
--
-- WHAT THIS MIGRATION DOES NOT ADD, DELIBERATELY: structured symptoms
-- (overlaps meaningfully with `image_analysis_result`'s own AI-suggested
-- symptom data and needs its own design pass to keep user-authored and
-- AI-suggested symptom data from being confused), duplicate detection
-- (needs a new perceptual-hashing dependency, none exists in this
-- codebase), time-lapse derivatives (needs a new video-encoding
-- dependency — confirmed absent from every package.json in this repo),
-- and comparison sets (a new feature surface with no existing table or
-- API shape at all). Each is real, scoped, tracked follow-up — see
-- tasks/todo.md's own P11-MEDIA-01 review section.
--
-- `observation_photo.purpose`: the design doc's own named vocabulary
-- (architecture/plant-intelligence-and-visual-journal.md, section 8.2) —
-- whole plant, leaf front/back, stem or bark, flower, fruit, symptom
-- close-up, or a context/free-form view. NULLABLE at the schema level
-- (every row recorded before this migration has none), but the
-- application layer requires one for every NEWLY attached photo going
-- forward (`createObservationPhoto`'s own validation).
--
-- `observation_measurement`: a new child table, the design doc's own named
-- typed-measurement set ("Height, width, count, or other typed
-- measurements", section 8.1) — `kind` is a closed vocabulary of exactly
-- those three for now (an open `fact_key`-style column would let a client
-- invent an unqueryable measurement kind; widening this set later is a
-- pure additive CHECK change, the same posture `plant_fact_assertion`'s
-- own open `fact_key` explicitly rejects for a DIFFERENT reason — that
-- table's facts come from a reviewed provider, not directly from a user
-- request body). `UNIQUE (observation_id, kind)`: one height, one width,
-- one count per observation — a client resubmitting the same kind is a
-- correction, not a second measurement (the same "correction is a new
-- OBSERVATION row, never an edit" posture `observation` itself already
-- takes, one level down).
--
-- `observation.observed_phenological_stage`: reuses
-- `plants_inventory.plant.lifecycle_stage`'s OWN vocabulary verbatim,
-- deliberately — a second, subtly-different phenology vocabulary here
-- would be pure drift risk with no product benefit the design doc names
-- (section 8.1 names "phenological stage" as a concept, not a distinct
-- vocabulary). Records what stage was true AT OBSERVATION TIME, distinct
-- from the plant's own current (mutable, present-tense) `lifecycle_stage`.
--
-- `observation.observed_sun_exposure`/`observed_drainage`/
-- `observed_growing_context`: the "context snapshot" the design doc names
-- (section 8.1) — a BEST-EFFORT copy of the garden's currently-declared
-- `gardens_mapping.garden_context_fact` values at the moment the
-- observation is recorded, reusing THAT table's own three closed
-- vocabularies verbatim (`domain/garden-context-fact.ts`). Application-
-- populated, never client-supplied directly — see `record-observation.ts`.
-- Null when the garden has never declared that context kind, the same
-- "unknown stays unknown" posture every other honest-degradation column in
-- this codebase already takes; `microclimate`/`soil_type` (free-text
-- context kinds) are deliberately NOT snapshotted here, since a closed
-- CHECK constraint cannot bound free text the way it bounds the other
-- three enums, and snapshotting free text with no validation would be a
-- different, unreviewed kind of column.
--
-- Source: implementation-plan.md work package P11-MEDIA-01;
-- architecture/plant-intelligence-and-visual-journal.md, section
-- "8. Visual Plant Journal";
-- architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md,
-- section 3.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE observations_history.observation_photo
  ADD COLUMN purpose text;

ALTER TABLE observations_history.observation_photo
  ADD CONSTRAINT observation_photo_purpose_check CHECK (
    purpose IS NULL OR purpose IN (
      'whole_plant',
      'leaf_front',
      'leaf_back',
      'stem_or_bark',
      'flower',
      'fruit',
      'symptom_close_up',
      'context_or_free_form'
    )
  );

CREATE TABLE observations_history.observation_measurement (
  id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES observations_history.observation (id),
  kind text NOT NULL,
  value numeric(10, 2) NOT NULL,
  unit text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_measurement_kind_check CHECK (kind IN ('height', 'width', 'count')),
  CONSTRAINT observation_measurement_value_check CHECK (value >= 0),
  CONSTRAINT observation_measurement_unit_check CHECK (unit <> ''),
  CONSTRAINT observation_measurement_unique_kind UNIQUE (observation_id, kind)
);

CREATE INDEX observation_measurement_observation_id_idx
  ON observations_history.observation_measurement (observation_id);

ALTER TABLE observations_history.observation
  ADD COLUMN observed_phenological_stage text,
  ADD COLUMN observed_sun_exposure text,
  ADD COLUMN observed_drainage text,
  ADD COLUMN observed_growing_context text;

ALTER TABLE observations_history.observation
  ADD CONSTRAINT observation_phenological_stage_check CHECK (
    observed_phenological_stage IS NULL OR observed_phenological_stage IN (
      'planned',
      'seed',
      'seedling',
      'transplanted',
      'growing',
      'flowering',
      'fruiting',
      'ready_to_harvest'
    )
  ),
  ADD CONSTRAINT observation_sun_exposure_check CHECK (
    observed_sun_exposure IS NULL OR observed_sun_exposure IN (
      'full_sun', 'partial_sun', 'partial_shade', 'full_shade'
    )
  ),
  ADD CONSTRAINT observation_drainage_check CHECK (
    observed_drainage IS NULL OR observed_drainage IN (
      'well_drained', 'poor_drainage', 'waterlogged'
    )
  ),
  ADD CONSTRAINT observation_growing_context_check CHECK (
    observed_growing_context IS NULL OR observed_growing_context IN (
      'open_ground', 'container', 'greenhouse'
    )
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

ALTER TABLE observations_history.observation
  DROP CONSTRAINT IF EXISTS observation_growing_context_check,
  DROP CONSTRAINT IF EXISTS observation_drainage_check,
  DROP CONSTRAINT IF EXISTS observation_sun_exposure_check,
  DROP CONSTRAINT IF EXISTS observation_phenological_stage_check,
  DROP COLUMN IF EXISTS observed_growing_context,
  DROP COLUMN IF EXISTS observed_drainage,
  DROP COLUMN IF EXISTS observed_sun_exposure,
  DROP COLUMN IF EXISTS observed_phenological_stage;

DROP TABLE IF EXISTS observations_history.observation_measurement CASCADE;

ALTER TABLE observations_history.observation_photo
  DROP CONSTRAINT IF EXISTS observation_photo_purpose_check,
  DROP COLUMN IF EXISTS purpose;

RESET ROLE;
