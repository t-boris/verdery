-- Plants, observations, history, and manual work baseline: plant instances
-- with their photo and identification history, an append-only observation
-- and image-analysis-result trail, manual tasks, and the minimal media
-- schema every one of those attaches photos through. The two mutable
-- aggregate roots here (`plant`, `task`) each carry their own immutable
-- revision journal, following the same optimistic-concurrency pattern
-- `gardens_mapping.garden_object` and `gardens_mapping.garden` already use.
--
-- `media` here is deliberately minimal, not the full future Media module
-- (architecture/backend-modular-monolith.md, section "6.6 Media"): it is
-- exactly the stable FK target Phase 4's plant, observation, and task photo
-- attachments need, and nothing about upload authorization, verification,
-- derivatives, processing state, or retention state, which remain that
-- future module's job.
--
-- Deliberately absent: a `measurement` table (no concrete field requirements
-- exist yet for one) and a separate `garden_event`/history table (it would
-- duplicate facts already carried by `plant_revision` and `observation`).
-- Both were scoped out of this migration on purpose, not overlooked.
--
-- Source: implementation-plan.md work packages P4-DATA-01, P4-DATA-02,
--         P4-DATA-03; architecture/data-and-geospatial-design.md, sections
--         "3. Schema Ownership", "5. Time and Actors", "13. Revision Model",
--         "14. Append-Oriented Records", "19. Media Metadata";
--         architecture/backend-modular-monolith.md, section "6.6 Media".

-- Up Migration

SET ROLE verdery_migration;

