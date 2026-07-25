-- Notification delivery (P7-NOTIF-02): the push-delivery half of the
-- notifications module — revocable FCM device-channel records
-- (notifications.md section 6), append-only delivery-attempt records
-- (section 15's send-attempt/provider-acceptance/invalid-token counters at
-- their durable source), and the intent state machine's delivery-outcome
-- vocabulary (`sent`, `failed`, `skipped`) that P7-NOTIF-01 deliberately
-- left to the first stage whose code can reach it, plus the delivery
-- worker's own scheduling columns.
--
-- Privilege posture: identical to the notifications baseline
-- (1786000000000_notifications-baseline.sql) — the schema's default
-- privileges already grant `verdery_application` row access on new tables,
-- and `verdery_worker` gets NOTHING: the delivery sweep runs in
-- `services/api` behind the OIDC-verified internal endpoint (the
-- established sweep privilege boundary), and the workers process only
-- supplies the schedule. Device tokens are secrets (section 6); keeping
-- them out of the worker's reach entirely is part of that posture.
--
-- Backfill posture: existing `notification_intent` rows gain
-- `delivery_attempt_count` 0 and NULL `next_delivery_attempt_at` /
-- `close_reason` — exactly the state of an intent no delivery worker has
-- touched, which is true of every row that exists before this migration.
-- No existing row is otherwise rewritten.
--
-- Source: implementation-plan.md work package P7-NOTIF-02;
--         architecture/notifications.md, sections "5. Flow",
--         "6. Device Tokens", "9. Scheduling", "13. Failure Behavior",
--         "15. Observability".

-- Up Migration

SET ROLE verdery_migration;

