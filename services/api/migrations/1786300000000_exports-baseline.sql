-- Exports baseline (P8-EXPORT-01): the `exports` module's first tables —
-- the durable export request (which IS the export job record: its own
-- `requested -> running -> completed | failed` state machine, the recorded
-- consistency boundary, and the pre-computed package target) and its
-- per-section generation checkpoints — plus the module schema itself, and
-- ONE alteration outside the new schema: `notifications.notification_intent
-- .garden_id` becomes nullable so an account-wide export's `export_ready`
-- intent (which concerns no garden) can exist honestly instead of
-- borrowing a garden id it does not mean.
--
-- WHY NO `media.processing_job` ROW FOR THIS FAMILY: that table is keyed
-- around a media record (`media_id NOT NULL REFERENCES media.media_record`)
-- that, for an export, does not exist until the package is written — the
-- `export_package` media record is registered at COMPLETION, the derivative
-- precedent (bytes durably written before the row exists). The export
-- request row carries the durable job state instead; the relay's
-- crash-window safety comes from Cloud Tasks task-name deduplication (task
-- name = outbox event id), the same mechanism the media family already
-- relies on for its own enqueue step.
--
-- `output_media_id` and the package bucket/object-key target are minted at
-- REQUEST time, not completion: the exports-bucket object key must embed
-- the `export_package` media UUID (`<shard>/<mediaUuid>/<objectUuid>`,
-- media-storage-and-processing.md section 4) so the established
-- prefix-scoped deletion pipeline reaches the package bytes when the 7-day
-- retention deadline passes — and the worker needs that exact target
-- BEFORE the media record can exist. No FK on `output_media_id` for the
-- same reason: the referenced row appears only at completion.
--
-- `export_request_one_active_per_requester` is the request rate limit
-- (data-export-and-deletion.md section 5 records state and expiry; the doc
-- names no frequency figure, so the enforced rule is the honest minimum —
-- one export in flight per requester, enforced by the database rather than
-- by a racy application check).
--
-- `verdery_worker` deliberately gets NOTHING here: the worker's export job
-- reads and writes ONLY Cloud Storage bytes and talks to the API's
-- OIDC-verified internal endpoints for every database fact — the same
-- privilege wall the notification-policy endpoint and all four sweeps
-- document.
--
-- Backfill posture: both tables are new; the one ALTER widens nullability
-- (no stored row is rewritten) and adds a CHECK that every existing row
-- already satisfies (`care_recommendation` rows all carry a garden id).
--
-- Source: implementation-plan.md work package P8-EXPORT-01;
--         architecture/data-export-and-deletion.md, sections "3. Export
--         Scope", "5. Export Request", "6. Generation Flow",
--         "7. Consistency", "9. Secure Delivery";
--         architecture/notifications.md, section "4. Notification Intent".

-- Up Migration

-- Schema creation and privilege wiring run as the CONNECTED migration
-- identity, not under SET ROLE — see the integrations baseline's identical
-- block for why (`verdery_migration` owns schemas by AUTHORIZATION but holds
-- no CREATE on the database; the connected identity holds membership).
CREATE SCHEMA IF NOT EXISTS exports AUTHORIZATION verdery_migration;

REVOKE ALL ON SCHEMA exports FROM PUBLIC;
GRANT USAGE ON SCHEMA exports TO verdery_application;

ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA exports
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA exports
  GRANT USAGE, SELECT ON SEQUENCES TO verdery_application;

SET ROLE verdery_migration;

