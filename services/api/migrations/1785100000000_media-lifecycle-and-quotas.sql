-- Media lifecycle and quotas: extends the deliberately minimal
-- `media.media_record` created by 1784900000000_plants-observations-tasks-
-- baseline.sql into the real thing that migration's own comment deferred —
-- ownership, class, checksum, upload/processing state, variants,
-- relationships, and retention — plus a new `media.quota_reservation` table.
-- This is P6-DATA-01: data model and domain logic only. No HTTP endpoint,
-- no Cloud Storage interaction, no bucket/infrastructure provisioning, and
-- no numeric quota LIMITS — those remain P6-PLAT-01, P6-API-01, and (for
-- limits specifically) a still-undecided implementation-time selection
-- (implementation-plan.md, section "14.2 Implementation-Time Selections"
-- lists "Quotas" explicitly as not yet decided; no numeric budget for any
-- quota dimension exists anywhere in this repository's docs today). This
-- migration builds the reservation *mechanism* (a table plus a pure
-- reserve/commit/release state machine in
-- `services/api/src/modules/media/domain/quota-reservation.ts`), never an
-- enforced number.
--
-- Backfill posture: every new NOT NULL column below is added with no
-- `DEFAULT` and no data backfill, because `media.media_record` is judged to
-- be empty in every real environment today, not merely in fresh test
-- databases. Three independent facts support this: (1) the only writer is
-- `RegisterMediaRecord.execute()`, and `modules/media/public.ts`'s own doc
-- comment says this module "has no transport of its own this pass" — there
-- is no HTTP route anywhere that can reach it; (2) `app.ts` wires
-- `registerMediaRecord` but never calls it — its own inline comment says so
-- directly ("nothing in this file reads `mediaRepository` or
-- `registerMediaRecord` today"); (3) `docs/development/deferred-
-- capabilities.md`'s "Photo and file attachment" entry states plainly that
-- "this codebase has no upload flow yet: nothing can produce a `mediaId`"
-- for any of the five commands that would consume one. No iOS or web
-- feature calls any path that reaches `RegisterMediaRecord` either. A
-- `DEFAULT`-free `ADD COLUMN ... NOT NULL` is therefore safe against every
-- real deployment of this service as it stands, and adding one anyway would
-- misrepresent the intended shape of a column no real row will ever
-- legitimately violate.
--
-- Source: implementation-plan.md work package P6-DATA-01;
--         architecture/media-storage-and-processing.md, sections
--         "3. Media Classes", "5. Media Record", "6. Upload State Machine",
--         "17. Quotas".

-- Up Migration

SET ROLE verdery_migration;

-- Identity, ownership, and class. `storage_reference` (an opaque
-- placeholder the original migration's own comment called "what it
-- actually resolves to is that future module's concern") is retired in
-- favor of the real `bucket_name`/`object_key` pair added below, which
-- together are what it always stood in for. `mime_type` is renamed to
-- `declared_content_type` to carry section 5's exact vocabulary now that
-- its verified counterpart (`verified_content_type`, added below) exists
-- alongside it — the bare name `mime_type` would no longer say which of the
-- two columns it is.
--
-- `garden_id` is nullable, not immutable-and-required like
-- `plants_inventory.plant.garden_id`: unlike a plant (which only ever comes
-- into being already inside a known garden), a media row's own registration
-- step (architecture/media-storage-and-processing.md, section "7. Upload
-- Flow", step 2) happens before Cloud Storage or any downstream attachment
-- exists, and the attachment itself — to a plant photo, observation photo,
-- task attachment, or (once P6-PLAN-01 lands) an `importedBackground`
-- garden object — is always a separate row in a separate join table created
-- afterward, never a fact this table's own INSERT statement is in a
-- position to know. `implementation-plan.md`'s own onboarding flow
-- ("Start from a blank canvas, contextual imagery, or an imported property
-- plan") is one concrete case where a plan's raw upload plausibly precedes
-- the garden it will help create. Left nullable so an upload can be
-- registered, authorized, and even completed before any garden claims it.
--
-- `media_class` matches section 3's table exactly: `garden_photo`,
-- `imported_plan`, `raw_capture`, `derived_preview`, `processing_output`,
-- `export_package`. Section 5's own bullet reads "Media class and purpose"
-- (paired the same way "Declared and verified content type" pairs two
-- columns into one bullet), but unlike every other paired bullet, no
-- document anywhere in this repository gives "purpose" a vocabulary of its
-- own distinct from class — section 7 and section 12 both use the word
-- descriptively ("the media purpose and garden role"), never as an
-- enumerated field. Adding a second, undefined free-text/enum column here
-- would be exactly the kind of ungrounded invention this stage's own quota
-- guidance warns against; `media_class` alone is what "purpose" resolves to
-- until a real document defines a distinct vocabulary for it.
--
-- `display_filename` is the user-facing name after the normalization
-- `domain/media-record.ts`'s `normalizeDisplayFilename` performs (strips
-- directory components, control characters, and excess length) — never the
-- opaque object key, which stays a `<shard>/<mediaUuid>/<objectUuid>` value
-- per section 4 and is never derived from this column.
ALTER TABLE media.media_record
  RENAME COLUMN mime_type TO declared_content_type;

ALTER TABLE media.media_record
  DROP COLUMN storage_reference,
  ADD COLUMN garden_id uuid REFERENCES gardens_mapping.garden (id),
  ADD COLUMN media_class text,
  ADD COLUMN display_filename text;

-- Backfill-free per this migration's own header comment. Split from the
-- rename/drop/add block above only because a column cannot be made NOT NULL
-- in the same ALTER TABLE statement that just added it as nullable above
-- without a second pass in some PostgreSQL versions this project targets;
-- kept as an explicit, separate step for the same reason `garden_object`'s
-- CHECK constraints are listed individually rather than folded silently
-- into column definitions.
ALTER TABLE media.media_record
  ALTER COLUMN media_class SET NOT NULL,
  ALTER COLUMN display_filename SET NOT NULL,
  ADD CONSTRAINT media_record_media_class_check CHECK (media_class IN (
    'garden_photo', 'imported_plan', 'raw_capture', 'derived_preview',
    'processing_output', 'export_package'
  ));

-- Content verification. `declared_content_type` (renamed above) and
-- `declared_byte_size` are always supplied at registration — section 7,
-- step 1 lists "metadata, purpose, size, content type" without the
-- "when available" qualifier step 1 gives checksum alone — so both are
-- `NOT NULL`. Their `verified_*` counterparts are this stage's schema-only
-- placeholder for a later verifier (P6-API-01/P6-WORKER-01) to populate;
-- nullable until that stage exists. `checksum_sha256` is nullable for the
-- same "when available" reason step 1 gives it explicitly, and carries a
-- format CHECK (64 lowercase hex characters) as a cheap defense against a
-- structurally wrong value reaching a column nothing yet reads.
ALTER TABLE media.media_record
  ADD COLUMN declared_byte_size bigint,
  ADD COLUMN verified_content_type text,
  ADD COLUMN verified_byte_size bigint,
  ADD COLUMN checksum_sha256 text;

ALTER TABLE media.media_record
  ALTER COLUMN declared_byte_size SET NOT NULL,
  ADD CONSTRAINT media_record_declared_byte_size_positive_check
    CHECK (declared_byte_size > 0),
  ADD CONSTRAINT media_record_verified_byte_size_positive_check
    CHECK (verified_byte_size IS NULL OR verified_byte_size > 0),
  ADD CONSTRAINT media_record_checksum_sha256_format_check
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');

-- Storage target. Nullable until P6-API-01/P6-PLAT-01 create a real
-- resumable Cloud Storage upload session and assign the object its bucket
-- and key — this migration only adds the columns
-- `domain/media-lifecycle.ts`'s `authorizeMediaUpload` transition writes
-- once that session exists; it does not create one itself, and nothing in
-- this migration or the application code it backs touches Cloud Storage.
-- The pair is always set or unset together (never one without the other),
-- and once both are set, the same physical object can never be claimed by
-- two rows.
ALTER TABLE media.media_record
  ADD COLUMN bucket_name text,
  ADD COLUMN object_key text,
  ADD CONSTRAINT media_record_storage_target_pairing_check
    CHECK ((bucket_name IS NULL) = (object_key IS NULL));

CREATE UNIQUE INDEX media_record_bucket_object_key_key
  ON media.media_record (bucket_name, object_key)
  WHERE object_key IS NOT NULL;

-- Upload state machine (section 6's diagram), one column, ten states.
-- Deliberately ONE column, not two, despite section 5 listing "Upload
-- state." and "Processing state." as separate bullets: section 6's own
-- diagram draws `registered` through `deleted` as a single connected graph
-- using one arrow style throughout, with `processing`/`processed`/
-- `processing_failed` as ordinary nodes on that same graph, not a second,
-- visually distinct sub-diagram. A literal reading of that one diagram is a
-- single state machine, matching how every other lifecycle column in this
-- codebase (`plant.status`, `task.status`) is one column, not several.
--
-- `processing_state` in this migration is therefore NOT that second column
-- — see the constraint's own name below — it exists for a different,
-- narrower reason: the diagram draws `available` with two *independent*
-- outgoing branches (one to `processing`/`processed`/`processing_failed`,
-- one straight down to `deletion_scheduled`), and no arrow anywhere leads
-- from `processed` or `processing_failed` back to `deletion_scheduled`. Read
-- as one column, that would make a processed media row's own deletion path
-- unreachable — a genuine correctness gap, not a stylistic one, since
-- section 12's download flow expects an `available` original to stay
-- selectable ("Selects an appropriate original or derivative") independent
-- of whatever a background derivative job is doing to it. Two orthogonal
-- columns resolve this cleanly: `upload_state` alone gates availability and
-- deletion eligibility (`available` -> `deletion_scheduled` -> `deleted`,
-- exactly the diagram's own vertical trunk), while `processing_state`
-- independently tracks a derivative pipeline that can start, finish, or
-- fail without ever moving `upload_state` off `available`. This is the
-- most literal reading of the diagram's own two-branches-from-one-node
-- shape available without inventing an edge the diagram does not draw.
--
-- `processing_state` stays NULL until `beginMediaProcessing` starts it —
-- NULL means "not started" for a class that will eventually process, and
-- "not applicable" for one that never will (this stage does not decide
-- which classes require processing; that policy is a future stage's own
-- concern the diagram gives no vocabulary for yet). No back-edge from
-- `processing_failed` to `processing` is modeled: the diagram draws none,
-- and adding an undocumented retry transition is exactly the kind of
-- invention this migration's own posture avoids.
ALTER TABLE media.media_record
  ADD COLUMN upload_state text NOT NULL DEFAULT 'registered',
  ADD COLUMN processing_state text,
  ADD CONSTRAINT media_record_upload_state_check CHECK (upload_state IN (
    'registered', 'authorized', 'uploading', 'verifying', 'rejected',
    'available', 'deletion_scheduled', 'deleted'
  )),
  ADD CONSTRAINT media_record_processing_state_check CHECK (processing_state IN (
    'processing', 'processed', 'processing_failed'
  ));

-- `revision`/`updated_at`: section 6's own words, "Transitions are
-- server-owned and revisioned," mirrored the same way
-- `plants_inventory.plant.revision` and `tasks_recommendations.task.
-- revision` implement "revisioned" for their own lifecycle columns — a
-- plain optimistic-concurrency counter, not a revision journal table (no
-- work package in this stage's own scope asks for one, unlike
-- `plant_revision`/`task_revision`, and this migration does not add one).
ALTER TABLE media.media_record
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Relationships and retention.
--
-- `capture_session_id` is a bare, FK-less uuid: Garden Scan/AR capture
-- sessions (Phase 10) do not exist as a table anywhere in this codebase
-- yet, so there is nothing to reference. Added now anyway, not deferred
-- entirely, matching the precedent
-- `1785000000000_synchronization-baseline.sql` already sets for
-- `platform.sync_client_installation.revoked_at` ("the column is added now
-- so the row shape does not need a second migration once that endpoint
-- exists"). A real FK arrives with Phase 10's own migration.
--
-- The "or observation" half of section 5's "Capture or observation
-- relationships" bullet needs no new column at all: that relationship
-- already exists, in the other direction, as
-- `observations_history.observation_photo.media_id` (created by
-- 1784900000000_plants-observations-tasks-baseline.sql). Adding a second,
-- competing `observation_id` pointer here would duplicate a fact that
-- table's own row already states.
--
-- `sensitivity_classification` has no document-given vocabulary either, so
-- one is derived here from two concrete textual signals section 5's own
-- document gives elsewhere: section 12 draws a hard two-way line for viewer
-- access ("ordinary accepted photos ... but not raw scan artifacts unless
-- explicitly allowed"), and section 11 calls plan documents "sensitive
-- documents" outright. Three values capture both signals without merging
-- them: `standard` (ordinary photos and rebuildable derivatives),
-- `sensitive` (plans, processing diagnostics, and export bundles — all
-- called out by name as needing more care), `restricted` (raw capture,
-- section 12's own "unless explicitly allowed" case). `domain/media-record.
-- ts`'s `deriveDefaultSensitivityClassification` computes this from
-- `media_class` at registration; the column itself stays a plain, always-set
-- value rather than a computed/generated one so a later policy override
-- stays possible without a schema change.
--
-- `retention_deadline_at` stays NULL at registration for every class,
-- including `raw_capture`: section 3's "30 days after successful
-- extraction" is anchored to an event (successful extraction) this stage
-- has no producer for, and `export_package`'s "short-lived automatic
-- expiration" names no concrete duration anywhere in this repository's
-- docs — the same "no number decided yet" posture this migration's own
-- header comment already applies to quota limits. Computing a real deadline
-- is a later stage's job once these events and durations exist.
--
-- `derived_from_media_id` is the "Original/derivative relationships" field:
-- a derivative is itself an ordinary `media_record` row (typically
-- `media_class = 'derived_preview'` or `'processing_output'`) whose own
-- `derived_from_media_id` points at the original it was produced from —
-- confirmed by section 9's own words, "Derivative generation is idempotent
-- and addressed by source checksum plus transformation version," which
-- describes a derivative as an addressable row, not a separate join
-- concept. `transformation_version` is that same sentence's "transformation
-- version": meaningful only on a derivative row, enforced by the paired
-- CHECK below.
ALTER TABLE media.media_record
  ADD COLUMN capture_session_id uuid,
  ADD COLUMN sensitivity_classification text,
  ADD COLUMN retention_deadline_at timestamptz,
  ADD COLUMN derived_from_media_id uuid REFERENCES media.media_record (id),
  ADD COLUMN transformation_version integer;

ALTER TABLE media.media_record
  ALTER COLUMN sensitivity_classification SET NOT NULL,
  ADD CONSTRAINT media_record_sensitivity_classification_check
    CHECK (sensitivity_classification IN ('standard', 'sensitive', 'restricted')),
  ADD CONSTRAINT media_record_transformation_version_requires_derivative_check
    CHECK (transformation_version IS NULL OR derived_from_media_id IS NOT NULL);

-- Serves "media in this garden, filtered by upload state" listing queries,
-- the same judgment `plant_garden_status_idx`/`task_garden_status_idx`
-- already make for their own tables; partial because `garden_id` is
-- nullable.
CREATE INDEX media_record_garden_upload_state_idx
  ON media.media_record (garden_id, upload_state) WHERE garden_id IS NOT NULL;

-- Serves "every derivative of this original" lookups (section 9's
-- thumbnail/preview/high-resolution/metadata-stripped set, all pointing
-- back at one original via this column).
CREATE INDEX media_record_derived_from_media_id_idx
  ON media.media_record (derived_from_media_id) WHERE derived_from_media_id IS NOT NULL;

-- Quota reservations (section 17). "Garden and account stored bytes" is
-- named explicitly, so `scope_kind` covers exactly those two, mirroring
-- `tasks_recommendations.task`'s own `target_kind`/consistency-CHECK
-- pattern for a one-of-two-references field. `account` here means
-- `identity_access.profile`, this codebase's own name for what section 17
-- calls an account elsewhere (`identity_access.profile` is already the FK
-- target every "actor"/"creator" column in this schema uses).
--
-- `media_id` is required, not optional: this table's own reason to exist
-- is "atomically check-and-reserve before authorizing an upload"
-- (implementation-plan.md work package P6-DATA-01's own words) — every
-- reservation this stage's domain model produces is for one specific
-- upload's media row, created no earlier than that row itself
-- (`registered`) and typically at the same step as `authorizeMediaUpload`.
--
-- `state` implements "Quota reservation and release are idempotent"
-- (section 17) at the domain layer: `domain/quota-reservation.ts`'s
-- `releaseQuotaReservation` treats an already-`released` reservation as a
-- no-op, matching `plants-inventory/domain/plant-lifecycle.ts`'s own "a
-- transition to the value already held is accepted rather than rejected"
-- precedent. `commitQuotaReservation` is not documented as idempotent by
-- section 17 (only "reservation and release" are named), so it is not
-- treated as one: committing an already-committed or already-released
-- reservation is rejected.
--
-- This migration builds the table and the pure domain transition functions
-- only — no numeric quota LIMIT is enforced anywhere here, and no
-- application-layer command reads or writes this table yet; that is
-- explicitly a future API-layer stage's job per this migration's own header
-- comment.
CREATE TABLE media.quota_reservation (
  id uuid PRIMARY KEY,
  scope_kind text NOT NULL,
  scope_garden_id uuid REFERENCES gardens_mapping.garden (id),
  scope_profile_id uuid REFERENCES identity_access.profile (id),
  media_id uuid NOT NULL REFERENCES media.media_record (id),
  reserved_bytes bigint NOT NULL,
  state text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quota_reservation_scope_kind_check CHECK (scope_kind IN ('garden', 'account')),
  CONSTRAINT quota_reservation_scope_consistency_check CHECK (
    (scope_kind = 'garden' AND scope_garden_id IS NOT NULL AND scope_profile_id IS NULL)
    OR (scope_kind = 'account' AND scope_profile_id IS NOT NULL AND scope_garden_id IS NULL)
  ),
  CONSTRAINT quota_reservation_reserved_bytes_positive_check CHECK (reserved_bytes > 0),
  CONSTRAINT quota_reservation_state_check CHECK (state IN ('reserved', 'committed', 'released'))
);

-- Serves "release every outstanding reservation for this media" (an
-- abandoned-upload cleanup job, per section 17's "A failed abandoned
-- upload eventually releases reserved capacity").
CREATE INDEX quota_reservation_media_id_idx ON media.quota_reservation (media_id);

-- Serve a future "current reserved+committed bytes for this garden/account"
-- summation query — the exact check the doc's own "atomically check-and-
-- reserve before authorizing an upload" flow needs, without this stage
-- implementing that summation itself.
CREATE INDEX quota_reservation_scope_garden_state_idx
  ON media.quota_reservation (scope_garden_id, state) WHERE scope_garden_id IS NOT NULL;
CREATE INDEX quota_reservation_scope_profile_state_idx
  ON media.quota_reservation (scope_profile_id, state) WHERE scope_profile_id IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS media.quota_reservation CASCADE;

DROP INDEX IF EXISTS media.media_record_derived_from_media_id_idx;
DROP INDEX IF EXISTS media.media_record_garden_upload_state_idx;
DROP INDEX IF EXISTS media.media_record_bucket_object_key_key;

ALTER TABLE media.media_record
  DROP CONSTRAINT IF EXISTS media_record_transformation_version_requires_derivative_check,
  DROP CONSTRAINT IF EXISTS media_record_sensitivity_classification_check,
  DROP CONSTRAINT IF EXISTS media_record_processing_state_check,
  DROP CONSTRAINT IF EXISTS media_record_upload_state_check,
  DROP CONSTRAINT IF EXISTS media_record_storage_target_pairing_check,
  DROP CONSTRAINT IF EXISTS media_record_checksum_sha256_format_check,
  DROP CONSTRAINT IF EXISTS media_record_verified_byte_size_positive_check,
  DROP CONSTRAINT IF EXISTS media_record_declared_byte_size_positive_check,
  DROP CONSTRAINT IF EXISTS media_record_media_class_check,
  DROP COLUMN IF EXISTS transformation_version,
  DROP COLUMN IF EXISTS derived_from_media_id,
  DROP COLUMN IF EXISTS retention_deadline_at,
  DROP COLUMN IF EXISTS sensitivity_classification,
  DROP COLUMN IF EXISTS capture_session_id,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS processing_state,
  DROP COLUMN IF EXISTS upload_state,
  DROP COLUMN IF EXISTS object_key,
  DROP COLUMN IF EXISTS bucket_name,
  DROP COLUMN IF EXISTS checksum_sha256,
  DROP COLUMN IF EXISTS verified_byte_size,
  DROP COLUMN IF EXISTS verified_content_type,
  DROP COLUMN IF EXISTS declared_byte_size,
  DROP COLUMN IF EXISTS display_filename,
  DROP COLUMN IF EXISTS media_class,
  DROP COLUMN IF EXISTS garden_id;

-- Restored with a temporary DEFAULT so this succeeds even against a
-- populated table (this migration's own test inserts rows before rolling
-- back) — dropped immediately after, so the column ends up in exactly the
-- shape 1784900000000_plants-observations-tasks-baseline.sql originally
-- defined: `NOT NULL`, no default.
ALTER TABLE media.media_record
  ADD COLUMN storage_reference text NOT NULL DEFAULT '';
ALTER TABLE media.media_record
  ALTER COLUMN storage_reference DROP DEFAULT;

ALTER TABLE media.media_record
  RENAME COLUMN declared_content_type TO mime_type;

RESET ROLE;
