-- Collaboration operations and attribution (P9A-DATA-01): completes the
-- membership and invitation skeletons P2-DATA-01 deliberately left partial,
-- adds ownership transfer as a first-class audited transition, gives tasks an
-- assignee and a completion actor, and gives the one audit log a garden scope.
--
-- This migration COMPLETES the P2 skeleton rather than replacing it. Every
-- constraint that migration wrote is still correct and is left untouched:
-- `membership_garden_profile_key`, the role and state vocabularies,
-- `invitation_token_hash_key`, and above all
-- `invitation_intended_role_check`, which keeps `owner` out of the invitation
-- vocabulary because ownership moves only through the dedicated transfer flow
-- (identity-and-authorization.md section "11. Ownership Transfer"). Tokens
-- remain hashes: no column added here stores, derives, or exposes an opaque
-- invitation token.
--
-- `collaboration.membership` ITSELF GAINS NO COLUMN, which is the honest
-- reading of the skeleton: co-ownership was already representable (nothing
-- limits a garden to one `role = 'owner'` row), the role vocabulary was
-- already complete, and the current-state row was already correct. What was
-- missing was everything AROUND it — when a grant began and ended, how
-- ownership moves, who a task belongs to, and which garden an audit record
-- concerns. Leaving the row untouched also means every existing writer
-- (`KyselyMembershipRepository.insertOwner` / `.setState`) keeps working
-- unchanged, which is what "additive migration" is supposed to buy.
--
-- WHY A PERIOD TABLE RATHER THAN VALIDITY COLUMNS. `membership` carries
-- `UNIQUE (garden_id, profile_id)` — one row per person per garden, forever.
-- Validity columns on that row can express exactly ONE interval, so a person
-- removed and later re-invited would silently overwrite the record of their
-- first stay. Preserving the interval history with validity columns would
-- require dropping that unique constraint, which is precisely the constraint
-- that makes "is this person a member right now" a single unambiguous lookup
-- for every authorization check in the service. So the intervals move to an
-- append-only child table, exactly the mutable-root-plus-immutable-journal
-- shape `gardens_mapping.garden_object_revision`, `plants_inventory.
-- plant_revision`, and `tasks_recommendations.task_revision` already use.
--
-- WHAT THE DATABASE ENFORCES, AND WHAT IT CANNOT:
--
--   * ENFORCED — at most one OPEN period per membership
--     (`membership_period_open_key`), so a person can never hold two
--     simultaneous grants; a closed period always names why it closed and an
--     open one never does; a period never ends before it starts; at most one
--     PENDING ownership transfer per garden
--     (`ownership_transfer_pending_key`); a transfer never names the same
--     profile on both sides; an accepted invitation always carries its
--     acceptance instant, and only an accepted one may name a resulting
--     membership; at most one PENDING
--     invitation per (garden, intended email); a task's assignee and its
--     assignment instant are present or absent together; completion
--     attribution requires a completion instant.
--
--   * NOT ENFORCED — THE LAST-OWNER INVARIANT ("a garden must always have at
--     least one owner unless it is in a deletion workflow",
--     identity-and-authorization.md section 11). No declarative constraint
--     can express it. A CHECK sees one row and cannot count its siblings; a
--     unique index forbids duplicates rather than REQUIRING presence; an
--     EXCLUDE constraint is also a no-duplicates rule and would need
--     `btree_gist` besides. The deletion-workflow exception makes it worse
--     still: it depends on `gardens_mapping.garden.lifecycle_state`, and
--     `collaboration.membership` deliberately no longer references that table
--     at all — P8-DELETE-01 dropped `membership_garden_id_fkey` so a
--     revocation tombstone can outlive its garden. A constraint that
--     reintroduced the coupling would undo that decision.
--
--     A trigger COULD enforce it. One is deliberately not written here: this
--     codebase has no PL/pgSQL anywhere, every invariant that spans rows is
--     an application-layer transaction, and adding business logic to the
--     database is an architecture change that belongs in a decision record,
--     not in a data migration.
--
--     WHAT THE APPLICATION MUST GUARANTEE INSTEAD, precisely. Every command
--     that removes or demotes an owner must, inside ONE transaction and
--     BEFORE writing anything:
--
--       SELECT id FROM collaboration.membership
--        WHERE garden_id = $1 AND role = 'owner' AND state = 'active'
--        ORDER BY id
--          FOR UPDATE;
--
--     then reject the command when the resulting owner set would be empty and
--     the garden is not in a deletion workflow. `FOR UPDATE` is what makes it
--     correct under concurrency rather than merely correct when tested alone:
--     two owners being demoted at the same moment would each otherwise read a
--     snapshot in which the other is still an owner, and both would commit.
--     Locking first serializes them, and the deterministic `ORDER BY id`
--     means the two transactions take the same locks in the same order, so
--     they queue instead of deadlocking. The second transaction re-evaluates
--     the predicate when it unblocks, sees the demoted row no longer matches,
--     and rejects. `tests/migrations/collaboration-operations-and-
--     attribution.test.ts` proves BOTH halves against real PostgreSQL: that
--     the schema alone accepts demoting a last owner, and that this exact
--     recipe rejects it under genuine concurrency. P9A-OWNER-01 owns the
--     command that applies it.
--
--     Also application-guaranteed, for the same "no cross-row constraint"
--     reason: that a period's role and state agree with the membership row it
--     describes; that periods are closed before the next is opened, so they
--     never overlap (the open-period index makes the sequential writer safe,
--     but a BACKDATED insert could still overlap); that every membership
--     grant, role change, removal, invitation issue/revoke/accept, and
--     ownership transfer writes its `platform.audit_event` row in the same
--     transaction; and that a task's assignee is an active member of the
--     task's garden.
--
-- WHY THE AUDIT LOG IS EXTENDED, NOT DUPLICATED. `platform.audit_event`
-- already declares itself "one generic append-only log for every audited
-- event category ... (provider link/unlink, session revocation, role and
-- membership changes, invitation lifecycle, ownership transfer, ...) rather
-- than a separate table per concern". A `collaboration.*_audit` table would
-- contradict that table's own stated purpose and split one security trail in
-- two. It carried actor, subject, and time but not GARDEN, so a
-- garden-scoped audit query had to reach into `details` jsonb — unindexable,
-- and not a schema fact. One nullable column fixes exactly that gap. It stays
-- foreign-key-free for the reason the table already documents: an audit
-- record must survive its subject's deletion.
--
-- Backfill posture: two new tables; additive nullable columns on four
-- existing tables; no constraint relaxed; no column dropped. ONE genuine
-- backfill — every membership that exists today gets the period it would
-- have had, so "who had access on date X" is answerable for gardens created
-- before this migration and not only for grants made after it.
--
-- Source: implementation-plan.md work package P9A-DATA-01;
--         architecture/identity-and-authorization.md, sections "8. Operational
--         Garden Roles", "10. Invitations", "11. Ownership Transfer",
--         "17. Security Logging";
--         architecture/collaboration-and-client-sharing.md, sections
--         "5. Operational Invitation and Co-Ownership", "6. Tasks, Work, and
--         Attribution", "19. Audit and Observability", "20. Failure and
--         Concurrency Behavior";
--         architecture/data-and-geospatial-design.md, sections "13. Revision
--         Model", "14. Append-Oriented Records".

