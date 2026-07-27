-- Client invitation token mechanism (P9C-INVITE-01): the token/expiry
-- columns and the `expired` state `1786600000000_service-organizations-and-
-- client-engagements.sql` deliberately left off `collaboration
-- .client_access_grant` — that migration's own header named this exactly:
-- "WHY `client_access_grant` HAS NO TOKEN, NO EXPIRY, NO EMAIL-BINDING
-- MECHANISM. P9C-INVITE-01, a separate future work package, owns 'implement
-- email-bound, expiring client invitations' ... No `token_hash`, no
-- `expires_at`: those belong to the actual invitation mechanism
-- P9C-INVITE-01 designs." This migration is that mechanism.
--
-- MIRRORS `collaboration.invitation` (`1786500000000_collaboration-
-- operations-and-attribution.sql`, completed by P9A-API-01's own
-- `token_hash`/hash-only posture), not a new design: an opaque token is
-- generated application-side, only its SHA-256 hash ever reaches this
-- table, and the row itself carries its own expiry instant. See
-- `services/api/src/modules/collaboration/application/
-- client-invitation-token.ts` for the generation/hashing code — a deliberate
-- mirror of `gardens-mapping/application/invitation-token.ts`'s own
-- implementation, not a cross-module import, because that file is an
-- application-layer internal of a DIFFERENT module and is not re-exported
-- through `gardens-mapping/public.ts`.
--
-- BOTH COLUMNS STAY NULLABLE, on purpose. The P9B-DATA-01 migration's own
-- `client_access_grant_identity_check` already allows a grant to be created
-- directly against an existing `client_profile_id` with no invitation step
-- at all ("NULL once a grant was created directly against an existing
-- profile with no invitation step"). Making `token_hash`/`expires_at`
-- `NOT NULL` would close that door this table was deliberately left open —
-- P9C-INVITE-01's own commands are simply the ONLY writer today, and they
-- always populate both together (enforced below by
-- `client_access_grant_token_linkage_check`, not by a `NOT NULL`).
--
-- WHY A FOURTH STATE, `expired`, RATHER THAN REUSING `revoked`. Section
-- "20. Failure and Concurrency Behavior" of collaboration-and-client-
-- sharing.md gives invitation replay, email mismatch, and expiry each their
-- own distinguishable outcome, matching `collaboration.invitation.state`'s
-- own four-value vocabulary (`pending`/`accepted`/`revoked`/`expired`) —
-- collapsing "nobody ever clicked the link and it lapsed" into "a
-- professional deliberately revoked it" would erase a real distinction an
-- audit or support read cares about (an expired invitation is not evidence
-- of anyone's decision), and would also make
-- `client_access_grant_revoked_linkage_check`'s existing
-- `(state = 'revoked') = (revoked_at IS NOT NULL)` equivalence lie for an
-- expiry that never set `revoked_at`.
--
-- NO SEPARATE `expired_at` COLUMN. `expires_at` already IS the instant a
-- lazily-expired row lapsed at — recording a second "when did we notice"
-- timestamp would only ever equal-or-follow the first, matching
-- `collaboration.invitation`'s own precedent (no `expired_at` column exists
-- there either; `state = 'expired'` plus the pre-existing `expires_at` is
-- the complete fact).
--
-- WHY `client_access_grant`'S STATE MACHINE HAS AN EDGE `invitation.state`
-- DOES NOT: `active -> revoked`. `collaboration.invitation` only ever
-- revokes a `pending` row (membership removal is a wholly separate
-- mechanism once an operational invitation is accepted); `client_access_
-- grant` has no separate "client membership" table alongside it — THIS row
-- is both the invitation AND the ongoing access grant, so "revoke a client's
-- ongoing portal access" and "revoke a client's still-pending invite" are
-- necessarily the SAME state transition on the SAME row
-- (collaboration-and-client-sharing.md, "Revoke — the same authorized-
-- professional capability revokes a pending OR active grant"). The
-- sequencing itself (which this migration's CHECKs cannot enforce any more
-- than P9B-DATA-01's own header explains for engagement state) is
-- `domain/client-access-grant-state.ts`'s job, mirroring
-- `domain/client-engagement-state.ts`'s identical pure-predicate shape.
--
-- Source: implementation-plan.md work package P9C-INVITE-01;
--         architecture/collaboration-and-client-sharing.md, sections
--         "9. Client Invitation and Session", "20. Failure and Concurrency
--         Behavior";
--         migrations/1786600000000_service-organizations-and-client-
--         engagements.sql, "WHY `client_access_grant` HAS NO TOKEN" and
--         migrations/1786500000000_collaboration-operations-and-attribution.sql
--         (the operational invitation's own token-hash precedent).

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE collaboration.client_access_grant
  ADD COLUMN token_hash text,
  ADD COLUMN expires_at timestamptz;

-- Paired columns: a row naming one always names the other. See this file's
-- header, "BOTH COLUMNS STAY NULLABLE" — the pairing is what the writer
-- (this package's own commands) guarantees; the table itself only enforces
-- that they never appear alone.
ALTER TABLE collaboration.client_access_grant
  ADD CONSTRAINT client_access_grant_token_linkage_check
    CHECK ((token_hash IS NULL) = (expires_at IS NULL));

-- An `expired` row can only be one this mechanism itself produced — see
-- this file's header, "NO SEPARATE `expired_at` COLUMN": `expires_at` is the
-- expiry instant, and reaching `expired` with no token at all would mean an
-- expiry with nothing that could have expired.
ALTER TABLE collaboration.client_access_grant
  ADD CONSTRAINT client_access_grant_expired_requires_token_check
    CHECK (state <> 'expired' OR token_hash IS NOT NULL);

-- Widen the state vocabulary — see this file's header, "WHY A FOURTH STATE".
ALTER TABLE collaboration.client_access_grant
  DROP CONSTRAINT client_access_grant_state_check;
ALTER TABLE collaboration.client_access_grant
  ADD CONSTRAINT client_access_grant_state_check
    CHECK (state IN ('pending', 'active', 'revoked', 'expired'));

-- `AcceptClientInvitation`'s single lookup, keyed on the token's own hash —
-- never on `id`, which the accepting caller does not have. Partial because
-- a directly-created grant (no invitation) carries no token at all.
CREATE UNIQUE INDEX client_access_grant_token_hash_key
  ON collaboration.client_access_grant (token_hash)
  WHERE token_hash IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS collaboration.client_access_grant_token_hash_key;

-- Coerce any `expired` row to the nearest safe equivalent BEFORE narrowing
-- the vocabulary back — the identical precedent
-- `1786200000000_notification-delivery.sql`'s own down migration already
-- sets ("delivery-outcome rows honestly pending again") for the same
-- reason: `ADD CONSTRAINT` validates every EXISTING row, and a real
-- `expired` row at rollback time would otherwise abort the migration
-- outright. `revoked_at = now()` is required alongside the state change —
-- `client_access_grant_revoked_linkage_check` demands the pair together.
UPDATE collaboration.client_access_grant
  SET state = 'revoked', revoked_at = now()
  WHERE state = 'expired';

ALTER TABLE collaboration.client_access_grant
  DROP CONSTRAINT IF EXISTS client_access_grant_state_check;
ALTER TABLE collaboration.client_access_grant
  ADD CONSTRAINT client_access_grant_state_check
    CHECK (state IN ('pending', 'active', 'revoked'));

ALTER TABLE collaboration.client_access_grant
  DROP CONSTRAINT IF EXISTS client_access_grant_expired_requires_token_check,
  DROP CONSTRAINT IF EXISTS client_access_grant_token_linkage_check,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS token_hash;

RESET ROLE;
