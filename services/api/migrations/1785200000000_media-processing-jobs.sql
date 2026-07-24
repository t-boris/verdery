-- Durable media-processing job state (P6-ASYNC-01).
--
-- `media.media_record.processing_state` (added by
-- 1785100000000_media-lifecycle-and-quotas.sql) is a coarse, orthogonal
-- three-value summary — "not started / processing / processed /
-- processing_failed" — with no attempt tracking, no manifest, and no result
-- detail. This work package's own title calls for "durable job state",
-- distinct from that summary: one row per processing attempt, matching
-- architecture/media-storage-and-processing.md sections "13. Processing
-- Manifest" and "14. Processing Result" field-by-field (job/media IDs,
-- processor configuration version, input checksums, output objects and
-- checksums, structured result summary, quality diagnostics, resource and
-- duration metrics, terminal outcome code, attempt count) and
-- architecture/asynchronous-processing.md section "10. Job State Machine"
-- (`requested -> queued -> running -> succeeded|partial|failed_retryable
-- ->queued|failed_terminal|cancelled`, `queued -> expired`) for its `state`
-- vocabulary.
--
-- Relationship to `media_record.processing_state`: advancing a job's own
-- state ALSO drives `processing_state` forward, through a DIRECT WRITE in
-- the SAME transaction as the job's own terminal update — not a second
-- outbox event. `services/api/src/modules/media/application/record-media-
-- processing-result.ts` is that transaction: it loads the job, loads the
-- media record, applies `beginMediaProcessing`/`markMediaProcessed`/
-- `markMediaProcessingFailed` (all three already existed, unused, from
-- P6-DATA-01 — this stage is their first real caller), and writes both rows
-- before committing. A second outbox round trip would only add latency and
-- a duplicate-delivery surface for a write this service can already make
-- atomically against its own database. See that file's own header comment
-- for the full resolution, including why "verification" in this work
-- package's own title is satisfied by this stage's generic job-state
-- infrastructure rather than by a second synchronous verification pass —
-- P6-API-01's `CompleteMediaUpload` already performs the declared-vs-actual
-- verification section 7 describes synchronously; what this stage triggers
-- at the `available` transition is the first REAL processing stage
-- (derivative generation, P6-WORKER-02), using infrastructure general
-- enough for a future P6-WORKER-01 job kind to reuse unchanged.
--
-- `id` deliberately reuses the triggering `platform.outbox_event.id` rather
-- than minting an independent UUID: exactly one job exists per outbox event
-- in this stage's design (`media.processing_requested`), and reusing the
-- event's own id as the job's primary key turns "has this event already
-- produced a job" into a single `ON CONFLICT (id) DO NOTHING` — the
-- concrete mechanism behind this work package's own "duplicate delivery"
-- and "relay crash" completion evidence. See `services/workers/src/relay/
-- outbox-relay.ts`'s own header comment for the crash-recovery sequencing
-- this enables.
--
-- `verdery_worker` is a new, narrowly-scoped NOLOGIN role for the relay
-- (`services/workers`), distinct from `verdery_application` (the API) —
-- architecture/media-storage-and-processing.md section 18: "Separate
-- read/write permissions by worker role." It is NOT added to platform-
-- baseline.sql's per-schema default-privilege loop (which would hand it
-- full CRUD on every module's tables); it receives exactly the two grants
-- its own job needs: read+mark-published on `platform.outbox_event`, and
-- read+create+advance-to-queued on `media.processing_job`. It is never
-- granted anything on `media.media_record` — the relay never reads or
-- writes that table; see `record-media-processing-result.ts`'s own header
-- comment for why the media_record write happens in the API process
-- instead. Real Cloud SQL IAM identity mapping for this role (a dedicated
-- worker service account, granted membership the same way
-- `07-iam-database-bootstrap.sh` grants `verdery_application`/
-- `verdery_migration` membership today) is infrastructure-provisioning
-- work, drafted but not executed this stage — see
-- `infrastructure/gcloud/scripts/10-media-processing-queue.sh`.
--
-- Source: implementation-plan.md work package P6-ASYNC-01;
--         architecture/media-storage-and-processing.md, sections
--         "13. Processing Manifest", "14. Processing Result";
--         architecture/asynchronous-processing.md, sections
--         "4. Transactional Outbox", "10. Job State Machine",
--         "11. Idempotency";
--         architecture/data-and-geospatial-design.md, section
--         "18. Transactional Outbox".

-- Up Migration

-- Created BEFORE `SET ROLE verdery_migration`, not after: `CREATE ROLE`
-- requires the connecting/current role to hold `CREATEROLE` or be
-- superuser, and `verdery_migration` itself has neither (it is an ordinary
-- NOLOGIN group role with schema-level DDL rights, not database-role-
-- management rights) — confirmed directly the first time this migration ran
-- against a real least-privilege connection and failed with "permission
-- denied to create role" from inside `SET ROLE verdery_migration`.
-- `1784710800000_platform-baseline.sql` avoids this same trap for
-- `verdery_migration`/`verdery_application` themselves by creating both
-- roles before its own first `SET ROLE`; this migration now follows that
-- identical ordering for `verdery_worker`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_worker') THEN
    CREATE ROLE verdery_worker NOLOGIN;
  END IF;