-- Up Migration

SET ROLE verdery_migration;

-- One row per continuous stretch of one person's access to one garden at one
-- role. Append-only: a row is INSERTed when a grant begins and UPDATEd once,
-- ever, to stamp `valid_until` and `ended_reason` when it ends. Nothing else
-- rewrites it.
--
-- `garden_id` and `profile_id` are denormalized from the membership row, the
-- same judgment `tasks_recommendations.task.garden_id` already documents
-- ("denormalized from the target so authorization and listing queries can
-- filter by garden alone without joining"). Both are safe copies rather than
-- drift risks: neither column on `membership` is mutable — a membership never
-- moves to a different garden or a different person — and the immutable copy
-- is what makes the temporal question a single-table indexed range scan:
--
--   SELECT profile_id, role
--     FROM collaboration.membership_period
--    WHERE garden_id = $1
--      AND valid_from <= $2
--      AND (valid_until IS NULL OR valid_until > $2);
--
-- `garden_id` carries no foreign key, matching `membership.garden_id`, which
-- lost its own in P8-DELETE-01. `membership_id` cascades: if a membership row
-- were ever genuinely deleted, its intervals describe nothing.
--
-- `ended_reason` has exactly two values because exactly two things end a
-- grant today: the member is removed (including the bulk revocation a garden
-- deletion request performs) or their role changes. An ownership transfer
-- produces `role_changed` periods on both sides, tied together by the
-- `ownership_transfer` row below rather than by a third reason value. A value
-- nothing can produce would be untested dead vocabulary, the same judgment
-- `garden_lifecycle_state_check` made about 'deleted'.
CREATE TABLE collaboration.membership_period (
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL
    REFERENCES collaboration.membership (id) ON DELETE CASCADE,
  garden_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  role text NOT NULL,
  valid_from timestamptz NOT NULL,
  -- NULL means "still current". Exactly one such row may exist per
  -- membership; see `membership_period_open_key`.
  valid_until timestamptz,
  ended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_period_role_check CHECK (role IN ('owner', 'editor', 'viewer')),
  CONSTRAINT membership_period_ended_reason_check CHECK (
    ended_reason IN ('removed', 'role_changed')
  ),
  -- A closed period always says why it closed; an open one never does. The
  -- equivalence is what stops a half-finished close from looking like a
  -- current grant.
  CONSTRAINT membership_period_closure_check CHECK (
    (valid_until IS NULL) = (ended_reason IS NULL)
  ),
  CONSTRAINT membership_period_order_check CHECK (
    valid_until IS NULL OR valid_until >= valid_from
  )
);

-- The temporal invariant the database CAN enforce: a person never holds two
-- simultaneous grants on one garden. Opening a second period before closing
-- the first is rejected by the index rather than by a code path that could be
-- forgotten. Closed periods are unconstrained here, which is what lets a
-- re-invited member accumulate a real history.
CREATE UNIQUE INDEX membership_period_open_key
  ON collaboration.membership_period (membership_id)
  WHERE valid_until IS NULL;

-- "Who had access to this garden on date X" — the query this table exists to
-- answer.
CREATE INDEX membership_period_garden_validity_idx
  ON collaboration.membership_period (garden_id, valid_from DESC);
-- The mirror question, "which gardens could this person reach on date X",
-- which the garden-leading index above cannot serve.
CREATE INDEX membership_period_profile_validity_idx
  ON collaboration.membership_period (profile_id, valid_from DESC);
CREATE INDEX membership_period_membership_idx
  ON collaboration.membership_period (membership_id, valid_from DESC);

-- Ownership transfer as a record, not as a role UPDATE that happens to be
-- audited. The distinction is the point: a transfer is one transition with
-- two sides, and without a row for it the four membership periods it produces
-- are four unrelated role changes that no query can reassemble.
--
-- `authenticated_at` is the recent-authentication instant that satisfied
-- section 11's sensitive-action precondition. It is stored because "recent
-- auth was required" is only a claim unless the moment it was satisfied is
-- part of the record.
--
-- `from_resulting_role` says what became of the outgoing owner, and
-- deliberately excludes 'owner': a transition where the giver stays an owner
-- is a co-owner PROMOTION of the recipient, which is an ordinary role change
-- recorded by `membership_period`, not a transfer. 'removed' is included
-- because handing the garden over and leaving it is a real outcome.
--
-- The `pending` state carries no assumption about who confirms. Section 11
-- requires "explicit confirmation by policy" without saying whose, so a
-- policy needing no acceptance from the recipient simply inserts and
-- completes in one transaction, and a policy that adds recipient acceptance
-- later needs no schema change.
CREATE TABLE collaboration.ownership_transfer (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  from_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  to_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  from_resulting_role text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  authenticated_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  CONSTRAINT ownership_transfer_distinct_parties_check CHECK (
    from_profile_id <> to_profile_id
  ),
  CONSTRAINT ownership_transfer_from_resulting_role_check CHECK (
    from_resulting_role IN ('editor', 'viewer', 'removed')
  ),
  CONSTRAINT ownership_transfer_state_check CHECK (
    state IN ('pending', 'completed', 'cancelled')
  ),
  CONSTRAINT ownership_transfer_completed_linkage_check CHECK (
    (state = 'completed') = (completed_at IS NOT NULL)
  ),
  CONSTRAINT ownership_transfer_cancelled_linkage_check CHECK (
    (state = 'cancelled') = (cancelled_at IS NOT NULL)
  ),
  CONSTRAINT ownership_transfer_cancellation_reason_check CHECK (
    cancellation_reason IS NULL OR state = 'cancelled'
  ),
  CONSTRAINT ownership_transfer_authentication_order_check CHECK (
    authenticated_at <= requested_at
  )
);

-- One garden cannot have two transfers in flight. This is the schema's own
-- answer to "Concurrent role transition": the second concurrent request fails
-- on the index instead of racing the first to a contradictory outcome.
CREATE UNIQUE INDEX ownership_transfer_pending_key
  ON collaboration.ownership_transfer (garden_id)
  WHERE state = 'pending';

CREATE INDEX ownership_transfer_garden_idx
  ON collaboration.ownership_transfer (garden_id, requested_at DESC);

-- The invitation lifecycle instants the skeleton had no room for. `state`
-- alone recorded THAT an invitation was accepted or revoked but not when, and
-- not what acceptance produced.
--
-- `resulting_membership_id` closes the acceptance chain: an accepted
-- invitation names the membership it created, or — because acceptance is
-- idempotent and "Existing membership" is one of the cases section 10
-- requires it to handle — the membership that already existed. Either way a
-- replayed acceptance can be answered from the row itself.
--
-- No `expired_at`: expiry is derived from `expires_at`, which the row already
-- carries, and inventing a second timestamp for a state that time alone
-- produces would create two sources for one fact.
ALTER TABLE collaboration.invitation
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN resulting_membership_id uuid REFERENCES collaboration.membership (id);

-- Backfill before the CHECKs below can reject them. An invitation that
-- already reached a terminal state carries no instant for it, and a
-- constraint added over unrepairable rows is a migration that cannot be
-- applied twice — which is exactly what a rollback followed by a re-apply
-- does. `created_at` is the stamp because it is the only instant the row
-- actually carries and it is certainly not in the future; the alternative,
-- `now()`, would assert that a years-old revocation happened during the
-- deployment. This mirrors the deletion baseline's own backfill of
-- `recovery_deadline_at` before its linkage CHECK.
UPDATE collaboration.invitation
   SET accepted_at = created_at
 WHERE state = 'accepted' AND accepted_at IS NULL;

UPDATE collaboration.invitation
   SET revoked_at = created_at
 WHERE state = 'revoked' AND revoked_at IS NULL;

-- The membership an already-accepted invitation produced is recoverable
-- wherever the acceptor is still named: `membership_garden_profile_key` makes
-- (garden, profile) resolve to exactly one row. Where the acceptor was
-- released by an account purge it is not recoverable, which is why the CHECK
-- below is one-way rather than an equivalence.
UPDATE collaboration.invitation i
   SET resulting_membership_id = m.id
  FROM collaboration.membership m
 WHERE i.state = 'accepted'
   AND i.resulting_membership_id IS NULL
   AND i.accepted_by_profile_id IS NOT NULL
   AND m.garden_id = i.garden_id
   AND m.profile_id = i.accepted_by_profile_id;

-- Normalization is retroactive too, or the uniqueness index below would be
-- built over a column half of whose rows do not obey the rule it assumes. If
-- two pending invitations to the same garden differ only by capitalization,
-- that index creation fails loudly and an operator decides which invitation
-- survives — the honest outcome, since silently discarding one would revoke
-- somebody's live token without a record.
UPDATE collaboration.invitation
   SET intended_email = lower(intended_email)
 WHERE intended_email IS NOT NULL AND intended_email <> lower(intended_email);

-- `accepted_by_profile_id` is deliberately ABSENT from the acceptance
-- equivalence even though it is just as much a fact of acceptance.
-- P8-DELETE-01's account purge RELEASES it (`ACCOUNT_PURGE_PREPARATIONS`,
-- "collaboration.invitation.detach_accepted_by") so an invitation row
-- belonging to a surviving garden stops naming a purged person — and a CHECK
-- tying it to `state` would make that release impossible.
--
-- `resulting_membership_id` is one-way for the same family of reasons: a
-- historical acceptance whose acceptor was already released can never be
-- linked back, so requiring the link would make those rows permanently
-- unrepresentable. What the constraint still forbids is the nonsense
-- direction — an invitation that was never accepted claiming to have produced
-- a membership.
ALTER TABLE collaboration.invitation
  ADD CONSTRAINT invitation_accepted_linkage_check CHECK (
    (state = 'accepted') = (accepted_at IS NOT NULL)
  ),
  ADD CONSTRAINT invitation_resulting_membership_check CHECK (
    resulting_membership_id IS NULL OR state = 'accepted'
  ),
  ADD CONSTRAINT invitation_revoked_linkage_check CHECK (
    (state = 'revoked') = (revoked_at IS NOT NULL)
  ),
  -- Email binding compares a NORMALIZED verified email (section 10), so the
  -- stored side must already be normalized — otherwise 'A@b.test' and
  -- 'a@b.test' are two different pending invitations to the same person, and
  -- the uniqueness index below would be trivially defeated by capitalization.
  ADD CONSTRAINT invitation_intended_email_normalized_check CHECK (
    intended_email IS NULL OR intended_email = lower(intended_email)
  );

