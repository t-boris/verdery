-- Service organizations and client engagements (P9B-DATA-01): the
-- professional-service domain ADR-0012 and
-- architecture/collaboration-and-client-sharing.md describe but nothing in
-- the schema has represented until now — a lightweight service organization,
-- its membership, the explicit garden assignment that is the ONLY way
-- organization membership turns into garden access, the client engagement
-- that links a garden to an optional organization and one or more clients,
-- and the client-side access-grant row a future invitation/acceptance flow
-- (P9C-INVITE-01) will populate.
--
-- All six tables are new. Nothing existing is altered, no column is added to
-- any table another module owns, and no constraint already in the database is
-- relaxed. `collaboration` is not a new schema: P2-DATA-01 created it and
-- P9A-DATA-01 already used it, and node-pg-migrate's SET ROLE
-- verdery_migration below is what gives these new tables the same default
-- SELECT/INSERT/UPDATE/DELETE grant to verdery_application that
-- collaboration.membership_period received, with no extra GRANT needed here.
--
-- MODULE OWNERSHIP. `architecture/data-and-geospatial-design.md` section
-- "3. Schema Ownership" already assigns this precisely: "Collaboration —
-- Memberships, organizations, assignments, engagements, work logs,
-- publications, and grants." `architecture/backend-modular-monolith.md`
-- section "6.8 Collaboration" repeats the same list by name (service
-- organizations, organization memberships, garden assignments, client
-- engagements). This is not an open question this migration has to settle —
-- both approved architecture documents already put this domain in the same
-- module that owns operational membership, not in `gardens-mapping` (which
-- owns gardens/coordinate-space/geometry, a different bounded context per
-- section 6.2) and not in a new invented module name. What IS a genuine,
-- documented judgment call: no `collaboration` TypeScript module directory
-- exists yet, because P9A-DATA-01's own file headers describe today's
-- `gardens-mapping/application/membership-repository.ts` and its siblings as
-- a "temporary consolidation ... revisited when ... a real Collaboration
-- module has its own write path". This migration is schema-only
-- (P9B-DATA-01's own scope: no commands, no routes), so it does not perform
-- that revisit for the P9A tables — moving `collaboration.membership`'s
-- existing repositories out of `gardens-mapping` is a real refactor with its
-- own review, not a side effect of adding new tables. What it DOES do is
-- create the first real `services/api/src/modules/collaboration/` directory,
-- typed against exactly the six tables below, so the module the architecture
-- already names has a home and P9B-API-01 is not the package that first
-- decides where this domain's code lives. The `collaboration` Postgres
-- schema is consequently typed from two TypeScript modules for now
-- (`gardens-mapping` for the P9A tables, `collaboration` for these) — a
-- known, temporary split, not a design endorsement, and worth resolving the
-- day a package next touches P9A's own repositories.
--
-- WHAT THE DATABASE ENFORCES, AND WHAT IT CANNOT — the same honesty
-- P9A-DATA-01's own migration comment insists on, because none of the
-- invariants below that span more than one row are any more
-- database-enforceable now than the last-owner invariant was then:
--
--   * ENFORCED — one row per (organization, profile) in
--     `organization_membership` forever (mirroring `membership`'s own
--     lifetime-row shape); at most one OPEN organization-membership period
--     per membership; role and state vocabularies on every table; at most one
--     ACTIVE garden assignment per (garden, profile) at a time
--     (`garden_assignment_active_key`), so a professional cannot hold two
--     simultaneous grants to the same garden through this table any more than
--     an operational member can through `collaboration.membership`; every
--     terminal-state linkage (an ended engagement names when it ended, a
--     revoked engagement names when and, optionally, why, an active client
--     grant names a bound profile and a grant instant); ordering of every
--     paired instant; that a garden assignment's role is `editor` or `viewer`
--     — never `owner`, because a professional works a client's garden, they
--     do not own it.
--
--   * NOT ENFORCED, and deliberately not attempted with a trigger (this
--     codebase has zero PL/pgSQL; adding business logic to the database is an
--     architecture change with its own decision record, not a data
--     migration):
--
--     - "A solo professional may start with an organization containing one
--       administrator" (collaboration-and-client-sharing.md section 7) is an
--       ORGANIZATION-CREATION invariant, not a standing one: no CHECK can
--       count sibling rows, so nothing here stops an organization from
--       existing with zero admins, two admins, or zero members at all. The
--       same demote-the-last-admin race the last-owner invariant already
--       documents applies identically here — the FOR UPDATE recipe
--       `collaboration-operations-and-attribution.sql` prescribes for
--       `collaboration.membership` is the SAME recipe a future
--       organization-administration command must run against
--       `organization_membership` before writing anything, substituting
--       `organization_id`/`role = 'organization_admin'` for
--       `garden_id`/`role = 'owner'`. That command is P9B-API-01's, not
--       this migration's.
--     - "Organization membership alone grants no garden access" (ADR-0012) is
--       a CROSS-TABLE fact this migration proves the schema does NOT prevent
--       by construction: nothing stops an `organization_membership` row from
--       existing with zero corresponding `garden_assignment` rows, which is
--       exactly the state a professional with no assigned garden is supposed
--       to be in. The invariant here is an absence of implication, not a
--       constraint — there is no capability to withhold, because none is
--       granted by this table in the first place. The application layer
--       (P9B-API-01) is what must never resolve garden access from
--       `organization_membership` alone.
--     - That `garden_assignment.profile_id` is actually a member of
--       `garden_assignment.organization_id`, and that
--       `client_access_grant.client_profile_id` is actually a distinct
--       identity per engagement beyond the partial unique index below, are
--       both cross-table facts a CHECK cannot see. Application-guaranteed.
--     - Engagement STATE SEQUENCING — that `active` is never reached except
--       from `draft`, that `ended` is never reached except from `active`, and
--       that a row already `ended` or `revoked` cannot be walked back to
--       `draft` or `active` — is NOT enforced. A CHECK evaluates only the row
--       being written, so it can reject an internally inconsistent row (an
--       `ended` row with no `ended_at`) but cannot see what the row's own
--       PREVIOUS state was. This mirrors the last-owner gap exactly: a trigger
--       comparing OLD and NEW could enforce it, none exists, and the
--       transition rules belong to whichever command layer manages engagement
--       lifecycle (P9C-PUBLISH-01, per the work-package table). The migration
--       test suite proves the absence of this guard directly, the same way
--       `collaboration-assignment-and-last-owner.test.ts` proves the absence
--       of the last-owner guard rather than assuming it.
--     - "Activation requires at least one garden, one client identity or
--       pending bound invitation, and an approved stewardship policy"
--       (collaboration-and-client-sharing.md section 8): the garden half is
--       structural (`client_engagement.garden_id` is `NOT NULL` on every
--       row, so "at least one garden" is automatic, not optional), and the
--       stewardship-policy half is likewise structural (the column is
--       `NOT NULL DEFAULT 'residential'`, so an engagement is never without
--       one). The CLIENT half is not: nothing here stops
--       `client_engagement.state` from becoming `'active'` while zero
--       `client_access_grant` rows reference it, for the same
--       cannot-count-siblings reason as everything else in this section.
--       Application-guaranteed, and proved absent by this migration's own
--       tests.
--
-- STEWARDSHIP POLICY AS AN ENUM, NOT A HARDCODED RULE. `stewardship_policy`
-- carries a CHECK admitting exactly one value today, `'residential'` — the
-- default policy section 18 describes (accepted garden model and published
-- deliverables are client-exportable; provider-internal notes, drafts,
-- assignments, diagnostics, and estimates are not). The column exists, with
-- its own named CHECK constraint, specifically so that a second,
-- contractually different policy — which section 18's own closing line says
-- "requires explicit product and legal approval" — is a widened CHECK in a
-- later migration plus new export-manifest logic in whichever package reads
-- this column, not a schema rewrite and not a second undocumented flag
-- bolted beside this one.
--
-- ROLE-SHAPED ASSIGNMENT, NOT A NEW VOCABULARY. `garden_assignment.role`
-- reuses the identical `'editor' | 'viewer'` vocabulary
-- `collaboration.membership.role` already carries (with `'owner'` excluded
-- by the same CHECK shape `collaboration.invitation.intended_role` already
-- uses for the same reason: the garden's owner is the CLIENT, ownership does
-- not travel through an assignment any more than it travels through an
-- invitation). This is the schema reading of
-- collaboration-and-client-sharing.md section 3's diagram note, "a
-- professional working a client's garden might need something role-shaped
-- like `editor` capabilities without being a `collaboration.membership` row
-- at all" — reusing `gardens_mapping/domain/garden-role.ts`'s existing
-- `GardenRole`/`GardenCapability` pair against THIS table's role column,
-- rather than inventing a second, parallel capability vocabulary for the
-- exact same four capabilities, is P9B-API-01's job and is exactly why the
-- vocabulary is kept identical here.
--
-- WHY `organization_membership` GETS A PERIOD TABLE. The same "who had access
-- when" question `collaboration.membership_period`
-- (P9A-DATA-01) exists to answer applies here without qualification: a
-- professional can join an organization, leave it, and be re-engaged later,
-- and the architecture document's own repeated emphasis on audit and
-- attribution (sections 6, 19 of collaboration-and-client-sharing.md) does
-- not carve out organization membership as an exception. The identical
-- "mutable current-state row plus append-only period child" shape is reused
-- rather than re-derived, right down to the closure and ordering CHECKs and
-- the one-open-period-per-membership index. UNLIKE `membership_period`,
-- THERE IS NO BACKFILL: `organization_membership` is a brand-new table with
-- zero existing rows on every environment this migration will ever run
-- against, so there is no pre-existing organization membership whose history
-- would otherwise be unanswerable — the backfill INSERT
-- `collaboration-operations-and-attribution.sql` needed exists there
-- specifically because `collaboration.membership` already held years of real
-- data; nothing here is in that position.
--
-- WHY `garden_assignment` GETS NO SEPARATE PERIOD TABLE. Unlike
-- `collaboration.membership`, nothing requires `garden_assignment` to hold
-- exactly one row per (garden, profile) forever — no existing writer, no
-- existing reader, and no external reference depends on a stable
-- "assignment identity" surviving a reassignment the way a membership row's
-- id must survive a role change. `garden_assignment` is therefore built
-- DIRECTLY in the append-only, one-row-per-stint shape
-- `collaboration.membership_period` uses, with the "is this currently open"
-- fact carried by `state = 'active'` plus `valid_until IS NULL` together
-- (the closure CHECK ties them, exactly mirroring
-- `membership_period_closure_check`) rather than a second table. A
-- reassignment is a new row, an ended assignment is one UPDATE, ever, and the
-- partial unique index enforces "not simultaneously assigned twice" the same
-- way `membership_period_open_key` does for operational membership. Building
-- BOTH a mutable current row and a period child here, when nothing yet reads
-- a stable per-pair assignment id, would be exactly the kind of unrequested
-- machinery this document's own P9A-DATA-01 precedent chose not to build
-- twice for the same one fact.
--
-- WHY `client_access_grant` HAS NO TOKEN, NO EXPIRY, NO EMAIL-BINDING
-- MECHANISM. P9C-INVITE-01, a separate future work package, owns "implement
-- email-bound, expiring client invitations". This table exists only so that
-- work package has a row to activate rather than a schema to invent: a grant
-- may be `pending` (an `invited_email` on file, no bound profile yet),
-- `active` (a real `identity_access.profile` is bound and access is live), or
-- `revoked`. No `token_hash`, no `expires_at`: those belong to the actual
-- invitation mechanism P9C-INVITE-01 designs, and adding placeholder columns
-- for a mechanism not yet designed would be exactly the "do not over-build
-- fields nothing reads yet" mistake this package was warned against.
--
-- NO FOREIGN KEY ON `garden_id`, ON EITHER `garden_assignment` OR
-- `client_engagement`. `collaboration.membership.garden_id` lost its own
-- foreign key in `1786400000000_deletion-baseline.sql` specifically because
-- the purge sweep genuinely executes `DELETE FROM gardens_mapping.garden
-- WHERE lifecycle_state = 'purging'` — gardens are hard-deleted, not
-- soft-state-only — and a revocation tombstone must survive that deletion for
-- offline-sync and audit purposes. Section 18 of
-- collaboration-and-client-sharing.md asks for exactly the same survival
-- property for engagement and assignment records ("Preserves provider records
-- required for audit, dispute, legal, or retention obligations"), so both new
-- tables are built WITHOUT the foreign key from the start rather than
-- shipping it now and repeating P8-DELETE-01's later removal. `service_organization_id`
-- on `client_engagement` keeps its foreign key: nothing in this package gives
-- `service_organization` a deletion or purge path, so the referential
-- integrity is real and costs nothing to keep.
--
-- NO LIFECYCLE ON `service_organization`. The row is name plus optimistic-
-- concurrency bookkeeping (`revision`, mirroring `gardens_mapping.garden`'s
-- own column of the same name and purpose) and nothing else. No
-- `lifecycle_state`, no soft-delete: nothing in scope for P9B-DATA-01 asks an
-- organization to be archived, suspended, or deleted, and adding a lifecycle
-- vocabulary with no writer would be the same untested-dead-state mistake
-- `gardens_mapping.garden_lifecycle_state_check`'s own comment already warns
-- against. If organization deletion becomes a real requirement, it is an
-- additive migration then, the same way garden deletion arrived in
-- P8-DELETE-01 well after gardens themselves did.
--
-- ONE OPEN JUDGMENT CALL LEFT UNRESOLVED ON PURPOSE: whether a garden may
-- have more than one ACTIVE `client_engagement` at once (for example, two
-- independent service organizations serving the same garden concurrently) is
-- not addressed by any architecture document in scope, and this migration
-- does not invent a "one active engagement per garden" constraint to close
-- that silence — see the work's own report for why forcing an answer here
-- would be exactly the kind of undocumented product decision this codebase's
-- own conventions push back on.
--
-- Backfill posture: six new tables, nothing altered, nothing backfilled —
-- every one of these tables starts empty in every environment this migration
-- will run against.
--
-- Source: implementation-plan.md work package P9B-DATA-01;
--         architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
--         sections "Service Organizations", "Client Engagement", "Client
--         Access";
--         architecture/collaboration-and-client-sharing.md, sections
--         "2. Core Boundary", "3. Domain Relationships", "4. Operational
--         Roles and Capabilities", "7. Service Organizations and
--         Assignments", "8. Client Engagement", "18. Data Stewardship,
--         Export, and Engagement End", "23. Open Product Decisions";
--         architecture/backend-modular-monolith.md, section "6.8
--         Collaboration";
--         architecture/data-and-geospatial-design.md, section "3. Schema
--         Ownership".

-- Up Migration

SET ROLE verdery_migration;

-- A solo professional or small garden-care team. Deliberately thin: see this
-- file's header for why no lifecycle column exists yet.
CREATE TABLE collaboration.service_organization (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_organization_name_not_blank_check CHECK (btrim(name) <> '')
);

-- Current membership state, one row per (organization, profile) forever —
-- structurally identical to `collaboration.membership`: `role` and `state`
-- are the live facts, history of how they got there lives in
-- `organization_membership_period` below.
CREATE TABLE collaboration.organization_membership (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES collaboration.service_organization (id),
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  role text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_membership_org_profile_key UNIQUE (organization_id, profile_id),
  CONSTRAINT organization_membership_role_check
    CHECK (role IN ('organization_admin', 'professional')),
  CONSTRAINT organization_membership_state_check CHECK (state IN ('active', 'removed'))
);

-- "Which organizations is this profile a member of" — the membership listing
-- and the "am I still on this team" check both lead with profile, not
-- organization, and the unique constraint above leads with organization.
CREATE INDEX organization_membership_profile_id_idx
  ON collaboration.organization_membership (profile_id, state);

-- The append-only interval history for organization membership — see this
-- file's header for why this mirrors `collaboration.membership_period`
-- exactly, including the closure and ordering CHECKs and the meaning of the
-- two `ended_reason` values.
CREATE TABLE collaboration.organization_membership_period (
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL
    REFERENCES collaboration.organization_membership (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  role text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  ended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_membership_period_role_check
    CHECK (role IN ('organization_admin', 'professional')),
  CONSTRAINT organization_membership_period_ended_reason_check
    CHECK (ended_reason IN ('removed', 'role_changed')),
  CONSTRAINT organization_membership_period_closure_check
    CHECK ((valid_until IS NULL) = (ended_reason IS NULL)),
  CONSTRAINT organization_membership_period_order_check
    CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- One person can never hold two simultaneous grants to the same organization.
CREATE UNIQUE INDEX organization_membership_period_open_key
  ON collaboration.organization_membership_period (membership_id)
  WHERE valid_until IS NULL;

-- "Who had access to this organization on date X".
CREATE INDEX organization_membership_period_org_validity_idx
  ON collaboration.organization_membership_period (organization_id, valid_from DESC);
-- The mirror question, "which organizations could this person reach on date X".
CREATE INDEX organization_membership_period_profile_validity_idx
  ON collaboration.organization_membership_period (profile_id, valid_from DESC);

-- The ONLY table through which organization membership becomes garden
-- access (ADR-0012: "Organization membership alone grants no garden
-- access ... a professional must also have an active garden assignment").
-- Built directly in `membership_period`'s append-only shape rather than a
-- mutable-row-plus-child-table pair — see this file's header for why no
-- second table exists here.
CREATE TABLE collaboration.garden_assignment (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES collaboration.service_organization (id),
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  -- No foreign key — see this file's header. Denormalized the same way
  -- `collaboration.membership_period.garden_id` is.
  garden_id uuid NOT NULL,
  role text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 'owner' excluded on purpose: a professional works a client's garden, the
  -- client owns it. See this file's header, "ROLE-SHAPED ASSIGNMENT".
  CONSTRAINT garden_assignment_role_check CHECK (role IN ('editor', 'viewer')),
  CONSTRAINT garden_assignment_state_check CHECK (state IN ('active', 'ended', 'revoked')),
  -- An open assignment (state = 'active') never carries an end instant, and a
  -- closed one always does — the same equivalence
  -- `membership_period_closure_check` enforces, with the closing REASON
  -- carried by `state` itself ('ended' vs 'revoked') rather than a separate
  -- column, because unlike `membership_period` this table has no parent
  -- "current state" row for `state` to otherwise describe.
  CONSTRAINT garden_assignment_closure_check
    CHECK ((state = 'active') = (valid_until IS NULL)),
  CONSTRAINT garden_assignment_order_check
    CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- Cannot be simultaneously assigned twice to the same garden — the schema's
-- own enforcement of "organization membership alone grants no garden access,
-- an active assignment is what does", made concrete as "at most one active
-- assignment per (garden, profile)".
CREATE UNIQUE INDEX garden_assignment_active_key
  ON collaboration.garden_assignment (garden_id, profile_id)
  WHERE state = 'active';

-- Tenant isolation's own index: "this organization's assignments", scoped
-- before any other predicate.
CREATE INDEX garden_assignment_organization_idx
  ON collaboration.garden_assignment (organization_id, valid_from DESC);
-- "Was this garden assigned to anyone on date X".
CREATE INDEX garden_assignment_garden_idx
  ON collaboration.garden_assignment (garden_id, valid_from DESC);
-- "My assignments" / "which gardens can this professional reach".
CREATE INDEX garden_assignment_profile_idx
  ON collaboration.garden_assignment (profile_id, valid_from DESC);

-- One garden, an OPTIONAL service organization, an engagement state machine
-- (draft -> active -> ended, draft/active -> revoked per
-- collaboration-and-client-sharing.md section 8), a stewardship policy, and a
-- minimal notification toggle. `client_access_grant` below is where the
-- "one or more client profiles" half of the relationship lives.
CREATE TABLE collaboration.client_engagement (
  id uuid PRIMARY KEY,
  -- No foreign key — see this file's header, "NO FOREIGN KEY ON `garden_id`".
  garden_id uuid NOT NULL,
  -- NULL is the documented "no service organization" case: the garden owner
  -- performs and publishes the work directly (ADR-0012, "Client Engagement";
  -- collaboration-and-client-sharing.md section 4.4).
  service_organization_id uuid REFERENCES collaboration.service_organization (id),
  state text NOT NULL DEFAULT 'draft',
  -- See this file's header, "STEWARDSHIP POLICY AS AN ENUM".
  stewardship_policy text NOT NULL DEFAULT 'residential',
  -- Deliberately one boolean, not a preferences document: nothing in this
  -- package sends a notification, and the only decision anything downstream
  -- needs today is whether the client wants to hear about publication and
  -- engagement-change events at all (collaboration-and-client-sharing.md
  -- section 17). A richer per-channel/per-event document is additive later,
  -- exactly like `notifications.notification_preference_document` was built
  -- only once P7-NOTIF-01 had a channel and a schedule to prefer between.
  client_notifications_enabled boolean NOT NULL DEFAULT true,
  created_by_profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  activated_at timestamptz,
  ended_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_engagement_state_check
    CHECK (state IN ('draft', 'active', 'ended', 'revoked')),
  CONSTRAINT client_engagement_stewardship_policy_check
    CHECK (stewardship_policy IN ('residential')),
  -- One-way, not an equivalence: reaching 'active' or 'ended' REQUIRES having
  -- activated, but a 'revoked' row may or may not have activated_at set,
  -- because revocation reaches from either 'draft' (never activated) or
  -- 'active' (activated, then revoked) per the state diagram. See this
  -- file's header for why a full equivalence would reject the second case.
  CONSTRAINT client_engagement_activated_linkage_check
    CHECK (activated_at IS NOT NULL OR state IN ('draft', 'revoked')),
  -- 'ended' is a true terminal reached only from 'active' and nothing
  -- un-ends it, so this one IS a clean equivalence.
  CONSTRAINT client_engagement_ended_linkage_check
    CHECK ((state = 'ended') = (ended_at IS NOT NULL)),
  CONSTRAINT client_engagement_ended_order_check
    CHECK (ended_at IS NULL OR (activated_at IS NOT NULL AND ended_at >= activated_at)),
  CONSTRAINT client_engagement_revoked_linkage_check
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT client_engagement_revoked_reason_check
    CHECK (revoked_reason IS NULL OR state = 'revoked')
);

CREATE INDEX client_engagement_garden_idx
  ON collaboration.client_engagement (garden_id);
-- Tenant isolation's own index for the organization side: "this
-- organization's engagements", scoped before any other predicate. Partial
-- because the column is frequently NULL (no service organization) and those
-- rows are never reached through this path.
CREATE INDEX client_engagement_organization_idx
  ON collaboration.client_engagement (service_organization_id)
  WHERE service_organization_id IS NOT NULL;

-- "One or more client profiles" per engagement, and their access/invitation
-- state — see this file's header, "WHY `client_access_grant` HAS NO TOKEN".
CREATE TABLE collaboration.client_access_grant (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL
    REFERENCES collaboration.client_engagement (id) ON DELETE CASCADE,
  -- NULL until a future invitation is accepted and binds a real profile.
  client_profile_id uuid REFERENCES identity_access.profile (id),
  -- The pre-acceptance target, normalized like
  -- `collaboration.invitation.intended_email`. NULL once a grant was created
  -- directly against an existing profile with no invitation step.
  invited_email text,
  state text NOT NULL DEFAULT 'pending',
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A grant naming neither a profile nor an intended email identifies nobody.
  CONSTRAINT client_access_grant_identity_check
    CHECK (client_profile_id IS NOT NULL OR invited_email IS NOT NULL),
  CONSTRAINT client_access_grant_state_check
    CHECK (state IN ('pending', 'active', 'revoked')),
  -- Active access requires an actual bound identity — a pending invitation
  -- alone never grants it.
  CONSTRAINT client_access_grant_active_requires_profile_check
    CHECK (state <> 'active' OR client_profile_id IS NOT NULL),
  CONSTRAINT client_access_grant_active_requires_granted_at_check
    CHECK (state <> 'active' OR granted_at IS NOT NULL),
  -- 'revoked' is a true terminal and nothing un-revokes it, so this one is a
  -- clean equivalence, mirroring `ownership_transfer_cancelled_linkage_check`.
  CONSTRAINT client_access_grant_revoked_linkage_check
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT client_access_grant_invited_email_normalized_check
    CHECK (invited_email IS NULL OR invited_email = lower(invited_email))
);

-- One grant per (engagement, bound client profile) — the same client cannot
-- accumulate duplicate access rows to one engagement. Partial because
-- `client_profile_id` is frequently NULL before acceptance.
CREATE UNIQUE INDEX client_access_grant_engagement_profile_key
  ON collaboration.client_access_grant (engagement_id, client_profile_id)
  WHERE client_profile_id IS NOT NULL;
-- One outstanding invitation target per (engagement, intended email) —
-- mirrors `invitation_pending_intended_email_key` exactly.
CREATE UNIQUE INDEX client_access_grant_pending_email_key
  ON collaboration.client_access_grant (engagement_id, invited_email)
  WHERE state = 'pending' AND invited_email IS NOT NULL;
-- "List this engagement's grants" — the general listing neither partial
-- index above can serve on its own.
CREATE INDEX client_access_grant_engagement_idx
  ON collaboration.client_access_grant (engagement_id);
-- "Which engagements can this client reach" — the cross-engagement query a
-- client portal session will need, and the same query this migration's own
-- tenant-isolation tests exercise to prove one engagement's rows never
-- surface when another engagement is what was asked for.
CREATE INDEX client_access_grant_profile_idx
  ON collaboration.client_access_grant (client_profile_id)
  WHERE client_profile_id IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS collaboration.client_access_grant CASCADE;
DROP TABLE IF EXISTS collaboration.client_engagement CASCADE;
DROP TABLE IF EXISTS collaboration.garden_assignment CASCADE;
DROP TABLE IF EXISTS collaboration.organization_membership_period CASCADE;
DROP TABLE IF EXISTS collaboration.organization_membership CASCADE;
DROP TABLE IF EXISTS collaboration.service_organization CASCADE;

RESET ROLE;