END
$$;

SET ROLE verdery_migration;

-- `job_kind` is free text, not yet a CHECK-enumerated set: this stage
-- produces exactly one kind (`derivative_generation`, the resolution
-- documented above), but a real P6-WORKER-01 stage will need its own kind
-- alongside it, and inventing that vocabulary's second member ahead of that
-- stage's own design would be exactly the kind of undocumented invention
-- this codebase's migrations consistently avoid (see, for example,
-- 1785100000000_media-lifecycle-and-quotas.sql's own reasoning for leaving
-- `retention_deadline_at` uncalculated). A `NOT NULL` free-text column keeps
-- every row honest about what produced it without pretending to enumerate
-- kinds this stage has no authority to define.
--
-- `state` is the asynchronous-processing.md section 10 vocabulary exactly:
-- nine nodes, including both the linear success path and every documented
-- branch (`partial`, `failed_retryable`, `failed_terminal`, `cancelled`,
-- `expired`). This stage's own real callers only ever drive
-- `requested -> queued -> succeeded` (see `record-media-processing-
-- result.ts`); the remaining states are real, tested pure domain
-- transitions (`domain/processing-job.ts`) with no live caller yet, the
-- same "define the shape now, wire the caller when the real stage needs it"
-- posture `beginMediaProcessing`/`markMediaProcessed`/
-- `markMediaProcessingFailed` themselves were left in from P6-DATA-01 until
-- this very stage gave them one.
--
-- `attempt`/`revision`: `attempt` is section 13's own field ("attempt
-- count"); `revision` is this codebase's universal optimistic-concurrency
-- column, added because asynchronous-processing.md section 10 states
-- "Transitions use expected attempt/revision checks. Late results from
-- superseded attempts cannot overwrite newer state" — a plain revision
-- guard on `updateState` (mirroring `MediaRepository.update`'s own
-- `expectedRevision` contract) is what makes that literal.
CREATE TABLE media.processing_job (
  id uuid PRIMARY KEY,
  media_id uuid NOT NULL REFERENCES media.media_record (id),
  job_kind text NOT NULL DEFAULT 'derivative_generation',
  processor_config_version text NOT NULL DEFAULT 'v1',
  state text NOT NULL DEFAULT 'requested',
  attempt integer NOT NULL DEFAULT 1,
  input_checksums jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_objects jsonb,
  result_summary jsonb,
  quality_diagnostics jsonb,
  resource_metrics jsonb,
  outcome_code text,
  trace_id text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_processing_job_job_kind_check
    CHECK (job_kind <> ''),
  CONSTRAINT media_processing_job_state_check CHECK (state IN (
    'requested', 'queued', 'running', 'succeeded', 'partial',
    'failed_retryable', 'failed_terminal', 'cancelled', 'expired'
  )),
  CONSTRAINT media_processing_job_attempt_positive_check CHECK (attempt > 0),
  -- A terminal outcome always carries the code that produced it; a
  -- non-terminal job never does, matching this table's own state machine
  -- literally rather than leaving the pairing implicit.
  CONSTRAINT media_processing_job_outcome_requires_terminal_check CHECK (
    (outcome_code IS NULL) = (state NOT IN (
      'succeeded', 'partial', 'failed_terminal', 'cancelled', 'expired'
    ))
  )
);

-- Serves "every job for this media" lookups (a future status query joining
-- job history onto a media resource).
CREATE INDEX media_processing_job_media_id_idx ON media.processing_job (media_id);

-- Serves the relay's own "queued but never confirmed running/terminal"
-- reconciliation and any future stuck-job monitor; partial because most
-- jobs settle into a terminal state and do not need to stay in this index.
CREATE INDEX media_processing_job_state_idx ON media.processing_job (state)
  WHERE state NOT IN ('succeeded', 'partial', 'failed_terminal', 'cancelled', 'expired');

-- verdery_worker: narrow read/write on exactly the two tables the relay
-- touches. No ALTER DEFAULT PRIVILEGES entry is added for it — unlike
-- verdery_application, it must not automatically gain access to every
-- future table any module creates.
GRANT USAGE ON SCHEMA platform TO verdery_worker;
GRANT SELECT, UPDATE ON platform.outbox_event TO verdery_worker;

GRANT USAGE ON SCHEMA media TO verdery_worker;
GRANT SELECT, INSERT, UPDATE ON media.processing_job TO verdery_worker;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

REVOKE SELECT, INSERT, UPDATE ON media.processing_job FROM verdery_worker;
REVOKE USAGE ON SCHEMA media FROM verdery_worker;
REVOKE SELECT, UPDATE ON platform.outbox_event FROM verdery_worker;
REVOKE USAGE ON SCHEMA platform FROM verdery_worker;

DROP TABLE IF EXISTS media.processing_job CASCADE;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_worker') THEN
    EXECUTE 'DROP OWNED BY verdery_worker CASCADE';
    EXECUTE 'DROP ROLE verdery_worker';
  END IF;
END
$$;