-- One outstanding invitation per person per garden. Without this, re-sending
-- an invitation leaves two live tokens for the same address, which doubles
-- the acceptance surface and makes revocation ambiguous. Terminal rows
-- (accepted, revoked, expired) are excluded, so a person can be re-invited
-- any number of times over the life of a garden.
CREATE UNIQUE INDEX invitation_pending_intended_email_key
  ON collaboration.invitation (garden_id, intended_email)
  WHERE state = 'pending' AND intended_email IS NOT NULL;

-- The expiry sweep's candidate query.
CREATE INDEX invitation_pending_expiry_idx
  ON collaboration.invitation (expires_at)
  WHERE state = 'pending';

-- Assignment and attribution. `assigned_profile_id` is the column
-- P4-DATA-03 named as "deliberately absent ... shared-care assignment is a
-- later, explicitly deferred product phase"; this is that phase.
--
-- ATTRIBUTION SURVIVES LOSS OF ACCESS BY CONSTRUCTION: both columns reference
-- `identity_access.profile`, never `collaboration.membership`. Revoking
-- access flips `membership.state` to 'removed' and touches nothing here, and
-- even an account purge minimizes the profile row to a tombstone rather than
-- deleting it (P8-DELETE-01), so "who actually did this work" stays
-- answerable after the person is gone from the garden entirely.
--
-- No equivalence between `completed_at` and `completed_by_profile_id`: the
-- existing `CompleteTask` command writes `completed_at` today and knows
-- nothing about the new column, so an equivalence would break the running
-- application — precisely the expand/contract rule
-- (docs/development/database-migrations.md). The one-way implication is true
-- of every existing row and still forbids the nonsense case: attribution
-- without a completion.
ALTER TABLE tasks_recommendations.task
  ADD COLUMN assigned_profile_id uuid REFERENCES identity_access.profile (id),
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN completed_by_profile_id uuid REFERENCES identity_access.profile (id),
  ADD CONSTRAINT task_assignment_linkage_check CHECK (
    (assigned_profile_id IS NULL) = (assigned_at IS NULL)
  ),
  ADD CONSTRAINT task_completion_attribution_check CHECK (
    completed_by_profile_id IS NULL OR completed_at IS NOT NULL
  );