-- The durable export request — data-export-and-deletion.md section 5's
-- field list, one column set per bullet:
--
--   "Request UUIDv7"                        -> id
--   "Requester and authenticated session
--    context"                               -> requester_profile_id +
--                                              session_credential_kind +
--                                              session_authenticated_at
--   "Scope and garden IDs"                  -> scope + garden_id
--   "Requested format version"              -> format_version
--   "Media inclusion choice"                -> include_media
--   "State and progress"                    -> state + boundary_at +
--                                              attempt_count (+ the
--                                              checkpoint table below)
--   "Creation, expiration, and completion
--    times"                                 -> created_at + expires_at +
--                                              completed_at
--   "Output media ID and checksum"          -> output_media_id +
--                                              output_checksum_sha256
CREATE TABLE exports.export_request (
  id uuid PRIMARY KEY,
  requester_profile_id uuid NOT NULL
    REFERENCES identity_access.profile (id),
  scope text NOT NULL,
  garden_id uuid REFERENCES gardens_mapping.garden (id),
  include_media boolean NOT NULL,
  format_version text NOT NULL,
  state text NOT NULL DEFAULT 'requested',
  session_credential_kind text NOT NULL,
  session_authenticated_at timestamptz NOT NULL,
  boundary_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  output_media_id uuid NOT NULL,
  package_bucket_name text NOT NULL,
  package_object_key text NOT NULL,
  output_checksum_sha256 text,
  failure_code text,
  expires_at timestamptz,
  completed_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_request_scope_check CHECK (scope IN ('account', 'garden')),
  CONSTRAINT export_request_state_check CHECK (
    state IN ('requested', 'running', 'completed', 'failed')
  ),
  -- A garden-scoped request names its garden; an account request never does.
  CONSTRAINT export_request_scope_garden_check CHECK (
    (scope = 'garden') = (garden_id IS NOT NULL)
  ),
  CONSTRAINT export_request_format_version_check CHECK (format_version <> ''),
  CONSTRAINT export_request_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT export_request_checksum_format_check CHECK (
    output_checksum_sha256 IS NULL OR output_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  -- A completed request always carries its package facts; a failed one its
  -- reason. Neither implication holds in reverse (a later state never
  -- clears them), so both are one-directional.
  CONSTRAINT export_request_completed_fields_check CHECK (
    state <> 'completed'
    OR (
      output_checksum_sha256 IS NOT NULL
      AND completed_at IS NOT NULL
      AND expires_at IS NOT NULL
    )
  ),
  CONSTRAINT export_request_failed_fields_check CHECK (
    state <> 'failed' OR failure_code IS NOT NULL
  )
);

-- One export in flight per requester — see this file's header.
CREATE UNIQUE INDEX export_request_one_active_per_requester
  ON exports.export_request (requester_profile_id)
  WHERE state IN ('requested', 'running');

-- The requester's own list/status reads.
CREATE INDEX export_request_requester_idx
  ON exports.export_request (requester_profile_id, id DESC);

-- One row per staged structured section of one export — the generation
-- job's checkpoints. Written all-at-once when the worker has staged every
-- section of one snapshot attempt (all-or-nothing keeps the staged set on
-- ONE repeatable-read boundary); a retried job resumes from these rows
-- instead of re-reading the snapshot. `disposition` mirrors the contract's
-- own vocabulary: `package` entries reach the final ZIP, `transfer`
-- entries carry worker-internal storage keys and never do.
CREATE TABLE exports.export_section_checkpoint (
  export_request_id uuid NOT NULL
    REFERENCES exports.export_request (id) ON DELETE CASCADE,
  entry_path text NOT NULL,
  disposition text NOT NULL,
  bucket_name text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  checksum_sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (export_request_id, entry_path),
  CONSTRAINT export_section_checkpoint_entry_path_check CHECK (entry_path <> ''),
  CONSTRAINT export_section_checkpoint_disposition_check CHECK (
    disposition IN ('package', 'transfer')
  ),
  CONSTRAINT export_section_checkpoint_checksum_format_check CHECK (
    checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT export_section_checkpoint_byte_size_check CHECK (byte_size >= 0)
);

-- `garden_id` becomes nullable: an account-wide export's `export_ready`
-- intent concerns no garden. The new CHECK pins the one existing type's
-- linkage so `care_recommendation` rows can never lose their garden — the
-- same one-per-concern CHECK posture `notification_intent_candidate_
-- linkage_check` set for the candidate column.
ALTER TABLE notifications.notification_intent
  ALTER COLUMN garden_id DROP NOT NULL,
  ADD CONSTRAINT notification_intent_garden_linkage_check CHECK (
    intent_type <> 'care_recommendation' OR garden_id IS NOT NULL
  );

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

-- Restoring NOT NULL requires no null rows to remain; export_ready intents
-- (the only writers of a null garden_id) are removed with the capability
-- they announce. Delivery-attempt children cannot exist for them (the
-- intent type is in-app only), so a plain delete suffices.
DELETE FROM notifications.notification_intent WHERE garden_id IS NULL;

ALTER TABLE notifications.notification_intent
  DROP CONSTRAINT IF EXISTS notification_intent_garden_linkage_check,
  ALTER COLUMN garden_id SET NOT NULL;

DROP TABLE IF EXISTS exports.export_section_checkpoint CASCADE;
DROP TABLE IF EXISTS exports.export_request CASCADE;

RESET ROLE;

-- Mirror of the notifications baseline's own down posture for a module
-- schema created outside the platform loop: revoke the default privileges
-- this migration granted, then drop the schema itself, as the connected
-- identity like the up direction's schema creation.
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA exports
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA exports
  REVOKE USAGE, SELECT ON SEQUENCES FROM verdery_application;

DROP SCHEMA IF EXISTS exports CASCADE;