-- Deliberately minimal stand-in for the future Media module (architecture/
-- backend-modular-monolith.md, section "6.6 Media"), scoped to exactly what
-- Phase 4's plant, observation, and task attachments need: a stable row to
-- point a foreign key at. `storage_reference` is an opaque pointer only —
-- what it actually resolves to is that future module's concern, not this
-- one's. Explicitly NOT here: upload authorization, verification,
-- derivatives, processing state, or retention state (architecture/
-- data-and-geospatial-design.md, section "19. Media Metadata" lists what the
-- real module will eventually carry). No UPDATE path: every row is
-- immutable after insert in this minimal slice.
CREATE TABLE media.media_record (
  id uuid PRIMARY KEY,
  storage_reference text NOT NULL,
  mime_type text NOT NULL,
  uploaded_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Source: implementation-plan.md work package P4-DATA-01.
--
-- No UPDATE path: a wrong entry is superseded by a new row, not edited in
-- place, since other plants may already reference it by id.
CREATE TABLE plants_inventory.taxonomy_reference (
  id uuid PRIMARY KEY,
  scientific_name text NOT NULL,
  common_name text,
  variety_name text,
  source text NOT NULL,
  -- Null for system-catalog rows, which are seeded independently of any
  -- profile; set for user-defined rows.
  created_by_profile_id uuid REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taxonomy_reference_source_check CHECK (source IN ('system_catalog', 'user_defined'))
);

-- The mutable plant aggregate root. `garden_id` is immutable after
-- creation: moving a plant to a different garden is not a supported
-- operation, only moving its map placement within the same garden is.
--
-- `lifecycle_stage` and `status` are two orthogonal fields, not one:
-- `status` governs whether the plant is active, dormant, archived, removed,
-- or dead and takes display precedence whenever it is not 'active', while
-- `lifecycle_stage` keeps tracking where the plant is in its growth cycle so
-- a plant coming out of dormancy resumes where it left off instead of
-- resetting to 'planned'.
--
-- `revision` follows the exact same optimistic-concurrency pattern as
-- `gardens_mapping.garden_object.current_revision` (see that column, and
-- architecture/data-and-geospatial-design.md, section "13. Revision Model")
-- — incremented on every accepted command and journaled below in
-- `plant_revision`, not re-explained here.
--
-- `accepted_identification_id` has no inline REFERENCES: `plant_identification`
-- (the table it points to) is created further down and itself references
-- `plant`, so the two tables have a genuine circular dependency. See the
-- deferred ALTER TABLE just after `plant_identification` below for how that
-- is resolved.
--
-- Source: implementation-plan.md work package P4-DATA-01.
CREATE TABLE plants_inventory.plant (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  garden_area_map_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  placement_map_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  display_name text NOT NULL,
  -- Nullable: an unknown, unidentified plant is always a valid state.
  taxonomy_reference_id uuid REFERENCES plants_inventory.taxonomy_reference (id),
  variety_label text,
  accepted_identification_id uuid,
  acquisition_date date,
  acquisition_date_type text,
  grouping_kind text NOT NULL DEFAULT 'individual',
  quantity integer,
  lifecycle_stage text NOT NULL DEFAULT 'planned',
  status text NOT NULL DEFAULT 'active',
  condition_note text,
  care_guidance_note text,
  revision integer NOT NULL DEFAULT 1,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_acquisition_date_type_check CHECK (
    acquisition_date_type IN ('planted', 'sown', 'acquired')
  ),
  CONSTRAINT plant_grouping_kind_check CHECK (grouping_kind IN ('individual', 'row', 'group')),
  CONSTRAINT plant_quantity_positive_check CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT plant_lifecycle_stage_check CHECK (lifecycle_stage IN (
    'planned', 'seed', 'seedling', 'transplanted', 'growing', 'flowering',
    'fruiting', 'ready_to_harvest'
  )),
  CONSTRAINT plant_status_check CHECK (
    status IN ('active', 'dormant', 'archived', 'removed', 'dead')
  )
);

-- Serves "plants in this garden, filtered by status" listing queries, the
-- same judgment `gardens_mapping.garden_object_garden_lifecycle_idx` makes
-- for garden objects.
CREATE INDEX plant_garden_status_idx ON plants_inventory.plant (garden_id, status);

-- Source: implementation-plan.md work package P4-DATA-01.
CREATE TABLE plants_inventory.plant_photo (
  id uuid PRIMARY KEY,
  plant_id uuid NOT NULL REFERENCES plants_inventory.plant (id),
  media_id uuid NOT NULL REFERENCES media.media_record (id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one primary photo per plant. `WHERE is_primary` only indexes rows
-- where it is true, so any number of non-primary photos coexist freely.
CREATE UNIQUE INDEX plant_photo_plant_primary_idx
  ON plants_inventory.plant_photo (plant_id) WHERE is_primary;

CREATE INDEX plant_photo_plant_id_idx ON plants_inventory.plant_photo (plant_id);

-- Append-only photo-ID evidence: never updated. The full suggestion
-- history — including suggestions the user never accepted — is permanently
-- retained here; which one (if any) was accepted lives on `plant.
-- accepted_identification_id`, not as a flag on this table.
--
-- Source: implementation-plan.md work package P4-DATA-01.
CREATE TABLE plants_inventory.plant_identification (
  id uuid PRIMARY KEY,
  plant_id uuid NOT NULL REFERENCES plants_inventory.plant (id),
  plant_photo_id uuid NOT NULL REFERENCES plants_inventory.plant_photo (id),
  suggested_taxonomy_id uuid REFERENCES plants_inventory.taxonomy_reference (id),
  confidence_score numeric(4,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plant_identification_plant_id_idx
  ON plants_inventory.plant_identification (plant_id);

-- Closes the circular dependency noted on `plant` above: `plant` and
-- `plant_identification` each reference the other (`plant_identification.
-- plant_id` versus `plant.accepted_identification_id`), which a single
-- CREATE TABLE cannot express both directions of. The acyclic direction
-- (`plant_identification` -> `plant`) is declared inline above; this
-- deferred ALTER TABLE closes the remaining direction now that both tables
-- exist.
ALTER TABLE plants_inventory.plant
  ADD CONSTRAINT plant_accepted_identification_id_fkey
  FOREIGN KEY (accepted_identification_id) REFERENCES plants_inventory.plant_identification (id);

-- Immutable per-plant revision journal, structurally identical to
-- `gardens_mapping.garden_object_revision` — see that table's own comment
-- for why this is written alongside (never instead of) updating `plant`'s
-- current row.
--
-- Source: implementation-plan.md work package P4-DATA-01;
--         architecture/data-and-geospatial-design.md, section
--         "13. Revision Model".
CREATE TABLE plants_inventory.plant_revision (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plant_id uuid NOT NULL REFERENCES plants_inventory.plant (id),
  revision bigint NOT NULL,
  command_type text NOT NULL,
  -- Nullable: populated only when this command changed the field.
  lifecycle_stage text,
  status text,
  actor_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_revision_plant_id_revision_key UNIQUE (plant_id, revision)
);

CREATE INDEX plant_revision_plant_id_idx ON plants_inventory.plant_revision (plant_id, revision);

-- Pure insert-only: unlike every other revisioned aggregate in this schema
-- (`garden_object`, `garden`, `plant`, `task` above and below, all of which
-- pair a mutable current row with a revision journal), `observation` has no
-- `revision` column, and no UPDATE path exists anywhere for this table. A
-- correction does not edit or supersede the original row in place — it
-- inserts a new row with `correction_kind` set and `corrects_observation_id`
-- pointing backward to the record it corrects, leaving the original
-- untouched. This is the key structural divergence from every other
-- revisioned aggregate in this codebase.
--
-- Application-layer invariant, not a database one, since it spans a child
-- table this table alone cannot see: an observation needs at least a note, a
-- condition summary, or one attached photo (`observation_photo`).
--
-- Source: implementation-plan.md work package P4-DATA-02;
--         architecture/data-and-geospatial-design.md, section
--         "14. Append-Oriented Records".
CREATE TABLE observations_history.observation (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  plant_id uuid REFERENCES plants_inventory.plant (id),
  -- For bed/area-level observations not tied to one plant.
  garden_object_id uuid REFERENCES gardens_mapping.garden_object (id),
  actor_type text NOT NULL DEFAULT 'user',
  -- Null when actor_type = 'system'.
  created_by_profile_id uuid REFERENCES identity_access.profile (id),
  note_text text,
  condition_summary text,
  -- Null for an ordinary observation.
  correction_kind text,
  -- Self-reference, set only when correction_kind is set; points backward to
  -- the corrected record.
  corrects_observation_id uuid REFERENCES observations_history.observation (id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_actor_type_check CHECK (actor_type IN ('user', 'system')),
  CONSTRAINT observation_correction_kind_check CHECK (
    correction_kind IS NULL OR correction_kind IN ('amendment', 'supersede')
  ),
  CONSTRAINT observation_correction_consistency_check CHECK (
    (correction_kind IS NULL) = (corrects_observation_id IS NULL)
  )
);

-- Serves the garden, plant, and area timeline queries P4-BE-02 requires,
-- each ordered newest-first, mirroring how
-- `gardens_mapping.calibration_background_object_id_idx` orders its own
-- revision history.
CREATE INDEX observation_garden_id_idx
  ON observations_history.observation (garden_id, observed_at DESC);
CREATE INDEX observation_plant_id_idx
  ON observations_history.observation (plant_id, observed_at DESC);
CREATE INDEX observation_garden_object_id_idx
  ON observations_history.observation (garden_object_id, observed_at DESC);

-- Source: implementation-plan.md work package P4-DATA-02.
CREATE TABLE observations_history.observation_photo (
  id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES observations_history.observation (id),
  media_id uuid NOT NULL REFERENCES media.media_record (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX observation_photo_observation_id_idx
  ON observations_history.observation_photo (observation_id);

-- `requires_confirmation = true` (the default) is the schema-level
-- enforcement that an automated diagnosis is never presented as a confirmed
-- fact without explicit user confirmation: every row starts out requiring
-- one, and nothing here flips it silently.
--
-- Source: implementation-plan.md work package P4-DATA-02.
CREATE TABLE observations_history.image_analysis_result (
  id uuid PRIMARY KEY,
  observation_photo_id uuid NOT NULL REFERENCES observations_history.observation_photo (id),
  analysis_kind text NOT NULL,
  suggested_label text NOT NULL,
  confidence_score numeric(4,3) NOT NULL,
  requires_confirmation boolean NOT NULL DEFAULT true,
  requested_additional_evidence boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_analysis_result_analysis_kind_check CHECK (
    analysis_kind IN ('stress', 'disease', 'pest', 'other')
  )
);

CREATE INDEX image_analysis_result_observation_photo_id_idx
  ON observations_history.image_analysis_result (observation_photo_id);

-- The mutable task aggregate root. `garden_id` is denormalized from the
-- target (`target_garden_area_id` / `target_plant_id`) so authorization and
-- listing queries can filter by garden alone without joining out to
-- `gardens_mapping.garden_object` or `plants_inventory.plant` first.
--
-- `revision` follows the same optimistic-concurrency pattern as `plant.
-- revision` above and `gardens_mapping.garden_object.current_revision` —
-- journaled below in `task_revision`.
--
-- Deliberately absent, both for reasons that resolve on their own later
-- timeline rather than belonging in this migration:
--   - `assigned_profile_id`: shared-care assignment is a later, explicitly
--     deferred product phase.
--   - `origin_recommendation_id`: the Recommendation entity does not exist
--     yet — Phase 4 populates only the task side of `tasks_recommendations`
--     — and a foreign key cannot target a table that does not exist.
--
-- Source: implementation-plan.md work package P4-DATA-03.
CREATE TABLE tasks_recommendations.task (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  target_kind text NOT NULL,
  target_garden_area_id uuid REFERENCES gardens_mapping.garden_object (id),
  target_plant_id uuid REFERENCES plants_inventory.plant (id),
  title text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'planned',
  due_date date,
  time_window_start timestamptz,
  time_window_end timestamptz,
  -- Stored only, not expanded or scheduled in Phase 4.
  recurrence_rule text,
  urgency text NOT NULL DEFAULT 'normal',
  source text NOT NULL DEFAULT 'manual',
  origin_observation_id uuid REFERENCES observations_history.observation (id),
  revision integer NOT NULL DEFAULT 1,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT task_target_kind_check CHECK (target_kind IN ('garden', 'garden_area', 'plant')),
  CONSTRAINT task_target_consistency_check CHECK (
    (target_kind = 'garden' AND target_garden_area_id IS NULL AND target_plant_id IS NULL)
    OR (target_kind = 'garden_area' AND target_garden_area_id IS NOT NULL AND target_plant_id IS NULL)
    OR (target_kind = 'plant' AND target_plant_id IS NOT NULL AND target_garden_area_id IS NULL)
  ),
  CONSTRAINT task_status_check CHECK (
    status IN ('planned', 'suggested', 'completed', 'skipped', 'dismissed', 'deleted')
  ),
  CONSTRAINT task_urgency_check CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT task_source_check CHECK (source IN ('manual', 'suggested'))
);

-- Serves "tasks in this garden, filtered by status" listing queries, the
-- same judgment `plant_garden_status_idx` above makes for plants.
CREATE INDEX task_garden_status_idx ON tasks_recommendations.task (garden_id, status);
CREATE INDEX task_target_garden_area_id_idx
  ON tasks_recommendations.task (target_garden_area_id) WHERE target_garden_area_id IS NOT NULL;
CREATE INDEX task_target_plant_id_idx
  ON tasks_recommendations.task (target_plant_id) WHERE target_plant_id IS NOT NULL;

-- Source: implementation-plan.md work package P4-DATA-03.
CREATE TABLE tasks_recommendations.task_attachment (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks_recommendations.task (id),
  media_id uuid NOT NULL REFERENCES media.media_record (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_attachment_task_id_idx ON tasks_recommendations.task_attachment (task_id);

-- Immutable per-task revision journal, the same shape as `plant_revision`
-- above.
--
-- Source: implementation-plan.md work package P4-DATA-03;
--         architecture/data-and-geospatial-design.md, section
--         "13. Revision Model".
CREATE TABLE tasks_recommendations.task_revision (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks_recommendations.task (id),
  revision bigint NOT NULL,
  command_type text NOT NULL,
  status text,
  due_date date,
  actor_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_revision_task_id_revision_key UNIQUE (task_id, revision)
);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS tasks_recommendations.task_revision CASCADE;
DROP TABLE IF EXISTS tasks_recommendations.task_attachment CASCADE;
DROP TABLE IF EXISTS tasks_recommendations.task CASCADE;
DROP TABLE IF EXISTS observations_history.image_analysis_result CASCADE;
DROP TABLE IF EXISTS observations_history.observation_photo CASCADE;
DROP TABLE IF EXISTS observations_history.observation CASCADE;
DROP TABLE IF EXISTS plants_inventory.plant_revision CASCADE;
DROP TABLE IF EXISTS plants_inventory.plant_identification CASCADE;
DROP TABLE IF EXISTS plants_inventory.plant_photo CASCADE;
DROP TABLE IF EXISTS plants_inventory.plant CASCADE;
DROP TABLE IF EXISTS plants_inventory.taxonomy_reference CASCADE;
DROP TABLE IF EXISTS media.media_record CASCADE;

RESET ROLE;