-- "My assignments", the one query a shared garden adds to the task module.
CREATE INDEX task_assigned_profile_idx
  ON tasks_recommendations.task (assigned_profile_id, status)
  WHERE assigned_profile_id IS NOT NULL;

-- Assignment HISTORY needs no table of its own: `task_revision` is already
-- the immutable journal of every accepted command against a task, already
-- carries the acting profile, and already enforces one row per revision
-- (`task_revision_task_id_revision_key`) — which is also what makes
-- concurrent assignment safe, since two commands cannot both claim the same
-- next revision. It was missing only the assignee the command settled on.
ALTER TABLE tasks_recommendations.task_revision
  ADD COLUMN assigned_profile_id uuid REFERENCES identity_access.profile (id);

-- The garden an audited event concerns. Every collaboration event category is
-- garden-scoped (membership grant, role change, removal, invitation issue,
-- revoke, accept, ownership transfer), and until now the only way to ask "what
-- happened in this garden" was to search `details` jsonb.
--
-- Nullable because account-level events genuinely have no garden (provider
-- link, session revocation, account suspension). No foreign key, for the
-- reason `subject_id` next to it already gives: the record must survive its
-- subject.
ALTER TABLE platform.audit_event
  ADD COLUMN garden_id uuid;

CREATE INDEX audit_event_garden_idx
  ON platform.audit_event (garden_id, occurred_at DESC)
  WHERE garden_id IS NOT NULL;

