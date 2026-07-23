-- Synchronization baseline: the client installation registry
-- `PUT /v1/sync/clients/{clientInstallationId}` (registerSyncClient) reads
-- and writes.
--
-- No new schema: `platform` already owns "operational metadata" per
-- architecture/data-and-geospatial-design.md, section "3. Schema Ownership",
-- and 1784710800000_platform-baseline.sql's own `module_schemas` array is a
-- fixed allowlist this migration does not reopen — adding a schema there
-- would be an architecture change ("Never break the architecture... without
-- approval"), not a routine addition alongside it. This table is
-- exclusively written and read by services/api/src/modules/synchronization,
-- the same way `platform.sync_change`/`idempotency_record`/`outbox_event`
-- already live in `platform` despite each being genuinely owned by (or
-- primarily meaningful to) a narrower slice of the system than "every
-- module" implies.
--
-- Source: architecture/offline-synchronization.md, section "22. Security"
-- ("Device installation identifiers are application-scoped and revocable"),
-- section "12. Initial Synchronization" (step 1, "register or refresh
-- client installation metadata"); packages/api-contracts/openapi.yaml,
-- `SyncClientInstallation`/`SyncClientRegistrationRequest`.

-- Up Migration

SET ROLE verdery_migration;

-- `id` is the client-generated `clientInstallationId` (UUIDv7), not a
-- server-assigned surrogate — "stable for the lifetime of one app
-- installation on one device," per the OpenAPI operation's own description.
--
-- `profile_id` is reassignable on every register-or-refresh call, not fixed
-- at first insert: the installation identifies one app install on one
-- device, not one account, so the same id legitimately reappears under a
-- different profile after a device changes accounts (sign-out, different
-- user signs in). This is why `registered_at` is preserved across such a
-- reassignment (see the repository's `ON CONFLICT` clause) while
-- `profile_id`/`platform`/`app_version`/`protocol_version`/`last_seen_at`
-- are always overwritten.
--
-- `revoked_at` has no reader yet — revocation
-- (architecture/offline-synchronization.md, section "22. Security") is an
-- out-of-scope administrative capability this work package does not add an
-- endpoint for — but the column is added now so the row shape does not need
-- a second migration once that endpoint exists, the same "skeleton ahead of
-- the module that will use it" reasoning
-- 1784736116655_identity-and-gardens-baseline.sql already applied to
-- `platform.sync_change`.
CREATE TABLE platform.sync_client_installation (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  platform text NOT NULL,
  app_version text NOT NULL,
  protocol_version integer NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT sync_client_installation_platform_check CHECK (platform IN ('ios', 'web'))
);

-- Not used by any query this pass (installation rows are always looked up by
-- their own primary key), but a profile-scoped support/admin lookup is the
-- obvious next reader and the column is otherwise unindexed.
CREATE INDEX sync_client_installation_profile_id_idx
  ON platform.sync_client_installation (profile_id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS platform.sync_client_installation CASCADE;

RESET ROLE;
