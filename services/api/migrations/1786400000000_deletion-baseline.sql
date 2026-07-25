-- Deletion baseline (P8-DELETE-01): the recovery window both deletion halves
-- share, the point-of-no-return states that make "a deletion request cannot
-- return to active accidentally after purge begins" a schema fact rather than
-- a code convention, and the `deletion` schema holding the purge job — which
-- is also the surviving completion evidence.
--
-- WHAT LIVES WHERE, AND WHY THERE:
--
--   * The RECOVERY WINDOW lives on the subject itself
--     (`gardens_mapping.garden.recovery_deadline_at`,
--     `identity_access.profile.recovery_deadline_at`), not in a separate
--     request table. The subject row already carries the lifecycle state the
--     window belongs to (`lifecycle_state = 'deletion_requested'`,
--     `account_state = 'deletion_requested'`), so a second row would be a
--     second source of truth for one fact — and the request command would
--     have to write two schemas atomically to keep them agreeing. One column
--     next to the state it qualifies cannot disagree with itself.
--
--   * The PURGE JOB lives in `deletion.deletion_record`, created by the sweep
--     when it claims a subject whose deadline has passed — never at request
--     time. That is what keeps the request commands inside their own modules'
--     schemas, and it makes the job row's mere existence mean exactly one
--     thing: "an irreversible purge was started for this subject".
--
--   * The COMPLETION EVIDENCE is that same row plus its per-step
--     `deletion.purge_checkpoint` children — ids, timestamps, and row COUNTS.
--     Never content. data-export-and-deletion.md section 19: "Deletion
--     completion is verifiable without retaining deleted content"; section
--     10.9: "Records non-sensitive completion evidence."
--
-- WHY `collaboration.membership` LOSES ITS GARDEN FOREIGN KEY: a revoked
-- membership row IS the offline-synchronization revocation tombstone.
-- `GetSyncChanges` decides what a client may still learn about a garden from
-- exactly this table (`listMembershipsForProfile` → `tombstoneOnlyGardenIds`),
-- so the row must outlive the garden it names or the one change that matters
-- most — the garden's own `delete` tombstone — becomes undeliverable the
-- instant the purge removes the garden row, leaving offline clients with
-- silence instead of an explicit revocation. This is precisely the reasoning
-- `platform.sync_change` already documents for having no foreign keys at all
-- ("a deletion tombstone must remain readable after the record it describes
-- no longer exists"), applied to the second table the same protocol reads.
-- The only writer of a membership row is garden creation, in the same
-- transaction that inserts the garden, so nothing is actually loosened in
-- practice.
--
-- WHY THE GARDEN ROW IS DELETED BUT THE PROFILE ROW IS NOT: ~20 NOT NULL
-- foreign keys point at `identity_access.profile` from garden CONTENT
-- (`plant.created_by_profile_id`, `garden_object_revision.actor_profile_id`,
-- `media_record.uploaded_by_profile_id`, …). A member of a SHARED garden that
-- survives their account deletion has authored rows that belong to that
-- garden, not to them, and no NOT NULL column can be nulled to release them.
-- So account purge minimizes the profile row to a tombstone and parks it in
-- the `purged` account state the state machine already ends at
-- (identity-and-authorization.md section 7:
-- `deletion_requested → disabled → purged`), rather than pretending a row
-- deletion is possible. Nothing points at `gardens_mapping.garden` that way
-- once the membership foreign key is gone, so the garden row really is
-- deleted.
--
-- `verdery_worker` deliberately gets NOTHING here, the same privilege wall
-- every sweep and the exports baseline already document: the worker
-- contributes the interval tick and its OIDC identity, and every privileged
-- read and delete runs in `services/api`.
--
-- Backfill posture: two new tables; three widening ALTERs (added nullable
-- columns, one CHECK relaxed to accept one more value); one dropped
-- constraint; and ONE genuine backfill — a garden already sitting in
-- `deletion_requested` from P2's request-only command has no deadline, so the
-- up direction stamps one from the request instant it already carries before
-- the linkage CHECK could reject it. The matching profile CHECK needs no
-- backfill: `deletion_requested`/`disabled` have had zero producers since the
-- state vocabulary was written (the only writer of `account_state` is profile
-- provisioning, which writes `pending`/`active`).
--
-- Source: implementation-plan.md work package P8-DELETE-01;
--         architecture/data-export-and-deletion.md, sections "10. Garden
--         Deletion", "11. Account Deletion", "13. Offline Clients",
--         "16. Failure and Retry", "19. Completion Criteria";
--         architecture/identity-and-authorization.md, section "7. Account States".

-- Up Migration

-- Schema creation and privilege wiring run as the CONNECTED migration
-- identity, not under SET ROLE — see the exports baseline's identical block
-- for why (`verdery_migration` owns schemas by AUTHORIZATION but holds no
-- CREATE on the database; the connected identity holds membership).
CREATE SCHEMA IF NOT EXISTS deletion AUTHORIZATION verdery_migration;

REVOKE ALL ON SCHEMA deletion FROM PUBLIC;
GRANT USAGE ON SCHEMA deletion TO verdery_application;

ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA deletion
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA deletion
  GRANT USAGE, SELECT ON SEQUENCES TO verdery_application;

SET ROLE verdery_migration;

-- One purge per subject, forever: `deletion_record_subject_key` is what makes
-- the sweep's claim idempotent (a redelivered tick inserts nothing new) and
-- what makes the row a permanent, unambiguous certificate that this exact
-- subject id was purged.
--
-- `subject_id` has no foreign key, for the reason `platform.outbox_event
-- .aggregate_id` and `platform.audit_event.subject_id` already document: the
-- evidence must remain readable after the subject is gone. For a garden the
-- subject row is genuinely deleted; for an account it survives only as a
-- minimized tombstone. `requested_by_profile_id` is likewise unreferenced —
-- the requester's own account may be purged later, and this row must not
-- become undeletable-by-proxy or start cascading.
CREATE TABLE deletion.deletion_record (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  requested_by_profile_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'purging',
  -- Copied from the subject when the sweep claims it, so the evidence still
  -- answers "was the window honored?" after the subject is unreadable.
  requested_at timestamptz NOT NULL,
  recovery_deadline_at timestamptz NOT NULL,
  purge_started_at timestamptz NOT NULL,
  completed_at timestamptz,
  -- Sweep passes that touched this purge. A purge deferred on media byte
  -- deletion is retried on later ticks; this is the honest visibility into
  -- how many that took (data-export-and-deletion.md section 17).
  attempt_count integer NOT NULL DEFAULT 0,
  -- Why the most recent pass stopped short of completion; NULL once purged.
  deferred_reason text,
  -- Media records whose byte deletion this purge handed to the established
  -- prefix-scoped deletion workflow (media-storage-and-processing.md section
  -- 16). A count, never an id list: the evidence names no deleted object.
  media_records_scheduled integer NOT NULL DEFAULT 0,
  -- Account subjects only: when the identity provider confirmed the Firebase
  -- user was deleted (section 11, "Deletes Firebase Authentication identity
  -- after application preconditions").
  identity_provider_deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deletion_record_subject_key UNIQUE (subject_type, subject_id),
  CONSTRAINT deletion_record_subject_type_check CHECK (subject_type IN ('garden', 'account')),
  -- No 'failed': a purge that cannot finish stays `purging` and retries
  -- (section 16, "Partial provider failure remains internally visible and
  -- retries"). Terminal failure is a runbook concern, not a state that would
  -- silently stop the sweep from trying again.
  CONSTRAINT deletion_record_state_check CHECK (state IN ('purging', 'purged')),
  CONSTRAINT deletion_record_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT deletion_record_media_scheduled_check CHECK (media_records_scheduled >= 0),
  CONSTRAINT deletion_record_completed_fields_check CHECK (
    state <> 'purged' OR completed_at IS NOT NULL
  )
);

-- The sweep's resume query: everything still purging, oldest claim first.
CREATE INDEX deletion_record_unfinished_idx
  ON deletion.deletion_record (purge_started_at)
  WHERE state = 'purging';

-- One row per completed purge step. Two jobs at once: the RESUME point after
-- a crash mid-purge (a recorded step is skipped on the next pass) and the
-- per-step row COUNT that makes completion verifiable without retaining a
-- single deleted value.
--
-- Re-running a step that is already recorded would be harmless anyway — every
-- step is "delete the rows matching this predicate", which converges on zero —
-- so this table is an optimization that also happens to be the evidence, not
-- a correctness crutch.
CREATE TABLE deletion.purge_checkpoint (
  deletion_id uuid NOT NULL
    REFERENCES deletion.deletion_record (id) ON DELETE CASCADE,
  step_name text NOT NULL,
  rows_deleted bigint NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (deletion_id, step_name),
  CONSTRAINT purge_checkpoint_step_name_check CHECK (step_name <> ''),
  CONSTRAINT purge_checkpoint_rows_deleted_check CHECK (rows_deleted >= 0)
);

-- The garden's own recovery window, plus the `purging` lifecycle state that
-- makes the point of no return unrepresentable-as-recoverable rather than
-- merely unchecked. No 'deleted' value: the purge removes the row.
ALTER TABLE gardens_mapping.garden
  ADD COLUMN recovery_deadline_at timestamptz;

-- Backfill before the linkage CHECK below can reject them: gardens that
-- reached `deletion_requested` under P2's request-only command have no
-- deadline, and this migration is what gives them one — anchored on the
-- request instant they already carry, so an old request gets exactly the same
-- 30 days a new one does, counted from when it was actually made.
UPDATE gardens_mapping.garden
  SET recovery_deadline_at = deletion_requested_at + interval '30 days'
  WHERE lifecycle_state = 'deletion_requested' AND recovery_deadline_at IS NULL;

ALTER TABLE gardens_mapping.garden
  DROP CONSTRAINT garden_lifecycle_state_check,
  ADD CONSTRAINT garden_lifecycle_state_check CHECK (
    lifecycle_state IN ('active', 'archived', 'deletion_requested', 'purging')
  ),
  ADD CONSTRAINT garden_recovery_deadline_linkage_check CHECK (
    (lifecycle_state IN ('deletion_requested', 'purging')) = (recovery_deadline_at IS NOT NULL)
  );

-- The sweep's candidate query: deletion-requested gardens past their deadline.
CREATE INDEX garden_recovery_deadline_idx
  ON gardens_mapping.garden (recovery_deadline_at)
  WHERE lifecycle_state = 'deletion_requested';

-- See this file's header for why a membership row must outlive its garden.
ALTER TABLE collaboration.membership
  DROP CONSTRAINT membership_garden_id_fkey;

-- A synchronization change addressed to ONE profile instead of to everyone
-- the ordinary visibility rule admits.
--
-- Revocation forces this distinction. When a garden deletion request revokes
-- a collaborator, that collaborator must receive the garden as a `delete`
-- tombstone so their offline client purges its local copy (section 13) — but
-- the OWNER, who is still an active member and is the only person who can
-- withdraw the request, must not receive that same row: applying it would
-- make the owner's own client discard the garden they are still deciding
-- about. `platform.sync_change` had no way to express "this row concerns one
-- member", so both readers matched the same row and one of them was
-- necessarily wrong.
--
-- NULL keeps the existing meaning exactly ("everyone the visibility rule
-- admits"), so every row written before this migration, and every ordinary
-- record change written after it, is unaffected. No foreign key, for the
-- reason the table's own header already gives: a tombstone must remain
-- readable after the profile or garden it names is gone.
ALTER TABLE platform.sync_change
  ADD COLUMN target_profile_id uuid;

-- The account's own recovery window and purge evidence timestamps, mirroring
-- the garden columns above one schema over.
ALTER TABLE identity_access.profile
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN recovery_deadline_at timestamptz,
  ADD COLUMN purged_at timestamptz,
  ADD CONSTRAINT profile_recovery_deadline_linkage_check CHECK (
    (account_state IN ('deletion_requested', 'disabled')) = (recovery_deadline_at IS NOT NULL)
  ),
  ADD CONSTRAINT profile_purged_at_linkage_check CHECK (
    (account_state = 'purged') = (purged_at IS NOT NULL)
  );

CREATE INDEX profile_recovery_deadline_idx
  ON identity_access.profile (recovery_deadline_at)
  WHERE account_state = 'deletion_requested';

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS identity_access.profile_recovery_deadline_idx;

ALTER TABLE identity_access.profile
  DROP CONSTRAINT IF EXISTS profile_purged_at_linkage_check,
  DROP CONSTRAINT IF EXISTS profile_recovery_deadline_linkage_check,
  DROP COLUMN IF EXISTS purged_at,
  DROP COLUMN IF EXISTS recovery_deadline_at,
  DROP COLUMN IF EXISTS deletion_requested_at;

ALTER TABLE platform.sync_change
  DROP COLUMN IF EXISTS target_profile_id;

-- Restoring the foreign key requires no orphan tombstone to remain. Rows
-- naming a purged garden are exactly the ones this migration made possible;
-- removing them is the honest reverse of having allowed them, and it costs
-- only the revocation signal for gardens that no longer exist.
DELETE FROM collaboration.membership m
  WHERE NOT EXISTS (SELECT 1 FROM gardens_mapping.garden g WHERE g.id = m.garden_id);

ALTER TABLE collaboration.membership
  ADD CONSTRAINT membership_garden_id_fkey
    FOREIGN KEY (garden_id) REFERENCES gardens_mapping.garden (id);

DROP INDEX IF EXISTS gardens_mapping.garden_recovery_deadline_idx;

-- A garden mid-purge cannot be represented by the narrower CHECK. It is
-- already unreachable and unrecoverable, so the reverse direction finishes
-- what the forward direction started rather than resurrecting it.
DELETE FROM gardens_mapping.garden WHERE lifecycle_state = 'purging';

ALTER TABLE gardens_mapping.garden
  DROP CONSTRAINT IF EXISTS garden_recovery_deadline_linkage_check,
  DROP CONSTRAINT garden_lifecycle_state_check,
  ADD CONSTRAINT garden_lifecycle_state_check CHECK (
    lifecycle_state IN ('active', 'archived', 'deletion_requested')
  );

ALTER TABLE gardens_mapping.garden
  DROP COLUMN IF EXISTS recovery_deadline_at;

DROP TABLE IF EXISTS deletion.purge_checkpoint CASCADE;
DROP TABLE IF EXISTS deletion.deletion_record CASCADE;

RESET ROLE;

-- Mirror of the exports baseline's own down posture for a module schema
-- created outside the platform loop: revoke the default privileges this
-- migration granted, then drop the schema itself, as the connected identity
-- like the up direction's schema creation.
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA deletion
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA deletion
  REVOKE USAGE, SELECT ON SEQUENCES FROM verdery_application;

DROP SCHEMA IF EXISTS deletion CASCADE;