-- Backfill: every membership that already exists gets the period it would
-- have had. Without this, "who had access on date X" answers nothing for any
-- garden created before this migration, and the table would only become
-- truthful for grants made after it.
--
-- `created_at` is the grant instant and `updated_at` is the removal instant
-- for a removed membership: the only writers of these rows are garden
-- creation (which inserts an active owner) and the revocation performed by a
-- garden deletion request, so `updated_at` on a `removed` row is exactly when
-- it was revoked.
--
-- `gen_random_uuid()` rather than the UUIDv7 the identifier strategy mandates
-- (data-and-geospatial-design.md section 4): that strategy exists so an
-- OFFLINE CLIENT can mint an id without waiting for the server, and a
-- historical backfill has no client. Nothing orders these rows by id —
-- `valid_from` is the temporal key — so the loss of v7's time prefix costs
-- nothing here.
INSERT INTO collaboration.membership_period
  (id, membership_id, garden_id, profile_id, role, valid_from, valid_until, ended_reason)
SELECT gen_random_uuid(),
       m.id,
       m.garden_id,
       m.profile_id,
       m.role,
       m.created_at,
       -- GREATEST, not a bare `updated_at`: a backfill must be incapable of
       -- producing a row its own CHECK rejects, and nothing in the schema
       -- has ever forced `updated_at >= created_at`. Every row the
       -- application writes satisfies it; a row that somehow does not gets a
       -- zero-length period rather than failing the deployment.
       CASE WHEN m.state = 'removed' THEN GREATEST(m.created_at, m.updated_at) END,
       CASE WHEN m.state = 'removed' THEN 'removed' END
  FROM collaboration.membership m;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS platform.audit_event_garden_idx;

