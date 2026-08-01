-- Client-update observation publication kind (P11-SHARE-01): a third
-- stageable/publishable kind, alongside `work_log` and `media`, for
-- publishing a garden-progress observation narrative to a client —
-- implementation-plan.md's own AC wording, "Allow explicit publication of
-- selected progress observations, before/after media, and time-lapse
-- derivatives."
--
-- WHY A THIRD KIND, NOT A REUSE OF `garden_snapshot`/`timeline_entry`. Those
-- two are INLINE-COMPOSED at publish time (`PublishClientUpdateInput
-- .gardenSnapshot`/`.timelineEntries`), never staged in advance — the
-- 1786700000000 migration's own "SCOPE: WORK-LOG AND MEDIA REFERENCES ONLY"
-- header names exactly why: only those two kinds have a genuine SOURCE
-- RECORD a publisher selects FROM (a `work_log` row, a `media_record` row),
-- so only those two benefit from a staging table a publisher builds up over
-- multiple visits to a draft. An observation is the same shape: a genuine
-- `observations_history.observation` row a publisher selects from and
-- narrates, not text composed fresh at publish time. `kind = 'observation'`
-- is therefore staged exactly like `work_log`, not inline-composed like
-- `garden_snapshot`.
--
-- WHY `source_observation_id` REUSES `client_update_item.description` FOR
-- THE NARRATIVE, NOT A NEW COLUMN. `work_log`'s own shape already
-- establishes the pattern this migration follows: `source_work_log_id` is
-- PROVENANCE/VALIDATION ONLY (must resolve to a real, same-garden row), and
-- the actual client-facing text lives in the publisher-authored
-- `description` column — never a live copy of the source row's own text.
-- The identical split serves an observation exactly as well: a publisher
-- selects a real observation (proving it exists, belongs to this garden,
-- and is fit to write about) but writes their own client-safe narrative
-- rather than exposing the observation's raw `note_text`/`condition_summary`
-- verbatim, which may contain internal shorthand never intended for a
-- client. `description` is renamed nowhere — it stays one physical column
-- shared by both kinds that need free narrative text, mirroring how
-- `media_role`/`caption` are already shared columns scoped by CHECK, not by
-- one column per kind.
--
-- WHY `publication_observation_detail` GETS ITS OWN COLUMN NAME
-- (`narrative_text`), NOT `description`. Every existing detail table names
-- its one narrative column differently (`publication_work_log_detail
-- .description`, `publication_garden_snapshot_detail.overview_text`,
-- `publication_timeline_entry_detail.entry_text`) — this migration follows
-- that established "each kind's detail table names its own text column for
-- what it actually is" convention rather than reusing `description`.
--
-- `source_observation_id` on both the staging and published detail table is
-- PROVENANCE ONLY, the identical non-authoritative-lineage role
-- `publication_work_log_detail.source_work_log_id` already documents —
-- nothing may ever read it to render client content; the snapshot text is
-- the only thing ever displayed. "SNAPSHOTS ARE VALUES, NOT LIVE REACHES"
-- (1786700000000's own header) applies here unchanged.
--
-- WHY `ON DELETE SET NULL`, UNLIKE `source_work_log_id`'S PLAIN FK. This is
-- the one place this migration's design genuinely differs from `work_log`'s
-- own precedent, for a real, garden-purge-shaped reason: `collaboration
-- .work_log`/`client_update`/`publication_version`/`publication_item` are
-- ALL deliberately retained forever past a garden purge (`deletion-garden
-- -purge.test.ts`'s own `DOCUMENTED_PLAN_EXCEPTIONS`), so a plain FK from
-- `source_work_log_id` to `work_log` never meets a purge that could delete
-- its target. `observations_history.observation`, by contrast, genuinely IS
-- purged with its garden (`purge-plan.ts`'s own `GARDEN_PURGE_STEPS`) — and
-- `client_update_item`/`publication_observation_detail` are RETAINED past
-- that purge as children of the retained `client_update`/`publication_item`
-- chain. Without `ON DELETE SET NULL`, purging a garden with any staged or
-- published observation-kind item would fail outright: a plain FK cannot
-- outlive its target. `ON DELETE SET NULL` lets the purge proceed — the
-- provenance column goes stale/absent exactly the way `media_record_id`'s
-- own (FK-less) staleness is already an accepted, documented outcome for
-- media — while the actual displayed content
-- (`description`/`narrative_text`) is untouched, since neither is ever a
-- live read of the source row. `client_update_item_observation_shape_check`
-- below therefore does NOT require `source_observation_id IS NOT NULL`
-- (unlike `client_update_item_work_log_shape_check`'s `source_work_log_id`
-- requirement) — it may legitimately go null after staging, and
-- `publication_observation_detail.source_observation_id` was never NOT NULL
-- to begin with.
--
-- Source: implementation-plan.md work package P11-SHARE-01;
--         architecture/collaboration-and-client-sharing.md, sections
--         "10. Publication Workflow", "11. Publication Contents";
--         migrations/1786700000000_client-publication-and-work-logs.sql;
--         migrations/1786800000000_engagement-publisher-grant-and-client-update-items.sql.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE collaboration.client_update_item
  ADD COLUMN source_observation_id uuid
    REFERENCES observations_history.observation (id) ON DELETE SET NULL;

ALTER TABLE collaboration.client_update_item
  DROP CONSTRAINT client_update_item_kind_check,
  DROP CONSTRAINT client_update_item_work_log_shape_check,
  DROP CONSTRAINT client_update_item_media_shape_check;

ALTER TABLE collaboration.client_update_item
  ADD CONSTRAINT client_update_item_kind_check
    CHECK (kind IN ('work_log', 'media', 'observation')),
  ADD CONSTRAINT client_update_item_work_log_shape_check CHECK (
    kind <> 'work_log' OR (
      source_work_log_id IS NOT NULL
      AND description IS NOT NULL AND btrim(description) <> ''
      AND media_record_id IS NULL AND media_role IS NULL AND caption IS NULL
      AND source_observation_id IS NULL
    )
  ),
  ADD CONSTRAINT client_update_item_media_shape_check CHECK (
    kind <> 'media' OR (
      media_record_id IS NOT NULL
      AND media_role IN ('before', 'after', 'general')
      AND source_work_log_id IS NULL AND description IS NULL
      AND source_observation_id IS NULL
    )
  ),
  ADD CONSTRAINT client_update_item_observation_shape_check CHECK (
    kind <> 'observation' OR (
      description IS NOT NULL AND btrim(description) <> ''
      AND source_work_log_id IS NULL
      AND media_record_id IS NULL AND media_role IS NULL AND caption IS NULL
    )
  );

-- At most one staged reference to the same observation per draft — the same
-- "no duplicate staged source" guarantee `client_update_item_work_log_key`/
-- `client_update_item_media_key` already give their own kind.
CREATE UNIQUE INDEX client_update_item_observation_key
  ON collaboration.client_update_item (client_update_id, source_observation_id)
  WHERE source_observation_id IS NOT NULL;

ALTER TABLE collaboration.publication_item
  DROP CONSTRAINT publication_item_kind_check;

ALTER TABLE collaboration.publication_item
  ADD CONSTRAINT publication_item_kind_check
    CHECK (kind IN ('work_log', 'media', 'garden_snapshot', 'timeline_entry', 'observation'));

-- The `kind = 'observation'` detail — see this file's header for why
-- `narrative_text` is required and publisher-authored rather than a live or
-- copied reach into the source observation's own note text.
CREATE TABLE collaboration.publication_observation_detail (
  item_id uuid PRIMARY KEY REFERENCES collaboration.publication_item (id) ON DELETE CASCADE,
  narrative_text text NOT NULL,
  source_observation_id uuid
    REFERENCES observations_history.observation (id) ON DELETE SET NULL,
  CONSTRAINT publication_observation_detail_narrative_not_blank_check
    CHECK (btrim(narrative_text) <> '')
);

CREATE INDEX publication_observation_detail_source_idx
  ON collaboration.publication_observation_detail (source_observation_id)
  WHERE source_observation_id IS NOT NULL;

REVOKE UPDATE, DELETE ON collaboration.publication_observation_detail FROM verdery_application;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS collaboration.publication_observation_detail CASCADE;

ALTER TABLE collaboration.publication_item
  DROP CONSTRAINT publication_item_kind_check;

ALTER TABLE collaboration.publication_item
  ADD CONSTRAINT publication_item_kind_check
    CHECK (kind IN ('work_log', 'media', 'garden_snapshot', 'timeline_entry'));

DROP INDEX IF EXISTS collaboration.client_update_item_observation_key;

ALTER TABLE collaboration.client_update_item
  DROP CONSTRAINT client_update_item_observation_shape_check,
  DROP CONSTRAINT client_update_item_media_shape_check,
  DROP CONSTRAINT client_update_item_work_log_shape_check,
  DROP CONSTRAINT client_update_item_kind_check;

ALTER TABLE collaboration.client_update_item
  ADD CONSTRAINT client_update_item_kind_check CHECK (kind IN ('work_log', 'media')),
  ADD CONSTRAINT client_update_item_work_log_shape_check CHECK (
    kind <> 'work_log' OR (
      source_work_log_id IS NOT NULL
      AND description IS NOT NULL AND btrim(description) <> ''
      AND media_record_id IS NULL AND media_role IS NULL AND caption IS NULL
    )
  ),
  ADD CONSTRAINT client_update_item_media_shape_check CHECK (
    kind <> 'media' OR (
      media_record_id IS NOT NULL
      AND media_role IN ('before', 'after', 'general')
      AND source_work_log_id IS NULL AND description IS NULL
    )
  );

ALTER TABLE collaboration.client_update_item
  DROP COLUMN source_observation_id;

RESET ROLE;
