-- Notifications baseline: the `notifications` module's first tables — durable
-- per-recipient notification intents (which double as the in-app inbox
-- record), per-type/per-channel preference entries with optional per-garden
-- overrides, and the per-profile preference document carrying quiet hours,
-- a time-zone override, and the document revision — plus the module schema
-- itself.
--
-- This is P7-NOTIF-01: intents, inbox, preferences, quiet hours, time zones,
-- deduplication, expiry, and deep links. Push DELIVERY is deliberately
-- absent: device-token records and FCM dispatch are P7-NOTIF-02's, and
-- nothing below anticipates them with dead columns — the intent's own
-- `channel_push` eligibility flag and `earliest_delivery_at` are facts THIS
-- stage's policy already decides (notifications.md section 4's intent field
-- list), not delivery machinery.
--
-- Schema creation: the platform baseline (1784710800000_platform-baseline.sql)
-- created one schema per module that existed then; `notifications` is first
-- materialized here with the identical ownership/privilege posture the
-- `integrations` schema followed (1785700000000_integrations-weather-baseline
-- .sql): owned by `verdery_migration`, USAGE plus default-privilege row
-- access for `verdery_application`, nothing for PUBLIC. `verdery_worker`
-- deliberately gets NOTHING: the workers relay only forwards outbox events
-- to the API's own OIDC-verified policy endpoint (its existing
-- `platform.outbox_event` grants suffice), and the notification policy's
-- membership/preference/candidate reads run in `services/api` — the same
-- privilege boundary the scheduled sweeps document.
--
-- Backfill posture: every table is new; no existing row is rewritten and no
-- existing table is altered.
--
-- Source: implementation-plan.md work package P7-NOTIF-01;
--         architecture/notifications.md, sections "4. Notification Intent",
--         "5. Flow", "7. Preferences", "9. Scheduling", "10. Deduplication",
--         "11. Deep Links", "12. In-App Inbox".

-- Up Migration

-- Schema creation and privilege wiring run as the CONNECTED migration
-- identity, not under SET ROLE — see the integrations baseline's identical
-- block for why (`verdery_migration` owns schemas by AUTHORIZATION but holds
-- no CREATE on the database; the connected identity holds membership).
CREATE SCHEMA IF NOT EXISTS notifications AUTHORIZATION verdery_migration;

REVOKE ALL ON SCHEMA notifications FROM PUBLIC;
GRANT USAGE ON SCHEMA notifications TO verdery_application;

ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA notifications
  GRANT USAGE, SELECT ON SEQUENCES TO verdery_application;

SET ROLE verdery_migration;