ALTER TABLE platform.audit_event
  DROP COLUMN IF EXISTS garden_id;

ALTER TABLE tasks_recommendations.task_revision
  DROP COLUMN IF EXISTS assigned_profile_id;

DROP INDEX IF EXISTS tasks_recommendations.task_assigned_profile_idx;

ALTER TABLE tasks_recommendations.task
  DROP CONSTRAINT IF EXISTS task_completion_attribution_check,
  DROP CONSTRAINT IF EXISTS task_assignment_linkage_check,
  DROP COLUMN IF EXISTS completed_by_profile_id,
  DROP COLUMN IF EXISTS assigned_at,
  DROP COLUMN IF EXISTS assigned_profile_id;

DROP INDEX IF EXISTS collaboration.invitation_pending_expiry_idx;
DROP INDEX IF EXISTS collaboration.invitation_pending_intended_email_key;

-- An invitation that reached 'accepted' or 'revoked' under the forward
-- direction keeps its state; only the instants and the membership link go.
-- The narrower shape it returns to has no opinion about either, so nothing
-- has to be deleted to make the reverse direction apply — unlike the
-- lifecycle CHECK P8-DELETE-01 had to widen.
ALTER TABLE collaboration.invitation
  DROP CONSTRAINT IF EXISTS invitation_intended_email_normalized_check,
  DROP CONSTRAINT IF EXISTS invitation_revoked_linkage_check,
  DROP CONSTRAINT IF EXISTS invitation_resulting_membership_check,
  DROP CONSTRAINT IF EXISTS invitation_accepted_linkage_check,
  DROP COLUMN IF EXISTS resulting_membership_id,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS accepted_at;

DROP TABLE IF EXISTS collaboration.ownership_transfer CASCADE;
DROP TABLE IF EXISTS collaboration.membership_period CASCADE;

RESET ROLE;
