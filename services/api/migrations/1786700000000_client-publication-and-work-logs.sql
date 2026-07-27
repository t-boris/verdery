-- Client publication and work logs (P9C-DATA-01): the data ADR-0012's own
-- "Publication Boundary" section names but nothing in the schema has
-- represented until now — an operational work log genuinely distinct from
-- both a task (planned intent) and a client publication (external
-- presentation of SELECTED facts); the `client_update` internal_draft ->
-- ready_for_client -> published -> withdrawn state machine ADR-0012 names by
-- that exact word; the immutable `publication_version` and its per-kind
-- content snapshots a publish transaction creates; explicit per-media
-- entitlement grants; and the withdrawal state transition. This migration is
-- SCHEMA ONLY: no HTTP endpoint, no publish/withdraw command, no publisher
-- capability check. That is P9C-PUBLISH-01. What this migration must do is
-- give that future transaction every column its own six-step description
-- (collaboration-and-client-sharing.md section 10) needs without a later
-- redesign — see the per-table notes below for exactly which of those six
-- steps each table exists to serve.
--
-- Ten new tables, all in `collaboration` (already owned by this domain per
-- `backend-modular-monolith.md` section "6.8 Collaboration": "work logs,
-- client-update drafts, immutable client publications, publication grants,
-- attribution" — named there by the same words this migration uses).
-- Nothing existing is altered.
--
-- WHY TEN TABLES, NOT FEWER. Two families, split for a reason that is
-- functional, not stylistic:
--
--   MUTABLE (ordinary default grants — SELECT/INSERT/UPDATE/DELETE, exactly
--   like every other table in this schema): `work_log`, `client_update`.
--
--   IMMUTABLE ONCE WRITTEN (UPDATE and DELETE explicitly REVOKEd from
--   `verdery_application` below, so the only privilege the running service
--   ever holds on these eight tables is SELECT and INSERT):
--   `publication_version`, `publication_item`,
--   `publication_work_log_detail`, `publication_media_detail`,
--   `publication_garden_snapshot_detail`,
--   `publication_timeline_entry_detail`, `publication_staff_attribution`,
--   `media_entitlement`.
--
-- The split is what makes the REVOKE possible at all, not merely tidy:
-- `client_update` must remain writable (a draft's title, summary, and state
-- change repeatedly before publication), so no privilege can be pulled from
-- it. `publication_version` and its snapshot children are written exactly
-- once, atomically, at the moment `client_update` transitions to
-- `'published'`, and never again — collaboration-and-client-sharing.md
-- section 11's own words are "Snapshots preserve what the client saw at
-- publication time. A later operational edit cannot silently rewrite an
-- older publication." If snapshot columns lived directly on `client_update`
-- (the same row that must keep receiving ordinary UPDATEs while drafting),
-- no REVOKE could ever apply to just the frozen half of that row — Postgres
-- grants are per-TABLE, not per-column-after-a-certain-point-in-a-row's-
-- life. Separating the mutable draft from the immutable published content
-- into different tables is therefore the thing that makes "the database
-- enforces this, not only application discipline" possible in the first
-- place, for the specific fact this document calls load-bearing.
--
-- WHAT THIS BUYS OVER `task_revision`'s OWN PRECEDENT, AND WHY THAT
-- PRECEDENT WAS NOT SIMPLY REUSED. `tasks_recommendations.task_revision`
-- (Phase 4) is this codebase's existing "immutable journal" shape, and it
-- carries NO revoked grant at all — its immutability is pure application
-- discipline (nothing in `TaskRevisionJournalWriter` ever exposes an update
-- method). `work_log` below deliberately follows that SAME precedent for
-- the same reason: it is an internal operational record, corrected (if ever)
-- by a superseding row a future package may add, not by rewriting history,
-- but nothing about it is the direct evidence of what a paying client was
-- shown. `publication_version` and its children are that evidence, which is
-- exactly why THEY get the stronger, database-enforced guarantee
-- `task_revision` never needed and this table set is the first place in
-- this codebase to add: this session's own honesty convention (see the
-- P9A/P9B migrations' identical framing for the last-owner and engagement-
-- sequencing gaps) requires saying so explicitly rather than assuming a
-- REVOKE was always the obvious choice — it was not, and is applied only
-- where the "no legitimate second write, ever" property is actually true.
--
-- WHAT THE REVOKE DOES NOT, AND CANNOT, PROVE. It stops the ordinary
-- request-serving identity (`verdery_application`) from issuing a second
-- write. It does not stop `verdery_migration` (which owns every table here
-- and could ALTER or DROP it in a future migration — a reviewed schema
-- change, the only legitimate route) and it says nothing about application
-- LOGIC ever choosing to call an UPDATE in the first place; no repository
-- class is defined in this schema-only package that could, so there is no
-- code path to audit for the omission the way `CompleteTask`'s own doc
-- comment audits the absence of a `work_log` write. Both halves — the
-- database's REVOKE and the absence of an application write path — are
-- true at once and are recorded as two separate facts, not one.
--
-- WORK LOG: AN OPERATIONAL FACT, NOT A CLIENT ARTIFACT. `work_log` is what
-- `collaboration-and-client-sharing.md` section 6 calls "an immutable or
-- append-oriented fact about work that occurred" — deliberately NOT what a
-- client sees; `publication_work_log_detail` below is the client-safe
-- SNAPSHOT a publish transaction copies values into, and the two are never
-- the same row. `description` is a single free-text column, not an
-- enumerated category: no document this migration was asked to read (the
-- collaboration design, ADR-0012, or `backend-modular-monolith.md` section
-- 6.8) gives "kind of work performed" a vocabulary the way
-- `gardens_mapping.garden_object.category` or `media.media_record
-- .media_class` are each grounded in an exhaustive table from their own
-- governing document. Inventing one here would repeat exactly the mistake
-- `media_record`'s own migration comment already declined to make for
-- "purpose" alongside media class — an ungrounded vocabulary nothing reads.
-- Kept simple, and said so.
--
-- `work_log.task_id` is a PLAIN, NULLABLE reference to a task — never a
-- second revision journal. `tasks_recommendations.task_revision` already
-- records every task state transition, including completion, with its own
-- actor and timestamp; `work_log` does not duplicate that history. What
-- `task_revision` genuinely cannot hold is what this package needs: a
-- durable, potentially-publishable NARRATIVE of the work performed.
-- `CompleteTask.execute()` (`modules/tasks-recommendations/application/
-- complete-task.ts`) already accepts a `completionNote` parameter today and
-- its own doc comment says plainly that the value "has no storage target in
-- the landed migration ... Persisting it would require a schema change out
-- of this module's scope" — `work_log.description` is that column's proper
-- home. Wiring `CompleteTask` to actually write one is explicitly NOT this
-- migration's job (a schema-only package adds no command), so
-- `work_log.task_id` stays nullable both for that reason and because
-- section 6's own text requires it independently: "optionally referencing
-- the task it completed (nullable — manual entries have none)."
--
-- WHY `work_log` carries `assignment_id` ALONE, NOT A SEPARATE
-- `organization_id`. ADR-0012's own rule — "Organization membership alone
-- grants no garden access" — means organization context is never meaningful
-- on its own; it is only ever meaningful THROUGH a `garden_assignment`,
-- which already names its own `organization_id`. Storing a second copy here
-- would be exactly the kind of independently-writable, potentially-
-- divergent denormalization this schema otherwise avoids (contrast
-- `task.garden_id`, copied from an IMMUTABLE source). A household owner or
-- editor working with no service organization at all leaves `assignment_id`
-- null, which is the common case this table must support first per section
-- 6's own general (not organization-specific) framing.
--
-- CLIENT_UPDATE: THE STATE MACHINE ADR-0012 NAMES BY THIS EXACT WORD
-- ("An authorized publisher prepares a `client_update` ... publishes an
-- immutable version"). The four states and their allowed transitions —
--
--   internal_draft --submit--> ready_for_client --publish--> published --withdraw--> withdrawn
--
-- — are a strictly LINEAR sequence, unlike `client_engagement`'s own diamond
-- (draft can reach either active OR revoked). Nothing here reaches
-- `withdrawn` except from `published`, and nothing reaches `internal_draft`
-- twice. `modules/collaboration/domain/publication-state.ts` (added
-- alongside this migration) is the pure-predicate home for that sequencing
-- rule, mirroring `client-engagement-state.ts` exactly — and, just as
-- honestly, THIS migration's own CHECKs cannot enforce the sequence either,
-- for the identical structural reason the P9B migration's header already
-- gives for `client_engagement`: a CHECK sees one row, never the row's own
-- previous state. `tests/migrations/publication-state.test.ts` proves the
-- gap directly, the same way `client-engagement-state.test.ts` does for
-- engagements.
--
-- What the CHECKs below DO enforce is that a `client_update` row is
-- internally consistent for whichever state it claims: a `summary` is
-- required from `ready_for_client` onward (a content-readiness fact a
-- CHECK genuinely CAN see, since it only inspects the one row being
-- written); `submitted_at`/`published_at`/`withdrawn_at` are present or
-- absent exactly where the state diagram requires; `withdrawn_at` never
-- precedes `published_at`; and `withdrawn_reason` is confined to a
-- withdrawn row, mirroring `client_engagement.revoked_reason` exactly.
-- `published_by_profile_id` and `withdrawn_by_profile_id` are BOTH real
-- columns, not merely timestamps — collaboration-and-client-sharing.md
-- section 4.4 makes publishing "a separate capability" an organization
-- administrator or garden owner grants explicitly, so the publisher is not
-- guaranteed to be `created_by_profile_id` any more than a task's completer
-- is guaranteed to be its assignee (`task.completedByProfileId`'s own doc
-- comment makes the identical point); and this package's own instructions
-- ask withdrawal specifically to carry "its own timestamp/actor." No
-- equivalent `submitted_by_profile_id` exists: submission is not named as
-- needing a separate actor anywhere this migration was asked to read, and
-- `client_engagement.activated_at` already sets the precedent in this same
-- schema for a transition timestamp with no dedicated actor column
-- (attribution for that transition lives in `platform.audit_event`
-- instead — see this file's own closing note on audit).
--
-- PUBLICATION_VERSION: THE IMMUTABLE VERSION ITSELF. One row is created,
-- once, the instant a `client_update` reaches `'published'` — publish step
-- 3 of the six-step description ("Creates an immutable publication version
-- and item snapshots"). `client_update_id` is UNIQUE: today's state diagram
-- has no path back from `published`/`withdrawn` to `internal_draft`, so
-- there is no amendment workflow to support yet, and a real, tested
-- constraint enforcing "at most one version per update" is the honest
-- schema for that. `version_number` exists anyway (`integer NOT NULL
-- DEFAULT 1`, always 1 today) so that IF a future amendment workflow is
-- approved, it is a widened uniqueness key (`client_update_id,
-- version_number`) plus new command logic, not a column added under a
-- structure it did not fit — the same "additive, not a rewrite" posture
-- `client_engagement.stewardship_policy`'s own comment already documents
-- for itself. `client_update_revision_at_publish` records the draft's own
-- `revision` at the moment of the snapshot — the concrete fact a
-- "revision-guarded" publish (section 10) can point to later to prove which
-- draft became this version. `title`/`summary` here are independent TEXT
-- copies, not references back to `client_update.title`/`.summary` — the
-- entire point of this table's existence, restated from section 11
-- verbatim in this file's own header above.
--
-- PUBLICATION_ITEM AND ITS FOUR DETAIL TABLES: ONE DISCRIMINATED PARENT,
-- NARROW CHILDREN — mirroring `gardens_mapping.garden_object` plus its
-- category detail tables (`structure_details`, `fence_details`, ...)
-- exactly, for the same reason: `kind` plus the two fields every kind
-- genuinely shares (`garden_id`, `occurred_at`) belong on one parent table,
-- because every kind feeds ONE shared query — the factual Garden Timeline
-- (section 12.1: "composed from immutable published updates, completed-work
-- snapshots, selected media, and accepted garden snapshots with real
-- timestamps") is a single `SELECT kind, occurred_at, id FROM
-- publication_item WHERE garden_id = ? ORDER BY occurred_at` away, with no
-- UNION across four differently-shaped tables required just to reconstruct
-- the ordering. Kind-specific fields (a work-log's description, a media
-- item's role, a garden snapshot's overview, a timeline entry's narrative)
-- differ enough in shape — one references media, one is a denormalized
-- narrative, one is structured jsonb — that folding them onto one wide
-- table as ever-more nullable columns would repeat the anti-pattern
-- `garden_object`'s own design already rejected once. Table names below
-- drop the `item_` infix `garden_object`'s siblings do not need
-- (`publication_work_log_detail`, not
-- `publication_item_work_log_item_detail`) purely to keep every constraint
-- name this file writes under PostgreSQL's 63-byte identifier limit —
-- confirmed by computing the longest name in this file before writing it,
-- not assumed.
--
-- `publication_staff_attribution` is deliberately NOT a fifth `kind` on
-- `publication_item`. It shares no structural property with the other
-- four — it has no meaningful `occurred_at` (attribution is a property of
-- the PUBLICATION, not a timestamped event a Garden Timeline would ever
-- order), and its own natural key is `(publication_version_id,
-- staff_profile_id)`, closer in shape to `media_entitlement`'s own
-- `(publication_version_id, media_record_id)` than to a timeline item. Its
-- own table, exactly as narrow as it needs to be, is the honest shape.
--
-- SNAPSHOTS ARE VALUES, NOT LIVE REACHES INTO INTERNAL TABLES — WITH ONE
-- DELIBERATE, DOCUMENTED EXCEPTION PER KIND. Every display field a client
-- portal would ever render (`publication_work_log_detail.description`,
-- `publication_garden_snapshot_detail.overview_text`,
-- `publication_timeline_entry_detail.entry_text`,
-- `publication_staff_attribution.display_name`) is copied TEXT, stored on
-- the snapshot row itself — an internal edit to the source `work_log` row,
-- or a profile's display name changing later, can never retroactively alter
-- what was already published, because nothing downstream ever re-reads the
-- source for DISPLAY. `publication_work_log_detail.source_work_log_id` and
-- `media_entitlement`/`publication_media_detail`'s references to
-- `media.media_record` are the deliberate exception, and each is exactly
-- the case section 11's own instruction anticipates as legitimate: `source_
-- work_log_id` is PROVENANCE ONLY (never read to render client content —
-- `description` on the same row is the only text a portal ever shows), the
-- same non-authoritative-lineage role `task.originObservationId` and
-- `task.originRecommendationId` already play in this codebase; and media
-- BYTES are not text that can silently reword itself — the concrete
-- concern this instruction exists to prevent — they are an immutable
-- object once a derivative is registered (`registerDerivativeMediaRecord`
-- writes a row once; nothing in `modules/media` ever edits one), so
-- referencing the row is not "a live FK an internal edit could later
-- change" in the sense that phrase means for TEXT.
--
-- WHAT A PUBLICATION MUST NOT CONTAIN, AS A SCHEMA PROPERTY. Section 11's
-- prohibited list — internal tasks, assignments, notes, estimates,
-- recommendations, unaccepted geometry, drafts, sync conflicts, capture
-- proposals, raw scans, processor diagnostics, unpublished media — is
-- enforced by CONSTRUCTION wherever a table's own column set makes it
-- impossible to reach, not only by convention: `publication_item` and its
-- children have NO foreign key to `tasks_recommendations.task` (only
-- `publication_work_log_detail.source_work_log_id`, itself once-removed
-- provenance on an already-immutable fact, not a task), none to
-- `collaboration.garden_assignment`, none to any internal note or estimate
-- column (no such column exists anywhere in this schema to reference), and
-- none to `gardens_mapping.garden_object` (so unaccepted geometry, a
-- capture proposal, or an imported-plan's raw pixels cannot be selected by
-- construction — there is no column here that could hold that reference).
-- "Unpublished media" specifically is what `media_entitlement` exists to
-- prevent at the AUTHORIZATION layer (P9C-MEDIA-01's job to enforce, this
-- migration's job only to make possible) — the schema half of that
-- guarantee stops at "a publication can only reference a media row by its
-- opaque id," which says nothing yet about whether that media was ever
-- registered, verified, or intended for a client; the CONTENT-SAFETY
-- judgment ("is this specific photo appropriate to publish") is
-- irreducibly an application/publisher decision no CHECK constraint can
-- make, and is recorded here as exactly that — application-deferred, not
-- schema-enforced, the same honesty this file applies throughout.
--
-- MEDIA_ENTITLEMENT: THE AUTHORIZATION FACT, KEPT SEPARATE FROM THE DISPLAY
-- FACT. `publication_media_detail` answers "does this publication's
-- narrative show this media, and in what role" (a content/rendering
-- question); `media_entitlement` answers "may this client's ENGAGEMENT read
-- this exact media object" (an authorization question) — two different
-- questions with two different callers (P9C-API-01 renders the former,
-- P9C-MEDIA-01 checks the latter at the moment of byte access), and the
-- six-step publish description itself lists them as two SEPARATE steps
-- (3: "item snapshots"; 4: "explicit media-entitlement records"), which is
-- the concrete evidence this migration relies on to keep them two tables
-- rather than merging them. `(engagement_id, media_record_id)` is the
-- exact shape "does this client's engagement have an EXPLICIT entitlement
-- to this exact media object" needs, without re-deriving anything from
-- garden membership — the whole point section 16 makes explicitly.
--
-- WITHDRAWAL NEVER TOUCHES `media_entitlement`, AND THAT IS THE DESIGN, NOT
-- A GAP. Section 10 says withdrawal "revokes media entitlements"; this
-- schema achieves that WITHOUT an UPDATE anywhere, which is also why
-- `media_entitlement` can carry the same REVOKE UPDATE/DELETE posture as
-- every other snapshot table. A media authorization check
-- (P9C-MEDIA-01) must already join to `client_update.state` to satisfy
-- section 16's own separately-listed "Visible publication version"
-- requirement; the moment `client_update.state` becomes `'withdrawn'`,
-- that join fails and every `media_entitlement` row for its
-- `publication_version_id` becomes unreachable through the ordinary
-- authorization path, with ZERO writes against the entitlement rows
-- themselves. The row's continued EXISTENCE is what lets "does not erase
-- the publication identity or audit trail" (this package's own
-- instructions) remain true after a withdrawal — proving a client WAS
-- entitled to specific media before withdrawal is exactly the kind of
-- dispute/audit record section 18 asks this domain to preserve.
--
-- GARDEN_ID: NOT NULL, NO FOREIGN KEY, ON FOUR TABLES — `work_log`,
-- `client_update`, `publication_version`, `publication_item`. This is the
-- IDENTICAL posture `1786600000000_service-organizations-and-client-
-- engagements.sql` already gave `garden_assignment.garden_id` and
-- `client_engagement.garden_id`, for the identical reason stated there:
-- gardens are hard-deleted at purge (P8-DELETE-01), and section 18 of
-- collaboration-and-client-sharing.md asks provider records — audit,
-- dispute, legal, retention — to survive that deletion. Work performed for
-- a client and the publications that client actually saw are, if anything,
-- MORE central to that obligation than engagement/assignment metadata
-- alone, so the same posture applies here with at least equal force. All
-- four tables consequently join `DOCUMENTED_PLAN_EXCEPTIONS` in
-- `tests/integration/deletion-garden-purge.test.ts` alongside
-- `collaboration.garden_assignment` and `collaboration.client_engagement` —
-- this migration's own report is where that edit is made, not silently
-- assumed. The six detail/attribution/entitlement tables carry no
-- `garden_id` column of their own (only `publication_item.id`/
-- `publication_version.id` foreign keys, neither of which chains back to
-- `gardens_mapping.garden`), so none of them are caught by that test's
-- live-catalog sweep at all.
--
-- `publication_media_detail.media_record_id` AND `media_entitlement
-- .media_record_id` CARRY NO FOREIGN KEY, for the mirror reason:
-- `media.media_record` is ALSO a real purge step (`GARDEN_PURGE_STEPS`
-- names it), so an FK here would force a choice between breaking the purge
-- and deleting the very publication evidence section 18 asks this domain
-- to keep. `collaboration.membership.garden_id` already established, in
-- this exact codebase, that "a column must survive the referenced row's
-- eventual deletion" is solved by dropping the foreign key entirely, not by
-- `ON DELETE SET NULL` — no migration in this repository uses that clause
-- anywhere, and this one does not introduce it. `work_log.task_id` follows
-- the identical pattern for the identical reason (`tasks_recommendations
-- .task` is also purged with its garden): nullable, no foreign key,
-- referential validity at INSERT time application-guaranteed only —
-- exactly `platform.audit_event.subject_id`'s own long-standing posture.
--
-- PUBLICATION AUDIT: EXTENDS `platform.audit_event`, NO NEW TABLE.
-- `1786500000000_collaboration-operations-and-attribution.sql`'s own header
-- already made this exact case once for garden-scoped events generally
-- ("one generic append-only log ... rather than a separate table per
-- concern") and nothing about publication changes that reasoning: the
-- table already carries `garden_id` (added by that migration) and every
-- column a publication create/submit/publish/withdraw event needs —
-- `actor_profile_id`, `subject_type`/`subject_id` (`'client_update'` or
-- `'publication_version'`, the row's own id), `occurred_at`. The one fact
-- `audit_event` cannot name directly is which ENGAGEMENT an event concerns
-- — no `engagement_id` column exists on that table, and this migration
-- adds none, because `garden_id` already answers every audit QUERY this
-- package's own tests need ("what happened in this garden") and
-- `KyselyAuditLogger.record()`'s existing `details` jsonb parameter is
-- exactly where a future P9C-PUBLISH-01 command can carry `engagementId`
-- for the rows that want it — the identical role `details` already plays
-- for every other event category this table logs. A dedicated `publication
-- _audit` table was considered and rejected for the same volume/read-
-- pattern reason the P9A migration already gives: a client_update's own
-- create/submit/publish/withdraw events are, at most, four rows over that
-- row's entire lifetime — nowhere near the volume that would justify a
-- second append-only log with its own query surface, and splitting it
-- would contradict `audit_event`'s own stated purpose the same way a
-- second table would have for garden-scoped events generally.
--
-- Backfill posture: ten new tables, nothing altered, nothing backfilled —
-- every one of these tables starts empty in every environment this
-- migration will ever run against, the identical posture
-- `1786600000000_service-organizations-and-client-engagements.sql` already
-- documented for its own six tables.
--
-- Source: implementation-plan.md work package P9C-DATA-01;
--         architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
--         sections "Publication Boundary", "Time-Based Views";
--         architecture/collaboration-and-client-sharing.md, sections
--         "6. Tasks, Work, and Attribution", "10. Publication Workflow",
--         "11. Publication Contents", "12. Garden Timeline and Time
--         Machine", "16. Media Access", "18. Data Stewardship, Export, and
--         Engagement End", "19. Audit and Observability";
--         architecture/backend-modular-monolith.md, section
--         "6.8 Collaboration".

-- Up Migration

SET ROLE verdery_migration;

-- An operational fact about work performed — see this file's header,
-- "WORK LOG: AN OPERATIONAL FACT, NOT A CLIENT ARTIFACT". Immutable by
-- application discipline only (mirroring `task_revision`'s own posture, NOT
-- the REVOKE-enforced tables below) — no repository defined in this
-- schema-only package exposes an update path, and no future writer should
-- add one; a correction is a new row, not a rewrite.
CREATE TABLE collaboration.work_log (
  id uuid PRIMARY KEY,
  -- No foreign key — see this file's header, "GARDEN_ID: NOT NULL, NO
  -- FOREIGN KEY, ON FOUR TABLES".
  garden_id uuid NOT NULL,
  assignment_id uuid REFERENCES collaboration.garden_assignment (id),
  -- No foreign key — see this file's header on `work_log.task_id`.
  task_id uuid,
  actor_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  description text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_log_description_not_blank_check CHECK (btrim(description) <> '')
);

-- "This garden's work log, in time order" — the query a publisher's own
-- drafting UI and, later, the factual Garden Timeline both need.
CREATE INDEX work_log_garden_occurred_idx
  ON collaboration.work_log (garden_id, occurred_at DESC);
-- "Work logged under this specific assignment."
CREATE INDEX work_log_assignment_idx
  ON collaboration.work_log (assignment_id)
  WHERE assignment_id IS NOT NULL;
-- "Work logged against this task" — the one query this table's own
-- optional `task_id` exists to serve.
CREATE INDEX work_log_task_idx
  ON collaboration.work_log (task_id)
  WHERE task_id IS NOT NULL;

-- The `internal_draft -> ready_for_client -> published -> withdrawn` state
-- machine ADR-0012 names by this exact word — see this file's header,
-- "CLIENT_UPDATE" for the full reasoning on every column and CHECK below.
-- Ordinary default grants: this row is actively edited while drafting, so
-- nothing here is REVOKEd.
CREATE TABLE collaboration.client_update (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES collaboration.client_engagement (id),
  -- No foreign key — see this file's header.
  garden_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'internal_draft',
  title text NOT NULL,
  -- Nullable while drafting; required from `ready_for_client` onward — see
  -- `client_update_summary_required_check` below.
  summary text,
  revision bigint NOT NULL DEFAULT 1,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  submitted_at timestamptz,
  published_at timestamptz,
  -- Deliberately independent of `created_by_profile_id` — see this file's
  -- header on why the publisher and the creator are not assumed to be the
  -- same profile.
  published_by_profile_id uuid REFERENCES identity_access.profile (id),
  withdrawn_at timestamptz,
  withdrawn_by_profile_id uuid REFERENCES identity_access.profile (id),
  withdrawn_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_update_state_check CHECK (
    state IN ('internal_draft', 'ready_for_client', 'published', 'withdrawn')
  ),
  CONSTRAINT client_update_title_not_blank_check CHECK (btrim(title) <> ''),
  CONSTRAINT client_update_summary_not_blank_check CHECK (
    summary IS NULL OR btrim(summary) <> ''
  ),
  -- A content-readiness fact this CHECK genuinely can see: no summary, no
  -- review. Confined to a single row, unlike the SEQUENCING rule below it,
  -- which no CHECK can express — see this file's header.
  CONSTRAINT client_update_summary_required_check CHECK (
    state = 'internal_draft' OR summary IS NOT NULL
  ),
  CONSTRAINT client_update_submitted_linkage_check CHECK (
    submitted_at IS NOT NULL OR state = 'internal_draft'
  ),
  CONSTRAINT client_update_published_linkage_check CHECK (
    published_at IS NOT NULL OR state IN ('internal_draft', 'ready_for_client')
  ),
  CONSTRAINT client_update_published_by_linkage_check CHECK (
    (published_at IS NULL) = (published_by_profile_id IS NULL)
  ),
  -- 'withdrawn' is a true terminal reached only from 'published' and
  -- nothing un-withdraws it, so this one is a clean equivalence — mirroring
  -- `client_engagement_ended_linkage_check`'s own reasoning.
  CONSTRAINT client_update_withdrawn_linkage_check CHECK (
    (state = 'withdrawn') = (withdrawn_at IS NOT NULL)
  ),
  CONSTRAINT client_update_withdrawn_by_linkage_check CHECK (
    (withdrawn_at IS NULL) = (withdrawn_by_profile_id IS NULL)
  ),
  CONSTRAINT client_update_withdrawn_reason_check CHECK (
    withdrawn_reason IS NULL OR state = 'withdrawn'
  ),
  -- No separate "withdrawn requires published" CHECK: it would be dead
  -- weight. `client_update_published_linkage_check` already forces
  -- `published_at IS NOT NULL` for every state outside `('internal_draft',
  -- 'ready_for_client')`, and `'withdrawn'` is exactly such a state, so the
  -- narrower rule is fully implied by the broader one already written above
  -- — adding it anyway would be exactly the untested-dead-constraint
  -- mistake `garden_object_lifecycle_state_check`'s own comment already
  -- warns this codebase against, caught here by writing the isolated test
  -- for it and finding no row could ever violate it alone.
  CONSTRAINT client_update_submitted_order_check CHECK (
    submitted_at IS NULL OR published_at IS NULL OR published_at >= submitted_at
  ),
  CONSTRAINT client_update_published_order_check CHECK (
    published_at IS NULL OR withdrawn_at IS NULL OR withdrawn_at >= published_at
  )
);

-- "This engagement's updates, most recent first" — the
-- `/v1/client-engagements/{engagementId}/updates` route's own query.
CREATE INDEX client_update_engagement_idx
  ON collaboration.client_update (engagement_id, created_at DESC);
-- "This garden's updates by state" — tenant isolation's own index for the
-- garden side, scoped before any other predicate.
CREATE INDEX client_update_garden_idx
  ON collaboration.client_update (garden_id, state);

-- The immutable version itself — created exactly once, the instant a
-- `client_update` reaches `'published'`. See this file's header,
-- "PUBLICATION_VERSION" for the full reasoning on `client_update_id`'s
-- uniqueness and `version_number`'s forward-compatible presence.
CREATE TABLE collaboration.publication_version (
  id uuid PRIMARY KEY,
  client_update_id uuid NOT NULL UNIQUE REFERENCES collaboration.client_update (id),
  engagement_id uuid NOT NULL REFERENCES collaboration.client_engagement (id),
  -- No foreign key — see this file's header.
  garden_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  -- Independent TEXT copies, not references back to `client_update` — the
  -- entire point of this table's existence. See this file's header.
  title text NOT NULL,
  summary text NOT NULL,
  -- The draft's own `revision` at the moment of this snapshot — what a
  -- "revision-guarded" publish (section 10) can point to later.
  client_update_revision_at_publish bigint NOT NULL,
  published_at timestamptz NOT NULL,
  published_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_version_number_positive_check CHECK (version_number > 0),
  CONSTRAINT publication_version_title_not_blank_check CHECK (btrim(title) <> ''),
  CONSTRAINT publication_version_summary_not_blank_check CHECK (btrim(summary) <> '')
);

-- "This engagement's publications, most recent first" — the client
-- portal's own `/v1/client/gardens/{clientGardenId}/publications` query.
CREATE INDEX publication_version_engagement_idx
  ON collaboration.publication_version (engagement_id, published_at DESC);
-- "Every published update in this garden, in time order" — one of the four
-- raw ingredients the factual Garden Timeline (section 12.1) composes from
-- directly (a publication's own title/summary/published_at, not only its
-- items).
CREATE INDEX publication_version_garden_idx
  ON collaboration.publication_version (garden_id, published_at DESC);

-- Immutable once written: the only writes this table will ever legitimately
-- receive happen once, atomically, at publish time.
REVOKE UPDATE, DELETE ON collaboration.publication_version FROM verdery_application;

-- The discriminated parent for every timeline-ordered publication item —
-- see this file's header, "PUBLICATION_ITEM AND ITS FOUR DETAIL TABLES".
CREATE TABLE collaboration.publication_item (
  id uuid PRIMARY KEY,
  publication_version_id uuid NOT NULL REFERENCES collaboration.publication_version (id),
  -- No foreign key — see this file's header.
  garden_id uuid NOT NULL,
  kind text NOT NULL,
  -- The "real timestamp" every kind needs for Garden Timeline ordering
  -- (section 12.1). Deliberately absent from `publication_staff_attribution`
  -- below, which is not a timeline-ordered kind — see this file's header.
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_item_kind_check CHECK (
    kind IN ('work_log', 'media', 'garden_snapshot', 'timeline_entry')
  )
);

-- "Every item this publication contains."
CREATE INDEX publication_item_version_idx
  ON collaboration.publication_item (publication_version_id);
-- The factual Garden Timeline's own query: every item across every kind,
-- for one garden, in time order — one indexed scan, no per-kind UNION.
CREATE INDEX publication_item_garden_occurred_idx
  ON collaboration.publication_item (garden_id, occurred_at DESC);
-- At most one accepted-garden snapshot per publication — the product
-- framing ("AN accepted-garden overview or snapshot," singular) made a real,
-- cheap, database-enforced constraint rather than left as an unstated
-- assumption.
CREATE UNIQUE INDEX publication_item_garden_snapshot_key
  ON collaboration.publication_item (publication_version_id)
  WHERE kind = 'garden_snapshot';

REVOKE UPDATE, DELETE ON collaboration.publication_item FROM verdery_application;

-- The `kind = 'work_log'` detail: a denormalized TEXT snapshot, never a
-- live reach into `work_log` for display — see this file's header,
-- "SNAPSHOTS ARE VALUES, NOT LIVE REACHES". `source_work_log_id` is
-- PROVENANCE ONLY, the same non-authoritative-lineage role
-- `task.originObservationId` already plays; nothing may ever read it to
-- render client content.
CREATE TABLE collaboration.publication_work_log_detail (
  item_id uuid PRIMARY KEY REFERENCES collaboration.publication_item (id) ON DELETE CASCADE,
  description text NOT NULL,
  source_work_log_id uuid REFERENCES collaboration.work_log (id),
  CONSTRAINT publication_work_log_detail_description_not_blank_check
    CHECK (btrim(description) <> '')
);

CREATE INDEX publication_work_log_detail_source_idx
  ON collaboration.publication_work_log_detail (source_work_log_id)
  WHERE source_work_log_id IS NOT NULL;

REVOKE UPDATE, DELETE ON collaboration.publication_work_log_detail FROM verdery_application;

-- The `kind = 'media'` detail. `media_record_id` carries no foreign key —
-- see this file's header on why, and on why referencing the row is not
-- "a live reach" in the sense that matters for snapshot integrity: media
-- bytes are immutable once a derivative is registered. `media_role`
-- distinguishes the "before/after" comparison section 11 names by that
-- exact pair; `'general'` exists alongside them because a plain finished-
-- work photograph with no comparison counterpart is neither honestly, and
-- forcing one onto it would misrepresent a comparison that was never made.
CREATE TABLE collaboration.publication_media_detail (
  item_id uuid PRIMARY KEY REFERENCES collaboration.publication_item (id) ON DELETE CASCADE,
  media_record_id uuid NOT NULL,
  media_role text NOT NULL,
  caption text,
  CONSTRAINT publication_media_detail_media_role_check
    CHECK (media_role IN ('before', 'after', 'general')),
  CONSTRAINT publication_media_detail_caption_not_blank_check
    CHECK (caption IS NULL OR btrim(caption) <> '')
);

REVOKE UPDATE, DELETE ON collaboration.publication_media_detail FROM verdery_application;

-- The `kind = 'garden_snapshot'` detail: a client-safe narrative overview,
-- required, plus an OPTIONAL structured supplement (counts, area, or any
-- later-defined shape) in `snapshot_data` — nullable because no document
-- this migration was asked to read specifies that structure yet; `jsonb`
-- rather than a rigid column set for the same "do not invent an ungrounded
-- shape" discipline this file applies to `work_log.description`.
CREATE TABLE collaboration.publication_garden_snapshot_detail (
  item_id uuid PRIMARY KEY REFERENCES collaboration.publication_item (id) ON DELETE CASCADE,
  overview_text text NOT NULL,
  snapshot_data jsonb,
  CONSTRAINT publication_garden_snapshot_detail_overview_not_blank_check
    CHECK (btrim(overview_text) <> '')
);

REVOKE UPDATE, DELETE ON collaboration.publication_garden_snapshot_detail FROM verdery_application;

-- The `kind = 'timeline_entry'` detail: an explicitly curated narrative
-- fact, distinct from the OTHER three kinds this same Garden Timeline query
-- also draws from — see this file's header on why "timeline entries" is
-- its own selectable kind rather than only a derived view.
CREATE TABLE collaboration.publication_timeline_entry_detail (
  item_id uuid PRIMARY KEY REFERENCES collaboration.publication_item (id) ON DELETE CASCADE,
  entry_text text NOT NULL,
  CONSTRAINT publication_timeline_entry_detail_entry_text_not_blank_check
    CHECK (btrim(entry_text) <> '')
);

REVOKE UPDATE, DELETE ON collaboration.publication_timeline_entry_detail FROM verdery_application;

-- Staff display attribution EXPLICITLY selected for publication — never
-- every collaborator on the garden, only whoever the publisher chose to
-- name. `display_name` is a SNAPSHOT (a later profile display-name change
-- must not retroactively alter an already-published attribution), not a
-- live join to `identity_access.profile`. Not a `publication_item` kind —
-- see this file's header, "PUBLICATION_ITEM AND ITS FOUR DETAIL TABLES".
CREATE TABLE collaboration.publication_staff_attribution (
  id uuid PRIMARY KEY,
  publication_version_id uuid NOT NULL REFERENCES collaboration.publication_version (id),
  staff_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  display_name text NOT NULL,
  role_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_staff_attribution_version_profile_key
    UNIQUE (publication_version_id, staff_profile_id),
  CONSTRAINT publication_staff_attribution_display_name_not_blank_check
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT publication_staff_attribution_role_label_not_blank_check
    CHECK (role_label IS NULL OR btrim(role_label) <> '')
);

CREATE INDEX publication_staff_attribution_version_idx
  ON collaboration.publication_staff_attribution (publication_version_id);

REVOKE UPDATE, DELETE ON collaboration.publication_staff_attribution FROM verdery_application;

-- The AUTHORIZATION fact, kept separate from the DISPLAY fact
-- (`publication_media_detail`) — see this file's header,
-- "MEDIA_ENTITLEMENT". `media_record_id` carries no foreign key for the
-- same purge-survival reason `publication_media_detail.media_record_id`
-- does not. Withdrawal never writes to this table — see this file's
-- header, "WITHDRAWAL NEVER TOUCHES `media_entitlement`".
CREATE TABLE collaboration.media_entitlement (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES collaboration.client_engagement (id),
  publication_version_id uuid NOT NULL REFERENCES collaboration.publication_version (id),
  media_record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_entitlement_version_media_key UNIQUE (publication_version_id, media_record_id)
);

-- The exact authorization query section 16 describes: "does this client's
-- engagement have an EXPLICIT entitlement to this exact media object."
CREATE INDEX media_entitlement_engagement_media_idx
  ON collaboration.media_entitlement (engagement_id, media_record_id);
-- "Every entitlement this publication granted" — bookkeeping/debugging,
-- the general listing the authorization index above cannot serve on its
-- own.
CREATE INDEX media_entitlement_publication_idx
  ON collaboration.media_entitlement (publication_version_id);

REVOKE UPDATE, DELETE ON collaboration.media_entitlement FROM verdery_application;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS collaboration.media_entitlement CASCADE;
DROP TABLE IF EXISTS collaboration.publication_staff_attribution CASCADE;
DROP TABLE IF EXISTS collaboration.publication_timeline_entry_detail CASCADE;
DROP TABLE IF EXISTS collaboration.publication_garden_snapshot_detail CASCADE;
DROP TABLE IF EXISTS collaboration.publication_media_detail CASCADE;
DROP TABLE IF EXISTS collaboration.publication_work_log_detail CASCADE;
DROP TABLE IF EXISTS collaboration.publication_item CASCADE;
DROP TABLE IF EXISTS collaboration.publication_version CASCADE;
DROP TABLE IF EXISTS collaboration.client_update CASCADE;
DROP TABLE IF EXISTS collaboration.work_log CASCADE;

RESET ROLE;