-- One durable notification intent per recipient — notifications.md section
-- 4's field list, one column set per bullet:
--
--   "Intent UUIDv7"                      -> id
--   "Type and version"                   -> intent_type + intent_version
--   "Recipient profile"                  -> recipient_profile_id
--   "Garden context where applicable"    -> garden_id
--   "Stable template key and structured
--    parameters"                         -> template_key + template_parameters
--   "Priority"                           -> priority
--   "Earliest delivery and expiration"   -> earliest_delivery_at + expires_at
--   "Deduplication key"                  -> dedup_key (unique per recipient)
--   "Channel eligibility"                -> channel_in_app + channel_push
--   "Deep-link destination"              -> deep_link
--   "Source event and trace context"     -> source_event_id + trace_id
--
-- The intent IS the in-app inbox record (section 12: "The inbox is the
-- durable user-facing record"): `read_at`/`dismissed_at` carry the inbox
-- view state, deliberately separate columns from the delivery-lifecycle
-- `state` because "Push delivery success does not determine inbox state" —
-- a read or dismissed entry is still the same durable intent, and an entry
-- may be read after it expired without resurrecting it.
--
-- `recipient_profile_id` cascades on profile deletion (the
-- `platform.idempotency_record` precedent): a purged account takes its
-- inbox with it. `garden_id`, `recommendation_candidate_id`, and
-- `source_event_id` are deliberately plain uuids with NO foreign key — an
-- intent must remain readable after its subject is purged (the
-- `platform.outbox_event.aggregate_id` reasoning), and section 11 requires
-- the client to open a safe fallback for an unavailable resource, which
-- presumes the notification can outlive what it points at. The freshness
-- recheck treats a missing candidate as stale, never as an error.
--
-- `state` is the delivery lifecycle this stage can actually reach:
-- `pending` (persisted, awaiting the delivery worker), `superseded` (a
-- newer candidate's intent replaced it before delivery — section 16's
-- "Recommendation superseded before delivery"), and `expired` (closed
-- without delivery after `expires_at` — section 13). Sent/failed vocabulary
-- arrives with P7-NOTIF-02's delivery worker, the first code that can reach
-- it — the same "a state nothing can transition into would be untested dead
-- code" posture `gardens_mapping.garden.lifecycle_state` documents.
--
-- `revision` is the same plain optimistic-concurrency counter
-- `tasks_recommendations.recommendation_candidate` uses, bumped on every
-- mutation so P7-NOTIF-02's send worker can make revision-guarded terminal
-- transitions (asynchronous-processing.md section 10: "Late results from
-- superseded attempts cannot overwrite newer state").
CREATE TABLE notifications.notification_intent (
  id uuid PRIMARY KEY,
  intent_type text NOT NULL,
  intent_version integer NOT NULL DEFAULT 1,
  recipient_profile_id uuid NOT NULL
    REFERENCES identity_access.profile (id) ON DELETE CASCADE,
  garden_id uuid NOT NULL,
  recommendation_candidate_id uuid,
  source_event_id uuid NOT NULL,
  trace_id text,
  template_key text NOT NULL,
  template_parameters jsonb NOT NULL,
  priority text NOT NULL,
  channel_in_app boolean NOT NULL,
  channel_push boolean NOT NULL,
  deep_link jsonb NOT NULL,
  dedup_key text NOT NULL,
  earliest_delivery_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  read_at timestamptz,
  dismissed_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- `intent_type` is free text under a non-blank CHECK, not an enumerated
  -- set: the vocabulary is application-owned and grows with the product
  -- (client publications, invitations), the exact
  -- `identity_access.consent_record.consent_type` posture. The application
  -- validates types in code, where a mistake costs a code change.
  CONSTRAINT notification_intent_type_check CHECK (intent_type <> ''),
  CONSTRAINT notification_intent_version_positive_check CHECK (intent_version > 0),
  CONSTRAINT notification_intent_template_key_check CHECK (template_key <> ''),
  CONSTRAINT notification_intent_dedup_key_check CHECK (dedup_key <> ''),
  -- Two priorities, matching what push transports distinguish; a closed set
  -- because the policy alone writes it, from a closed mapping.
  CONSTRAINT notification_intent_priority_check CHECK (priority IN ('normal', 'high')),
  CONSTRAINT notification_intent_state_check CHECK (
    state IN ('pending', 'superseded', 'expired')
  ),
  -- An intent with no eligible channel is a policy suppression, never a row:
  -- persisting one would fabricate an inbox-invisible, push-ineligible
  -- record no flow could ever act on.
  CONSTRAINT notification_intent_channel_check CHECK (channel_in_app OR channel_push),
  -- One implication, antecedent naming only the type that requires the
  -- linkage, so state/type VOCABULARY stays each vocabulary CHECK's single
  -- concern — the recommendation-explanation CHECK's own recorded lesson.
  CONSTRAINT notification_intent_candidate_linkage_check CHECK (
    intent_type <> 'care_recommendation' OR recommendation_candidate_id IS NOT NULL
  )
);

-- "Repeated event delivery must not create repeated user notifications"
-- (section 10) made structural: the policy's insert is ON CONFLICT DO
-- NOTHING against this index, so a redelivered event — the relay's own
-- publish-then-record crash window — collapses per recipient. Full
-- uniqueness across terminal states too: a replay must not recreate an
-- intent that has since expired or been superseded.
CREATE UNIQUE INDEX notification_intent_recipient_dedup_key
  ON notifications.notification_intent (recipient_profile_id, dedup_key);

-- The inbox read: one recipient's live entries, newest first. UUIDv7 ids
-- give the index time-ordering (the keyset cursor's ordering key); partial
-- on `pending` because every inbox query filters to it.
CREATE INDEX notification_intent_inbox_idx
  ON notifications.notification_intent (recipient_profile_id, id DESC)
  WHERE state = 'pending';

-- The supersession close: "close every pending intent about candidate X"
-- when a newer candidate's event names X in `supersedesCandidateId`.
CREATE INDEX notification_intent_candidate_pending_idx
  ON notifications.notification_intent (recommendation_candidate_id)
  WHERE state = 'pending';

-- One explicit per-type toggle row; absence means the documented default
-- (every channel enabled). `garden_id` NULL is the profile's global setting
-- for the type; a non-null garden overrides it for that one garden
-- (section 7 lists "Garden" as a preference dimension). The FK on garden is
-- real — a preference override targets a garden that exists; gardens have
-- no purge path today, and the stage that builds one owns the cascade
-- decision. Channels are two booleans, not a channel dimension row: the
-- channel set is closed and small (in-app, push; email arrives with client
-- sharing and brings its own column additively).
CREATE TABLE notifications.notification_preference (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL
    REFERENCES identity_access.profile (id) ON DELETE CASCADE,
  garden_id uuid REFERENCES gardens_mapping.garden (id),
  notification_type text NOT NULL,
  in_app_enabled boolean NOT NULL,
  push_enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preference_type_check CHECK (notification_type <> ''),
  -- NULLS NOT DISTINCT: one global row (garden_id NULL) per type is a real
  -- uniqueness constraint, not two rows Postgres's default NULL semantics
  -- would silently allow.
  CONSTRAINT notification_preference_scope_key
    UNIQUE NULLS NOT DISTINCT (profile_id, notification_type, garden_id)
);

CREATE INDEX notification_preference_garden_id_idx
  ON notifications.notification_preference (garden_id);

-- The per-profile preference document: quiet hours, the optional time-zone
-- override, and the document revision the whole-document PUT guards with
-- If-Match. Quiet hours live here, not on preference entries, because they
-- are a fact about the RECIPIENT's day (one do-not-push window per person),
-- not about a type or a garden. Minutes after local midnight; the window
-- may wrap midnight (start > end means 22:00-07:00). `start = end` is
-- rejected: an always-quiet day is expressed by disabling the push channel,
-- not by a degenerate window. `quiet_hours_time_zone` is an IANA zone
-- override, validated in code (Postgres's own zone list drifts from ICU's);
-- NULL means the profile's own `time_zone` applies — the zone exists as a
-- preference because notifications.md section 7 names it one, and it is
-- meaningless without a window to evaluate, hence the implication CHECK.
CREATE TABLE notifications.notification_preference_document (
  profile_id uuid PRIMARY KEY
    REFERENCES identity_access.profile (id) ON DELETE CASCADE,
  quiet_hours_start_minute smallint,
  quiet_hours_end_minute smallint,
  quiet_hours_time_zone text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preference_document_quiet_hours_pairing_check CHECK (
    (quiet_hours_start_minute IS NULL) = (quiet_hours_end_minute IS NULL)
  ),
  CONSTRAINT notification_preference_document_quiet_hours_range_check CHECK (
    quiet_hours_start_minute IS NULL
    OR (
      quiet_hours_start_minute BETWEEN 0 AND 1439
      AND quiet_hours_end_minute BETWEEN 0 AND 1439
      AND quiet_hours_start_minute <> quiet_hours_end_minute
    )
  ),
  CONSTRAINT notification_preference_document_zone_requires_window_check CHECK (
    quiet_hours_time_zone IS NULL OR quiet_hours_start_minute IS NOT NULL
  ),
  CONSTRAINT notification_preference_document_zone_not_blank_check CHECK (
    quiet_hours_time_zone IS NULL OR quiet_hours_time_zone <> ''
  )
);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS notifications.notification_preference_document CASCADE;
DROP TABLE IF EXISTS notifications.notification_preference CASCADE;
DROP TABLE IF EXISTS notifications.notification_intent CASCADE;

RESET ROLE;

-- Mirror of the integrations baseline's own down posture for a module
-- schema created outside the platform loop: revoke the default privileges
-- this migration granted, then drop the schema itself, as the connected
-- identity like the up direction's schema creation.
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA notifications
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA notifications
  REVOKE USAGE, SELECT ON SEQUENCES FROM verdery_application;

DROP SCHEMA IF EXISTS notifications CASCADE;