-- One revocable device-channel record per (profile, installation) —
-- notifications.md section 6's field list: profile, application
-- installation, platform, last-seen time, environment, status, and
-- provider metadata. The FCM registration token itself is a secret
-- (excluded from logs and analytics; the API never echoes it back).
--
-- `installation_id` is the client-minted UUID stable for one app
-- installation on one device — the `synchronization.sync_client_installation`
-- register-or-refresh precedent. `provider` names the push transport the
-- token belongs to; `'fcm'` is the only value the application writes today
-- (ADR-0002 commits Firebase), kept free text under a non-blank CHECK the
-- same way the code-owned type vocabularies are.
--
-- `status`/`disabled_reason`: "Invalid or unregistered tokens are disabled
-- idempotently" (section 6) — a disabled row keeps the audit fact of WHY
-- the channel died; re-registration with a fresh token reactivates it.
-- Removal (the user-facing DELETE) removes the row outright: an absent
-- record needs no tombstone, and the delivery worker only ever reads
-- `active` rows.
CREATE TABLE notifications.notification_device (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL
    REFERENCES identity_access.profile (id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  platform text NOT NULL,
  provider text NOT NULL,
  fcm_token text NOT NULL,
  environment text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  disabled_reason text,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The two application platforms this API serves (the
  -- `SyncClientPlatform` vocabulary): a closed set because a platform is a
  -- fact about shipped clients, not a growing product vocabulary.
  CONSTRAINT notification_device_platform_check CHECK (platform IN ('ios', 'web')),
  CONSTRAINT notification_device_provider_check CHECK (provider <> ''),
  CONSTRAINT notification_device_token_check CHECK (fcm_token <> ''),
  -- The deployment environment the registering API stamped from its own
  -- configuration (clients cannot claim another environment's tokens).
  CONSTRAINT notification_device_environment_check CHECK (
    environment IN ('development', 'staging', 'production')
  ),
  CONSTRAINT notification_device_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT notification_device_disabled_reason_not_blank_check CHECK (
    disabled_reason IS NULL OR disabled_reason <> ''
  ),
  -- A reason exists exactly when the row is disabled.
  CONSTRAINT notification_device_disabled_reason_scope_check CHECK (
    (status = 'disabled') = (disabled_reason IS NOT NULL)
  ),
  -- One record per installation per profile — register-or-refresh upserts
  -- against this key.
  CONSTRAINT notification_device_installation_key UNIQUE (profile_id, installation_id)
);

-- A registration token identifies ONE app installation at the provider, so
-- two rows sharing a token would double-send and mis-route (account switch
-- on one physical device is the real case: the new profile's registration
-- must displace the old profile's record). Registration deletes other
-- holders of the token in the same transaction; this index makes the
-- invariant structural.
CREATE UNIQUE INDEX notification_device_token_key
  ON notifications.notification_device (fcm_token);

-- The delivery worker's per-recipient read: active devices only.
CREATE INDEX notification_device_profile_active_idx
  ON notifications.notification_device (profile_id)
  WHERE status = 'active';

-- Append-only record of FCM send attempts — one row per (intent, device)
-- send, written in the same transaction as the intent's delivery outcome.
-- Section 15's "send attempt, provider acceptance, invalid token" made
-- durable, and section 13's "Dead-letter failures are observable" at the
-- row level. `device_id` is a plain uuid with NO foreign key: device
-- records are revocable and deletable while attempt history is append-only
-- audit (the `notification_intent.garden_id` FK-free reasoning).
-- `error_code` is the provider's error identifier only, never the response
-- body ("Provider responses are not exposed directly to clients", and
-- tokens/payloads stay out of stored provider data).
CREATE TABLE notifications.notification_delivery_attempt (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL
    REFERENCES notifications.notification_intent (id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  outcome text NOT NULL,
  error_code text,
  attempted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Closed set: the FCM boundary classifies every send into exactly these
  -- four outcomes (the adapter's own mapping), and only code writes them.
  CONSTRAINT notification_delivery_attempt_outcome_check CHECK (
    outcome IN ('accepted', 'token_invalid', 'transient_failure', 'permanent_failure')
  ),
  CONSTRAINT notification_delivery_attempt_error_code_not_blank_check CHECK (
    error_code IS NULL OR error_code <> ''
  ),
  -- An accepted attempt has no error; every failure outcome names one.
  CONSTRAINT notification_delivery_attempt_error_code_scope_check CHECK (
    (outcome = 'accepted') = (error_code IS NULL)
  )
);

CREATE INDEX notification_delivery_attempt_intent_idx
  ON notifications.notification_delivery_attempt (intent_id);

-- The intent's delivery-worker columns:
--
-- - `next_delivery_attempt_at`: the worker's OWN scheduling column,
--   deliberately separate from `earliest_delivery_at` (the policy's
--   immutable creation-time fact). NULL means "never claimed"; the claim
--   advances it as a lease so concurrent sweep runs cannot double-send,
--   a quiet-hours recheck deferral parks it at the moved window's end,
--   and a transient failure parks it at the bounded-backoff retry time.
-- - `delivery_attempt_count`: how many FCM send rounds this intent has
--   consumed, bounding transient retries (section 13's "Transient errors
--   retry within intent expiration" plus a documented attempt budget).
-- - `close_reason`: the typed reason a delivery close chose `failed` or
--   `skipped` — section 15's "suppression reason" for the send-time
--   recheck, durable on the row it closed.
ALTER TABLE notifications.notification_intent
  ADD COLUMN next_delivery_attempt_at timestamptz,
  ADD COLUMN delivery_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN close_reason text;

ALTER TABLE notifications.notification_intent
  ADD CONSTRAINT notification_intent_attempt_count_check CHECK (delivery_attempt_count >= 0);

ALTER TABLE notifications.notification_intent
  ADD CONSTRAINT notification_intent_close_reason_not_blank_check CHECK (
    close_reason IS NULL OR close_reason <> ''
  );

-- A close reason accompanies exactly the two delivery-outcome closes that
-- carry one; `sent`, `superseded`, and `expired` explain themselves.
ALTER TABLE notifications.notification_intent
  ADD CONSTRAINT notification_intent_close_reason_scope_check CHECK (
    state IN ('failed', 'skipped') OR close_reason IS NULL
  );

-- The delivery-outcome vocabulary P7-NOTIF-01's own comment reserved for
-- this stage: `sent` (the provider accepted at least one device send —
-- acceptance, not confirmed display, section 15), `failed` (permanent
-- provider failure, exhausted retry budget, or no deliverable device),
-- `skipped` (a send-time recheck said not to send, with the typed reason
-- in `close_reason`). All three are terminal delivery outcomes and remain
-- INBOX-visible — "Push delivery success does not determine inbox state"
-- (section 12) — unlike the content-lifecycle closes `superseded`/`expired`.
ALTER TABLE notifications.notification_intent
  DROP CONSTRAINT notification_intent_state_check;
ALTER TABLE notifications.notification_intent
  ADD CONSTRAINT notification_intent_state_check CHECK (
    state IN ('pending', 'superseded', 'expired', 'sent', 'failed', 'skipped')
  );

-- The inbox partial index follows the visibility rule: delivery outcomes
-- stay listed, content closes leave.
DROP INDEX notifications.notification_intent_inbox_idx;
CREATE INDEX notification_intent_inbox_idx
  ON notifications.notification_intent (recipient_profile_id, id DESC)
  WHERE state IN ('pending', 'sent', 'failed', 'skipped');

-- The delivery claim: due, push-eligible, still pending.
CREATE INDEX notification_intent_delivery_due_idx
  ON notifications.notification_intent (earliest_delivery_at)
  WHERE state = 'pending' AND channel_push;

-- The sweep's at-scale expiry close (the P7-NOTIF-01 deferred item:
-- recipients who never open their inbox).
CREATE INDEX notification_intent_pending_expiry_idx
  ON notifications.notification_intent (expires_at)
  WHERE state = 'pending';

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS notifications.notification_delivery_attempt CASCADE;
DROP TABLE IF EXISTS notifications.notification_device CASCADE;

DROP INDEX IF EXISTS notifications.notification_intent_delivery_due_idx;
DROP INDEX IF EXISTS notifications.notification_intent_pending_expiry_idx;
DROP INDEX IF EXISTS notifications.notification_intent_inbox_idx;
CREATE INDEX notification_intent_inbox_idx
  ON notifications.notification_intent (recipient_profile_id, id DESC)
  WHERE state = 'pending';

-- Rows in delivery-outcome states cannot exist under the restored CHECK.
-- They return to `pending` — the only honest pre-delivery state: every one
-- of them WAS pending before this stage's worker touched it, and `pending`
-- keeps them inbox-visible exactly as the downgraded world lists them
-- (the read-triggered expiry close then handles any that have lapsed).
UPDATE notifications.notification_intent
  SET state = 'pending', close_reason = NULL, revision = revision + 1, updated_at = now()
  WHERE state IN ('sent', 'failed', 'skipped');

ALTER TABLE notifications.notification_intent
  DROP CONSTRAINT notification_intent_close_reason_scope_check;
ALTER TABLE notifications.notification_intent
  DROP CONSTRAINT notification_intent_close_reason_not_blank_check;
ALTER TABLE notifications.notification_intent
  DROP CONSTRAINT notification_intent_attempt_count_check;
ALTER TABLE notifications.notification_intent
  DROP CONSTRAINT notification_intent_state_check;
ALTER TABLE notifications.notification_intent
  ADD CONSTRAINT notification_intent_state_check CHECK (
    state IN ('pending', 'superseded', 'expired')
  );

ALTER TABLE notifications.notification_intent
  DROP COLUMN close_reason,
  DROP COLUMN delivery_attempt_count,
  DROP COLUMN next_delivery_attempt_at;

RESET ROLE;
