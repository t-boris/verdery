-- Engagement publisher grant and client-update item staging (P9C-PUBLISH-01):
-- two small additive tables the six-step publish transaction
-- (collaboration-and-client-sharing.md section 10) and the "separate
-- publisher capability" requirement (ADR-0012, "Publication Boundary") need
-- and P9C-DATA-01 deliberately left unbuilt — that migration's own report
-- named both gaps explicitly: no publisher-capability table existed anywhere
-- in the schema, and "No 'selected item' staging table... P9C-PUBLISH-01 may
-- need either a staging table (additive migration) or may accept the full
-- selection as one request payload." This migration answers both questions
-- with real schema, not a workaround.
--
-- WHY A NEW GRANT TABLE, NOT A FIELD ON AN EXISTING ROLE. ADR-0012's own
-- words, quoted exactly: "Publisher access is a separate capability. An
-- organization administrator grants it for an organization-backed
-- engagement; a garden owner grants it when no service organization is
-- attached. Owner, editor, or professional status alone does not grant
-- publication access." `manageEngagement` (`organization-role.ts`) already
-- means something narrower — administering the ENGAGEMENT RECORD itself
-- (activate/end/revoke) — and `GardenCapability` has no publish bit either.
-- Folding publisher access into either would violate the ADR's own sentence
-- directly: an org admin already holds `manageEngagement` by role, so if
-- publish also rode on that capability, EVERY org admin would silently be a
-- publisher with no explicit grant step at all — exactly the coupling the
-- ADR names and rejects. A new, narrow, per-ENGAGEMENT grant table is the
-- only shape that keeps "explicitly granted" and "administers the
-- engagement" independent facts, the same way `client_access_grant` keeps
-- "administers the engagement" and "is a client of it" independent.
--
-- WHY PER-ENGAGEMENT, NOT PER-ORGANIZATION OR GLOBAL. ADR-0012's own wording
-- scopes the grant to "an organization-backed ENGAGEMENT" specifically, not
-- to organization membership generally — a professional could be trusted to
-- publish for one client relationship and not another, and nothing in the
-- architecture asks a grant to travel with organization membership itself
-- (unlike `garden_assignment`, which travels with GARDEN access, publisher
-- access travels with ENGAGEMENT access). `engagement_id` is therefore the
-- only scoping column, mirroring `client_access_grant.engagement_id`
-- exactly.
--
-- BUILT IN `garden_assignment`'s OWN APPEND-ONLY SHAPE, NOT
-- `organization_membership`'s MUTABLE-ROW-PLUS-PERIOD-TABLE SHAPE. The
-- identical reasoning `garden_assignment`'s own migration comment already
-- gives applies again: nothing requires a stable "grant identity" to survive
-- a later re-grant, no existing reader depends on one, and a two-state
-- (`active`/`revoked`) machine with only one reachable edge needs no
-- companion state-machine predicate file the way `garden_assignment_state.ts`
-- earns one for its genuinely three-state, two-terminal machine — a straight
-- `state = 'revoked'` idempotent-no-op check in the revoke command itself is
-- the honest amount of machinery for two states and one edge.
--
-- WHO MAY BE GRANTED. Neither the ADR nor collaboration-and-client-sharing.md
-- names an eligibility rule for the GRANTEE (only for the GRANTOR), so this
-- migration adds none as a CHECK — a cross-table fact no CHECK could see
-- regardless. `GrantPublisherAccess` (the application command) is where that
-- judgment call is made and documented: an org-backed grant requires the
-- grantee be an ACTIVE member of the SAME organization (mirroring
-- `CreateGardenAssignment`'s identical assignee check), and a
-- no-organization grant requires the grantee hold ACTIVE garden membership
-- (any role) on the engagement's own garden — neither enforced here, both
-- proved by that command's own tests.
--
-- CLIENT_UPDATE_ITEM: THE STAGING TABLE, ORDINARY MUTABLE GRANTS. Unlike
-- every `publication_*` table P9C-DATA-01 built, this table is NOT REVOKEd
-- from `verdery_application` — it is the deliberately MUTABLE working set a
-- publisher edits repeatedly while a `client_update` sits in
-- `internal_draft` (add a work-log reference, remove a media reference,
-- reconsider), never the immutable record of what a client actually saw.
-- `publication_item`/its detail children remain the ONLY place that
-- immutability guarantee lives; this table is copied FROM at publish time,
-- never read FROM at portal-render time, so nothing about its own
-- mutability weakens that guarantee.
--
-- SCOPE: WORK-LOG AND MEDIA REFERENCES ONLY, NOT ALL FOUR PUBLICATION-ITEM
-- KINDS. `publication_item` supports four kinds
-- (`work_log`/`media`/`garden_snapshot`/`timeline_entry`) because all four
-- feed the published Garden Timeline equally once published. Staging is
-- narrower on purpose: work logs and media are pre-existing OPERATIONAL
-- records a publisher SELECTS from (this table's own reason to exist, per
-- this package's own task framing: "SELECTED work-log/media references
-- staged"); a garden overview and timeline entries are narrative text a
-- publisher COMPOSES fresh for the publication itself, with no prior
-- "candidate list" to select from and therefore nothing to stage — they are
-- supplied directly in the publish request body instead, validated and
-- snapshotted in the same six-step transaction. Staff attribution follows
-- the identical "composed at publish time" reasoning: the publisher names
-- who to credit when they publish, not from a staged candidate pool. This
-- is a genuine, bounded design choice, not an oversight — extending staging
-- to the other three kinds later, if a real workflow need appears, is an
-- additive migration then, exactly like every other "additive, not a
-- rewrite" posture this schema already follows.
--
-- ONE WIDE TABLE, NOT A DISCRIMINATED-PARENT-PLUS-CHILDREN PAIR LIKE
-- `publication_item`. That shape earned its own children specifically for
-- IMMUTABILITY-GRANULARITY reasons (P9C-DATA-01's own header: separating
-- mutable-versus-immutable is "not merely tidy" because Postgres REVOKEs are
-- per-table). This table carries NO revoked privilege at all — every column
-- lives under the SAME ordinary grant regardless of kind — so that reason
-- does not apply here, and a single table with kind-appropriate nullable
-- columns is the honestly-simpler shape for a two-kind, fully-mutable
-- staging set. `description`/`media_role`/`caption` are validated per-kind
-- by `client_update_item_work_log_shape_check`/`_media_shape_check` below,
-- not left as unconstrained free columns.
--
-- Source: implementation-plan.md work package P9C-PUBLISH-01;
--         migrations/1786700000000_client-publication-and-work-logs.sql (its
--         own "No 'selected item' staging table" note);
--         architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
--         section "Publication Boundary";
--         architecture/collaboration-and-client-sharing.md, sections
--         "4.4 Publisher", "10. Publication Workflow".

-- Up Migration

SET ROLE verdery_migration;

-- Explicit publisher capability, separate from `manageEngagement`/
-- `manageGarden` — see this file's header, "WHY A NEW GRANT TABLE". Built in
-- `garden_assignment`'s own append-only shape — see this file's header,
-- "BUILT IN `garden_assignment`'s OWN APPEND-ONLY SHAPE".
CREATE TABLE collaboration.publisher_grant (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES collaboration.client_engagement (id),
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  state text NOT NULL DEFAULT 'active',
  granted_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_profile_id uuid REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publisher_grant_state_check CHECK (state IN ('active', 'revoked')),
  CONSTRAINT publisher_grant_revoked_linkage_check
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT publisher_grant_revoked_by_linkage_check
    CHECK ((revoked_at IS NULL) = (revoked_by_profile_id IS NULL))
);

-- One person cannot hold two simultaneous ACTIVE grants on the same
-- engagement — the schema's own enforcement of "explicit, checkable
-- capability", mirroring `garden_assignment_active_key` exactly.
CREATE UNIQUE INDEX publisher_grant_active_key
  ON collaboration.publisher_grant (engagement_id, profile_id)
  WHERE state = 'active';

-- "Is this profile an active publisher on this engagement" — the exact
-- authorization query every client-update command runs.
CREATE INDEX publisher_grant_engagement_idx
  ON collaboration.publisher_grant (engagement_id, state);
-- "Which engagements can this profile publish for."
CREATE INDEX publisher_grant_profile_idx
  ON collaboration.publisher_grant (profile_id, state);

-- The mutable staging set a publisher builds while a `client_update` sits in
-- `internal_draft` — see this file's header, "CLIENT_UPDATE_ITEM". Ordinary
-- default grants: unlike `publication_item`, nothing here is REVOKEd.
CREATE TABLE collaboration.client_update_item (
  id uuid PRIMARY KEY,
  client_update_id uuid NOT NULL
    REFERENCES collaboration.client_update (id) ON DELETE CASCADE,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  -- `kind = 'work_log'` only.
  source_work_log_id uuid REFERENCES collaboration.work_log (id),
  description text,
  -- `kind = 'media'` only. No foreign key on `media_record_id` — the same
  -- purge-survival posture `publication_media_detail.media_record_id`
  -- already documents; a staged reference to media later purged is simply
  -- rejected at publish-time revalidation (step 2 of the six-step
  -- transaction), not a dangling-FK concern at staging time.
  media_record_id uuid,
  media_role text,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_update_item_kind_check CHECK (kind IN ('work_log', 'media')),
  CONSTRAINT client_update_item_work_log_shape_check CHECK (
    kind <> 'work_log' OR (
      source_work_log_id IS NOT NULL
      AND description IS NOT NULL AND btrim(description) <> ''
      AND media_record_id IS NULL AND media_role IS NULL AND caption IS NULL
    )
  ),
  CONSTRAINT client_update_item_media_shape_check CHECK (
    kind <> 'media' OR (
      media_record_id IS NOT NULL
      AND media_role IN ('before', 'after', 'general')
      AND source_work_log_id IS NULL AND description IS NULL
    )
  ),
  CONSTRAINT client_update_item_caption_not_blank_check
    CHECK (caption IS NULL OR btrim(caption) <> '')
);

-- At most one staged reference to the same work-log entry per draft.
CREATE UNIQUE INDEX client_update_item_work_log_key
  ON collaboration.client_update_item (client_update_id, source_work_log_id)
  WHERE source_work_log_id IS NOT NULL;
-- At most one staged reference to the same media object per draft.
CREATE UNIQUE INDEX client_update_item_media_key
  ON collaboration.client_update_item (client_update_id, media_record_id)
  WHERE media_record_id IS NOT NULL;
-- "Every item staged on this draft" — the preview/publish read.
CREATE INDEX client_update_item_client_update_idx
  ON collaboration.client_update_item (client_update_id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS collaboration.client_update_item CASCADE;
DROP TABLE IF EXISTS collaboration.publisher_grant CASCADE;

RESET ROLE;
