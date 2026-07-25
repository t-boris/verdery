# Observability and Analytics Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 23, 2026

## 1. Purpose

This document defines logs, metrics, traces, crash reporting, dashboards, alerts, product analytics, privacy controls, correlation, and operational ownership.

## 2. Tooling Baseline

- OpenTelemetry for backend and worker instrumentation.
- Cloud Logging for structured service logs.
- Cloud Monitoring for service metrics, dashboards, SLOs, uptime checks, and alerts.
- Cloud Trace for distributed traces.
- Error Reporting for backend and web server failures where supported.
- Firebase Crashlytics for native crashes and selected non-fatal defects.
- Privacy-reviewed web error collection through Cloud tooling or an approved Sentry integration.
- Firebase Analytics/GA4 for consented product analytics through an application-owned event schema.

## 3. Signals

### Logs

Discrete structured events used for diagnosis and audit where appropriate.

### Metrics

Aggregated numeric health and product-system measures suitable for alerting and trends.

### Traces

Sampled causal paths across API, database, outbox, queues, jobs, and providers.

### Product Events

Consent-governed behavior events used for product analysis, separate from operational logs.

## 4. Correlation

Every interaction has:

- `traceId` from the active trace.
- `correlationId` stable across user-visible workflow where practical.
- `requestId` per HTTP request.
- `causationId` for events and jobs.
- Stable job, media, garden, or operation IDs where privacy policy permits.

Trace context propagates through the transactional outbox, Cloud Tasks, Pub/Sub, Workflows, and job manifests.

## 5. Structured Logging

Logs use JSON fields:

- Timestamp and severity.
- Service, version, and environment.
- Event name.
- Trace and correlation identifiers.
- Route template or operation type.
- Outcome code.
- Duration.
- Retry or attempt number.
- Privacy-safe resource references.

Free-form multiline logs are limited to local development.

## 6. Prohibited Telemetry

Do not record:

- Authentication tokens, cookies, App Check tokens, or FCM tokens.
- Signed or resumable URLs.
- Secrets or credentials.
- Exact addresses, precise coordinates, or raw geometry.
- Raw photos, videos, plans, notes, prompts, or provider payloads.
- User-entered filenames when an opaque media ID suffices.

Redaction occurs before export, not only in log views.

## 7. Service Metrics

### API

- Request rate, latency, and outcome by route template.
- Authentication, App Check, and authorization rejection.
- Revision conflicts and idempotency duplicates.
- Database query and transaction duration.
- Connection-pool saturation.
- External-provider latency and error.

### Synchronization

- Outbox backlog age on devices through privacy-safe summaries.
- Push accepted, duplicate, rejected, and conflict rates.
- Pull lag and cursor-expiration rate.
- Full-resync frequency.

### Media

- Upload registration, completion, verification, and abandonment.
- Stored bytes by class.
- Processing queue age and failure.
- Deletion lag and orphan reconciliation.

### Async

- Outbox publication lag.
- Queue depth and oldest task.
- Pub/Sub unacked age and dead-letter count.
- Job duration, retry, cancellation, and terminal failure.

### AI

- Call count, latency, model configuration, schema failure, fallback, safety outcome, and cost estimate.

## 8. Native Telemetry

Crashlytics receives:

- Crashes.
- Selected non-fatal defects.
- Application and database schema version.
- Capability class.
- Privacy-safe feature state.

It does not receive garden names, notes, exact locations, media, tokens, or full sync payloads.

Native performance spans cover launch, garden open, map render, sync cycle, and upload coordination after privacy review.

## 9. Web Telemetry

Collect:

- Web vitals.
- JavaScript and server-rendering errors.
- Route transition and editor load performance.
- API correlation identifiers.
- Upload outcomes.

Source maps are access-controlled. Browser telemetry sanitizes URLs and query parameters.

## 10. Product Analytics

The application owns stable product event names and properties, for example:

- Garden creation started/completed.
- First useful area created.
- Map creation method selected.
- Plan calibrated.
- Capture completed/abandoned.
- Recommendation presented/completed/postponed/rejected.
- Task completed.
- Sync conflict encountered/resolved.
- Operational invitation accepted and assigned work completed.
- Client invitation accepted.
- Client update prepared, published, viewed, withdrawn, or superseded.
- Client garden timeline or published Time Machine scenario viewed.

Analytics properties use categories, counts, durations, and broad capability classes. They exclude garden content and precise location.

Client analytics excludes publication text, media names, client identity, staff notes, and exact garden data. Cross-engagement resource identifiers are never joined in client-side analytics.

## 11. Consent

- Technical logs necessary for security and service operation follow the privacy notice and minimization policy.
- Product analytics respects applicable consent and opt-out behavior.
- Consent state is versioned and synchronized.
- Clients do not emit product events before consent where consent is required.
- Disabling analytics does not disable essential security or reliability logging.

## 12. Sampling

- Errors and high-latency traces receive elevated sampling.
- Ordinary successful requests use bounded head sampling.
- Expensive media and scan workflow traces are sampled at a useful higher rate without including content.
- Sampling decisions and cost are reviewed as volume grows.
- Security audit events are not probabilistically sampled.

## 13. Dashboards

Required dashboards:

- Production service overview.
- Authentication and authorization.
- Mobile synchronization health.
- Media upload and processing.
- Garden Scan pipeline.
- Recommendations and AI.
- Cloud SQL and connection pool.
- Queue and job health.
- Cost and quota.
- Deletion and retention compliance.

Each dashboard links to its runbook and owning component.

### Synchronization dashboard and alert candidates (P5-OBS-01)

The signals below are real, structured log lines already emitted by
`services/api/src/modules/synchronization/transport/sync-routes.ts` (verified against a real
push/pull cycle in `tests/http/sync-routes.test.ts`, not code review alone) — not a deployed
dashboard or alert policy. This section records what a "Mobile synchronization health" dashboard
(the entry already named above) and its alerts would concretely be built from, matching this
repository's Phase 1 precedent for an "-01" observability work package: real signals, verified once,
plus a documented account of the dashboard/alerts they support — see
[deferred-capabilities.md](../development/deferred-capabilities.md) for why a deployed Cloud
Monitoring dashboard/alert policy is not this work package's own deliverable.

**What is logged, per request, no payload content:**

| Event                 | Fields                                                                                                                    | Emitted by                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync.push.completed` | `protocolVersion`, `operationCount`, `accepted`, `duplicate`, `rejected`, `conflict`, `blockedByDependency`, `retryLater` | Every `POST /sync/push` call.                                                                                                                                                                                               |
| `sync.pull.completed` | `protocolVersion`, `cursorPresent`, `pageSize`, `pullLagMilliseconds` (absent when the page is empty)                     | Every successful `GET /sync/changes`.                                                                                                                                                                                       |
| `sync.pull.rejected`  | `protocolVersion`, `cursorPresent`, `errorCode`                                                                           | A pull that throws before serving a page — covers `sync.changes.cursor_expired` and `sync.protocol_version.unsupported` (the two full-resync triggers), plus any other typed rejection (for example an undecodable cursor). |

`pullLagMilliseconds` is "how long ago the most recent change on this page was committed, relative
to now" — a proxy computable from data the pull endpoint already fetches, not "how far behind the
client's cursor is from history's current head" (which would need a second query). See
`services/api/src/modules/synchronization/application/sync-pull-lag.ts`'s own header comment for the
full reasoning.

**Log-based metrics these fields support** (Cloud Monitoring, one per field, filtered by `event`):

- `sync_push_accepted` / `sync_push_duplicate` / `sync_push_rejected` / `sync_push_conflict` /
  `sync_push_blocked_by_dependency` / `sync_push_retry_later` — DISTRIBUTION metrics, value extractor
  `jsonPayload.<field>`, filter `jsonPayload.event="sync.push.completed"`.
- `sync_pull_page_size` — DISTRIBUTION metric, value extractor `jsonPayload.pageSize`, filter
  `jsonPayload.event="sync.pull.completed"`.
- `sync_pull_lag_ms` — DISTRIBUTION metric, value extractor `jsonPayload.pullLagMilliseconds`, same
  filter.
- `sync_pull_rejected` — a counter metric filtered to `jsonPayload.event="sync.pull.rejected"`, with a
  label extractor on `jsonPayload.errorCode` — one time series per rejection code.
- `sync_protocol_version` — a counter metric filtered to `jsonPayload.event=("sync.push.completed" OR
"sync.pull.completed" OR "sync.pull.rejected")`, with a label extractor on `jsonPayload.protocolVersion`.

**Dashboard widgets these metrics support:**

- **Push outcome rate** — stacked area of `ALIGN_SUM` over each `sync_push_*` metric, 1-minute
  buckets. Reads at a glance whether accepted pushes dominate, and whether rejected/conflict/blocked
  bands are growing.
- **Pull page size and lag** — two time series: `sync_pull_page_size` (mean and p95) and
  `sync_pull_lag_ms` (p50 and p95). A page size sitting at the `Limit` maximum (100) for a sustained
  window means clients are arriving with a large backlog to catch up on, not that pull itself is slow.
- **Full-resync frequency** — `sync_pull_rejected` grouped by `errorCode`, `ALIGN_RATE` per hour. The
  `sync.changes.cursor_expired` series is exactly "how often is a client forced through a full
  resynchronization" (architecture/offline-synchronization.md, section "13. Full Resynchronization").
- **Protocol version distribution** — `sync_protocol_version` grouped by `protocolVersion`, as a
  stacked bar or pie over a rolling window. This is what decides when raising
  `MIN_SUPPORTED_SYNC_PROTOCOL_VERSION` (`sync-protocol-version.ts`) stops affecting live traffic.

**Alert candidates, with reasoned starting thresholds** (per section 14, exact targets still need
approval before production; these are starting points, not committed SLOs):

- **Push rejection-rate burn**: `sum(sync_push_rejected) / (sum(sync_push_accepted) +
sum(sync_push_rejected) + sum(sync_push_conflict))` over a trailing 10-minute window exceeds 5% —
  the same shape as this section's own worked example. A sustained spike usually means a client-side
  regression (a build shipping operations the server now rejects), not routine per-operation domain
  conflict.
- **Full-resync rate burn**: `sum(sync_pull_rejected) / (sum(sync_pull_completed) +
sum(sync_pull_rejected))` over a trailing 1-hour window exceeds 2%. `cursor_expired` firing at scale
  usually means clients are going offline far longer than the 30-day retention window
  (`SYNC_CHANGES_RETENTION_MILLISECONDS`) accounts for, or a client bug is discarding its cursor.
- **Pull lag regression**: `sync_pull_lag_ms` p95 exceeds 24 hours, sustained over 30 minutes — most
  pulls are arriving a day or more after the change they are fetching was committed, suggesting
  clients have stopped syncing regularly, not that any one request is slow.

Deliberately not proposed as an alert: push `conflict` rate alone. A same-object edit conflict is an
expected, routine outcome of collaborative editing (section 7's own "Revision conflicts and
idempotency duplicates" already frames it as a metric, not an incident) — worth a dashboard trend,
not a page.

**Revocation cleanup has no telemetry, and this is deliberate, not an oversight.**
`platform.sync_client_installation.revoked_at` has no writer anywhere in this codebase (confirmed by
inspection — the same "no fabricated telemetry for an event that can't happen" finding
`retryLater`'s own outcome already established for push). There is nothing to log a metric about
until a revocation producer exists; adding one is out of this work package's scope.

**Outbox backlog age (iOS) is a local diagnostic today, not a Cloud-side signal.**
`CoreSynchronization.RemoteSyncEngine` logs it through `CoreObservability.DiagnosticLog` (the same
unified-logging record every `CoreNetworking` gateway already uses) at the start of every
`pushPending()` call — visible on-device (Console.app/`log show`), not exported anywhere a Cloud
Monitoring dashboard or alert could read it. Section 8's Crashlytics destination for this signal is
not wired: this codebase declares no `FirebaseCrashlytics`/`FirebasePerformance` dependency in
`apps/ios/Package.swift` today (only `FirebaseAuth`/`FirebaseAppCheck`/`FirebaseCore`), and adding one
is a new third-party SDK this repository's own rule requires an ADR for — out of proportion for one
metric. The concrete next step, once such a dependency is deliberately added under its own ADR, is
promoting this same computed value into a Crashlytics custom key or a Performance trace attribute; no
new computation would be needed, only a new sink.

### Media dashboard, alert candidates, and runbook (P6-OBS-01)

The signals below are real, structured log lines emitted by `services/api` (`service:
"verdery-api"`) and `services/workers` (`service: "verdery-workers"`), verified by the same
real-HTTP/real-Postgres test suites that verify the behavior they instrument
(`tests/http/media-routes.test.ts`, `tests/http/media-processing-callback-route.test.ts`,
`record-media-processing-result*.test.ts`, `outbox-relay.test.ts`,
`validation-http-server.test.ts`) — not a deployed dashboard or alert policy. This section records
what the "Media upload and processing" and "Deletion and retention compliance" dashboards (both
already named in this document's own required list above) and their alerts would concretely be
built from, matching the P5-OBS-01 subsection's own delivery bar exactly: real signals, verified
once, plus a documented account of the dashboard/alerts they support. See
[deferred-capabilities.md](../development/deferred-capabilities.md) for why a deployed Cloud
Monitoring dashboard/alert policy is not this work package's own deliverable either.

**What is logged, per request/delivery/tick — media id and class only, never filenames, signed
URLs, object keys, or content** (media-storage-and-processing.md section 19):

| Event                                        | Service           | Fields                                                                                                                                                                                                                                          | Emitted by                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `media.upload.registered`                    | `verdery-api`     | `mediaId`, `mediaClass`, `declaredByteSize`                                                                                                                                                                                                     | Every successful `POST /gardens/{gardenId}/media` (`media-routes.ts`).                                                                                                                                                                                       |
| `media.upload.completed`                     | `verdery-api`     | `mediaId`, `mediaClass`, `outcome` (`available`/`rejected`), `registrationToCompletionMs`, `verifiedByteSize` (absent when rejected)                                                                                                            | Every successful `POST .../media/{mediaId}/complete` — the synchronous declared-versus-actual verification. `rejected` here IS the checksum/type/size-mismatch signal for the synchronous stage.                                                             |
| `media.deletion.scheduled`                   | `verdery-api`     | `mediaId`, `mediaClass`, `uploadState` (`deletion_scheduled`, or `deleted` on a replay)                                                                                                                                                         | Every successful `POST .../media/{mediaId}/delete` — the USER-initiated half of deletion scheduling; sweep-initiated scheduling is counted by `retention.sweep_completed`.                                                                                   |
| `media.processing.result_recorded`           | `verdery-api`     | `jobId`, `disposition` (`recorded`/`duplicate`/`cancelled_source_unavailable`/`lost_revision_race`), `jobKind`, `mediaId`, `outcome`, `outcomeCode`, `attempt`, `mediaClass`?, `workerDurationMs`?, `requestedToCompletedMs`?, `deletionLagMs`? | Every authenticated worker result callback (`media-processing-callback-route.ts`), from the summary `RecordMediaProcessingResult.execute` returns — ONE event covers validation outcomes, derivative outcomes, AND deletion completions, split by `jobKind`. |
| `relay.tick_completed`                       | `verdery-workers` | `claimed`, `enqueued`, `alreadyQueued`, `failed`, `oldestClaimedEventAgeMs`                                                                                                                                                                     | Every relay tick that claimed at least one outbox event (`poller.ts`); an idle relay deliberately logs nothing per tick — see the liveness note below.                                                                                                       |
| `relay.event_failed`                         | `verdery-workers` | `outboxEventId`, `err`                                                                                                                                                                                                                          | Each outbox event whose job-create/enqueue/publish failed; the event stays unpublished and retries next tick.                                                                                                                                                |
| `media_processing.job_failed_retryable`      | `verdery-workers` | `jobId`, `jobKind`, `err`                                                                                                                                                                                                                       | The worker HTTP target's 503 path (`validation-http-server.ts`) — each Cloud Tasks delivery that failed retryably, for ANY of the three job kinds.                                                                                                           |
| `retention.sweep_completed`                  | `verdery-workers` | `retentionScheduled`, `retentionSkippedReferenced`, `staleScheduled`, `lostRaces`                                                                                                                                                               | Every successful hourly sweep round-trip, all-zero counts included (`sweeps/google-api-sweep-trigger.ts`) — the sweep's own liveness heartbeat.                                                                                                              |
| `retention.sweep_failed`                     | `verdery-workers` | `err`                                                                                                                                                                                                                                           | A sweep round-trip that failed; retried on the next interval.                                                                                                                                                                                                |
| `weather.refresh_sweep_completed`            | `verdery-workers` | `gardensConsidered`, `refreshed`, `freshCacheHits`, `staleServed`, `unavailable`, `degradationReasons` (by typed reason), `stoppedOnQuotaExhaustion`                                                                                            | Every successful hourly weather-refresh sweep round-trip (P7-ASYNC-01), all-zero counts included — with zero providers configured, `degradationReasons.noProviderConfigured` counting every considered garden IS the documented no-op made visible.          |
| `weather.refresh_sweep_failed`               | `verdery-workers` | `err`                                                                                                                                                                                                                                           | A weather-refresh sweep round-trip that failed; retried on the next interval.                                                                                                                                                                                |
| `recommendations.evaluation_sweep_completed` | `verdery-workers` | `gardensEvaluated`, `candidatesCreated`, `candidatesSuperseded`, `candidatesExpired`, `lostRaces`                                                                                                                                               | Every successful six-hourly recommendation-evaluation sweep round-trip (P7-ASYNC-01), all-zero counts included — section 17's "Recommendation freshness and duplication" counters at their source.                                                           |
| `recommendations.evaluation_sweep_failed`    | `verdery-workers` | `err`                                                                                                                                                                                                                                           | A recommendation-evaluation sweep round-trip that failed; retried on the next interval.                                                                                                                                                                      |

Three latency figures and their exact meanings, each computable from data the emitting layer
already holds (the `pullLagMilliseconds` precedent — no second query anywhere):

- `registrationToCompletionMs` — the record's own server-stamped `createdAt` → `updatedAt` at
  completion. Exact on the request that performed the transition; a rare idempotent replay re-logs
  the record's current timestamps instead (documented, not hidden).
- `requestedToCompletedMs` — job-row creation (relay `ensureRequested`) → terminal recording: the
  full pipeline latency including Cloud Tasks queueing and every retry. Absent when the delivery
  completed nothing (`duplicate`/`lost_revision_race`).
- `deletionLagMs` — `deletion_scheduled` → confirmed `deleted`, present only on a succeeded
  `media_deletion` result. Computable from the media row's `updatedAt` because nothing updates the
  ORIGINAL row between the scheduling transaction and completion (every other write path gates on
  `uploadState = 'available'`; derivative bulk transitions touch derivative rows only) — see
  `MediaProcessingResultRecordedSummary`'s own doc comment.

**Worker liveness, honestly**: an idle relay emits no per-tick log line by design (17k+ lines/day
of `claimed: 0` would drown the signal). The worker process's liveness signals are `service.started`
on boot and the interval sweep heartbeats from the SAME process — the hourly
`retention.sweep_completed` and `weather.refresh_sweep_completed`, and the six-hourly
`recommendations.evaluation_sweep_completed` (P7-ASYNC-01) — absence of any for a few hours means
the whole worker is down or that sweep path specifically is broken, either of which
warrants the same first steps (runbook below). Cloud Run's built-in instance/request metrics cover
the platform-level half once deployed.

**Section 19 signals that are database queries, not log lines — a documented judgment call, not a
gap.** Three of section 19's signals describe CURRENT STOCK, which no log event can carry; the
honest source is SQL over `media.media_record`/`media.processing_job` (operator queries today; a
metrics exporter, if ever wanted, is its own future decision):

```sql
-- Registered-but-never-started / stale pre-available uploads (orphan stock;
-- the sweep's own candidate query, age-bucketed for inspection):
SELECT media_class, count(*), min(updated_at) AS oldest
FROM media.media_record
WHERE upload_state IN ('registered', 'authorized', 'uploading', 'verifying')
GROUP BY media_class;

-- Stored bytes by class and state (database-side accounting):
SELECT media_class, upload_state,
       count(*) AS records,
       sum(coalesce(verified_byte_size, declared_byte_size)) AS bytes
FROM media.media_record
WHERE upload_state NOT IN ('deleted')
GROUP BY media_class, upload_state;

-- Raw media approaching its retention deadline (honest today: only
-- export_package rows carry deadlines; raw_capture is declared but has no
-- producer for its anchoring event until Garden Scan — enforced: false):
SELECT media_class, count(*)
FROM media.media_record
WHERE retention_deadline_at IS NOT NULL
  AND retention_deadline_at < now() + interval '7 days'
  AND upload_state = 'available'
GROUP BY media_class;

-- Deletion-pending stock and age (records whose deletion job has not yet
-- confirmed absence — the "user-visible deletion remains pending" set):
SELECT count(*), min(updated_at) AS oldest_scheduled
FROM media.media_record
WHERE upload_state = 'deletion_scheduled'
  AND derived_from_media_id IS NULL;

-- Processing queue age (jobs the relay recorded that have not completed):
SELECT job_kind, state, count(*), min(created_at) AS oldest
FROM media.processing_job
WHERE state IN ('requested', 'queued', 'running')
GROUP BY job_kind, state;
```

**Stored bytes: what is real versus what would be invented.** Cloud Monitoring already ships
per-bucket metrics for every GCS bucket with no instrumentation at all:
`storage.googleapis.com/storage/total_bytes` and `storage.googleapis.com/storage/object_count`
(point-in-time gauges, sampled daily) — and the four media buckets map onto storage classes by
construction (`user-media` ≈ garden photos + imported plans, `raw-capture`, `derived` ≈ derivative
previews, `exports`). "Stored bytes by class and environment" is therefore: the built-in bucket
metrics for physical truth per environment, the SQL above for per-media-class application truth,
and a log-based INGEST-RATE proxy (`sum(verifiedByteSize)` over `media.upload.completed`,
`outcome="available"`) for trend lines between daily samples. Building a custom stored-bytes
exporter or internal endpoint was rejected as reinventing the built-in metric.

**Log-based metrics these fields support** (Cloud Monitoring, filtered by `jsonPayload.event`; API
events additionally `resource.labels.service_name="verdery-api-dev"` and worker events
`"verdery-workers-dev"` once deployed):

- `media_upload_registered` — counter, filter `jsonPayload.event="media.upload.registered"`, label
  extractor on `jsonPayload.mediaClass`.
- `media_upload_completed` — counter, filter `jsonPayload.event="media.upload.completed"`, label
  extractors on `jsonPayload.outcome` and `jsonPayload.mediaClass`.
- `media_upload_completion_ms` — DISTRIBUTION, value extractor
  `jsonPayload.registrationToCompletionMs`, same filter.
- `media_uploaded_bytes` — DISTRIBUTION, value extractor `jsonPayload.verifiedByteSize`, filter
  `jsonPayload.event="media.upload.completed" AND jsonPayload.outcome="available"`, label extractor
  on `jsonPayload.mediaClass` (the ingest-rate proxy above).
- `media_processing_results` — counter, filter
  `jsonPayload.event="media.processing.result_recorded"`, label extractors on
  `jsonPayload.jobKind`, `jsonPayload.outcome`, and `jsonPayload.disposition` — one metric answers
  validation outcomes, derivative failures, deletion completions, and race-guard cancellations.
- `media_processing_pipeline_ms` — DISTRIBUTION, value extractor
  `jsonPayload.requestedToCompletedMs`, same filter, label extractor on `jsonPayload.jobKind`.
- `media_worker_duration_ms` — DISTRIBUTION, value extractor `jsonPayload.workerDurationMs`, same
  filter, label extractor on `jsonPayload.jobKind`.
- `media_deletion_lag_ms` — DISTRIBUTION, value extractor `jsonPayload.deletionLagMs`, filter
  `jsonPayload.event="media.processing.result_recorded" AND jsonPayload.jobKind="media_deletion"
AND jsonPayload.outcome="succeeded"`.
- `media_deletion_scheduled` — counter, filter `jsonPayload.event="media.deletion.scheduled"`.
- `media_processing_retryable_failures` — counter, filter
  `jsonPayload.event="media_processing.job_failed_retryable"`, label extractor on
  `jsonPayload.jobKind`.
- `relay_oldest_claimed_event_age_ms` — DISTRIBUTION, value extractor
  `jsonPayload.oldestClaimedEventAgeMs`, filter `jsonPayload.event="relay.tick_completed"` — the
  outbox-publication-lag signal.
- `relay_event_failures` — counter, filter `jsonPayload.event="relay.event_failed"`.
- `retention_sweep_runs` — counter, filter `jsonPayload.event="retention.sweep_completed"` (the
  absence-alert target), plus `retention_sweep_stale_scheduled` /
  `retention_sweep_retention_scheduled` — DISTRIBUTIONs on `jsonPayload.staleScheduled` /
  `jsonPayload.retentionScheduled`, same filter.
- Cloud Tasks built-ins (no definition needed once the queue exists):
  `cloudtasks.googleapis.com/queue/depth` and `api/request_count` grouped by response code.
- GCS built-ins (already exist per bucket): `storage.googleapis.com/storage/total_bytes`,
  `storage/object_count`.

**Dashboard widget compositions:**

_Media upload and processing_ dashboard:

- **Upload funnel** — stacked lines: `media_upload_registered` rate and `media_upload_completed`
  rate split by `outcome` (`ALIGN_RATE`, 5-minute buckets). The persistent gap between registered
  and completed IS the abandonment trend (the 7-day sweep is its trailing enforcement); a growing
  `rejected` band is the synchronous mismatch signal.
- **Upload completion time** — `media_upload_completion_ms` p50/p95.
- **Verification outcomes** — `media_processing_results` filtered `jobKind="media_validation"`,
  grouped by `outcome`, stacked. `failed_terminal` here is the deep byte-level rejection rate
  (spoofed MIME, dimension bombs, checksum mismatch, active PDF content).
- **Derivative outcomes** — the same metric filtered `jobKind="derivative_generation"`, grouped by
  `outcome` — section 19's "derivative failures", directly.
- **Pipeline latency** — `media_processing_pipeline_ms` p50/p95 grouped by `jobKind`, beside
  `media_worker_duration_ms` p95: the first includes queueing and retries, the second is pure
  worker execution — divergence between them means queue/retry trouble, not slow processing.
- **Retryable failure rate** — `media_processing_retryable_failures` grouped by `jobKind`, with
  Cloud Tasks `queue/depth` on a second axis. (Known steady-state signal until a malware provider
  is selected: EVERY PDF `imported_plan` validation fails retryably by design —
  media-storage-and-processing.md section 8.1 — so a nonzero `media_validation` baseline here is
  expected exactly in proportion to PDF plan uploads.)
- **Outbox publication lag** — `relay_oldest_claimed_event_age_ms` p50/p99 and
  `relay_event_failures` rate.

_Deletion and retention compliance_ dashboard:

- **Deletion flow** — `media_deletion_scheduled` rate (user-initiated) and
  `retention_sweep_retention_scheduled`/`retention_sweep_stale_scheduled` (sweep-initiated)
  stacked, against `media_processing_results{jobKind="media_deletion"}` grouped by `outcome`:
  scheduling in versus confirmed-deleted out, per window.
- **Deletion lag** — `media_deletion_lag_ms` p50/p95 — section 19's "deletion lag", directly.
- **Sweep health** — `retention_sweep_runs` count per 3-hour window (expected: 3) and the two
  sweep-count DISTRIBUTIONs; `staleScheduled` pinned at the 25-per-run batch cap
  (`RETENTION_SWEEP_BATCH_LIMIT`) across consecutive runs means the backlog is growing faster than
  the drain rate.
- **Stored bytes** — GCS `storage/total_bytes` per bucket (the physical truth) with
  `media_uploaded_bytes` rate by `mediaClass` (the ingest trend between daily samples).

**Alert candidates, with reasoned starting thresholds** (per section 14, exact targets still need
approval before production; each threshold is derived from this system's own documented timings —
the 5s relay poll, the hourly sweep, and the Cloud Tasks retry policy of max 10 attempts / 10s-300s
backoff / 1h max retry duration from `10-media-processing-queue.sh`):

1. **Outbox publication lag**: `relay_oldest_claimed_event_age_ms` p99 > 60s sustained 10 minutes.
   Healthy steady state is within one or two 5s poll intervals; 60s means ~12 consecutive intervals
   failed to drain (repeated `relay.event_failed`, a starved/crashed process, or a Cloud Tasks
   outage). Pair with `relay_event_failures` > 0 sustained 15 minutes — a single event failing
   every tick forever is a poisoned event even when overall lag stays low.
2. **Validation failure ratio**: `media_processing_results{jobKind="media_validation",
outcome="failed_terminal"}` / all validation results > 5% over a trailing 1-hour window — the same
   5% shape as the sync push-rejection candidate. Occasional malformed uploads are routine; a
   sustained spike means a client regression (uploading something the validator now rejects) or
   abuse.
3. **Processing pipeline stall**: `media_processing_pipeline_ms` p95 > 10 minutes sustained 1 hour.
   The healthy path completes in seconds (5s poll + dispatch + worker duration); Cloud Tasks'
   backoff means a job seeing multiple retries takes minutes, and 10 minutes at p95 means MOST jobs
   are retrying repeatedly — a systemic dependency failure (GCS, the worker service, the callback),
   not one bad file. Full retry exhaustion takes at most 1h (`--max-retry-duration=3600s`), which
   bounds how long this alert can lag the root cause.
4. **Deletion not completing**: two complementary candidates. (a) `media_deletion_lag_ms` p95 > 2
   hours over a trailing 6-hour window: a deletion's whole retry budget is 1 hour, so a completed
   deletion can never honestly take much longer — values beyond 2h mean re-emitted cleanup events
   are doing the completing, not the primary path. (b) `media_processing_results
{jobKind="media_deletion"}` with `outcome != "succeeded"` > 0 over 1 hour: deletion jobs have
   exactly one legitimate terminal outcome; anything else is malformed-manifest or a verification
   failure and stalls a user-visible deletion. The STOCK side (a `deletion_scheduled` record whose
   job exhausted Cloud Tasks retries has NO automatic re-drive today — see deferred-capabilities.md)
   is an operator SQL check in the runbook below, not a log-based alert, until an exporter or
   re-drive exists.
5. **Retention sweep absent**: `retention_sweep_runs` absent for 3 hours (metric-absence
   condition). The interval is hourly; three consecutive misses is a stopped worker process, a
   broken `MEDIA_RETENTION_SWEEP_URL`/OIDC configuration, or a failing sweep endpoint — and because
   this line doubles as the worker's heartbeat, it also catches a dead relay whose own idle
   silence is otherwise expected.
6. **Sweep backlog saturation**: `retention_sweep_stale_scheduled` at its 25 batch cap for 6
   consecutive runs — stale uploads are being produced faster than 25/hour drains, meaning a client
   is abandoning sessions at scale or a completion-path regression is stranding uploads.

Deliberately NOT proposed as alerts: upload **abandonment ratio** (a user closing the app
mid-upload is legitimate behavior; the sweep guarantees cleanup — dashboard trend, not a page) and
the synchronous completion **rejected rate** on its own (already visible in the funnel widget; the
actionable form is the validation-failure ratio above, which catches the same class of regression
with deep-validation confirmation).

**Runbook entries** (section 18's shape, applied to each candidate above):

- **Outbox publication lag / relay event failures.** Meaning: uploads complete but validation
  never starts; users see records stuck `verifying`-then-`available` with no `processed` state.
  First: `jsonPayload.event="relay.event_failed"` in Cloud Logging and read `err` — a single
  repeated `outboxEventId` is a poisoned event; broad failures are Cloud Tasks/DB connectivity.
  Check the worker service is serving (`service.started` after unexpected restarts; Cloud Run
  instance count; the always-allocated-CPU requirement in `deploy-workers.sh` — a CPU-throttled
  relay is the documented deployment-order failure mode). Safe remediations: restart/redeploy the
  worker; for a poisoned event, inspect the row (`SELECT * FROM platform.outbox_event WHERE id =
...`) — its payload is producer-written and trusted, so a malformed one indicates an API bug to
  fix, not a row to hand-edit. The relay retries automatically every tick; nothing is lost while
  it is down, only delayed.
- **Validation failure ratio.** Meaning: uploads are being terminally rejected after byte
  inspection. First: group `media.processing.result_recorded{jobKind="media_validation",
outcome="failed_terminal"}` by `outcomeCode` — `mime_signature_mismatch`-class codes trending
  after a client release means a client regression; a burst from one garden suggests abuse (the
  `mediaId`s join to `media.media_record` for ownership). Safe remediation: none server-side —
  rejection is the system working; fix the client or act on the abuser. Never relax
  `validation-policy.ts` ceilings as a firefight.
- **Processing pipeline stall / retryable failures.** Meaning: Cloud Tasks deliveries are failing
  and retrying; user-visible processing is delayed but not lost. First: read
  `media_processing.job_failed_retryable`'s `err` grouped by `jobKind`. Known cause with a
  standing explanation: PDF `imported_plan` validation fails retryably BY DESIGN until a malware
  provider is selected (`UnavailableMalwareScanner` → 503) — check whether the volume is just PDF
  uploads before treating it as an outage. Otherwise: GCS availability, the worker's storage IAM
  bindings, or the API callback rejecting (401s in `verdery-api` logs mean OIDC
  audience/service-account misconfiguration — compare `MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_
EMAIL`/`MEDIA_PROCESSING_CALLBACK_AUDIENCE` against `deploy-workers.sh`). Safe remediation: fix
  the dependency and let Cloud Tasks' remaining retries drain; after retry exhaustion (1h), see
  the stuck-deletion/stuck-job re-drive below.
- **Deletion lag / deletion not completing.** Meaning: a user was told deletion is pending and the
  bytes are still in Cloud Storage — a compliance-relevant condition (section 15's alert list
  names "Raw media deletion lag" explicitly). First: the deletion-pending stock SQL above; then
  the record's job rows (`SELECT * FROM media.processing_job WHERE media_id = ... ORDER BY
created_at`) — `failed_terminal` with `deletion_manifest_missing` is a malformed event (a bug to
  fix), repeated retryable failures are provider trouble. Safe remediation for a record stuck
  `deletion_scheduled` after retry exhaustion: re-emit the standard `media.deletion_requested`
  outbox event — the P6-RET-01 cleanup path that is idempotent END TO END by design (same
  prefixes, fresh event id, convergent completion; `record-media-processing-result.ts` re-emits it
  for late derivative bytes the same way): insert one `platform.outbox_event` row with `event_type
= 'media.deletion_requested'`, a fresh UUID id, `aggregate_type = 'media_record'`, the media id as
  `aggregate_id`, and the payload rebuilt from the media row exactly as
  `appendMediaDeletionRequestedEvent` (`media-deletion-workflow.ts`) builds it — the relay picks it
  up within one poll interval. NEVER flip `upload_state` to `deleted` by hand: that records an
  absence verification that never happened. Evidence to preserve: the job rows and the audit
  events (`media.deletion_requested`/`media.deleted` in `platform.audit_event`).
- **Retention sweep absent.** Meaning: retention deadlines and stale-upload reconciliation are not
  being enforced; also possibly the whole worker is down (this line is its heartbeat). First:
  `retention.sweep_failed`'s `err` — 401/403 means the OIDC audience or
  `MEDIA_RETENTION_SWEEP_URL` drifted from `deploy-workers.sh`'s values; connection errors mean
  the API is down (check its own alerts); no `sweep_failed` either means the worker process is
  gone (Cloud Run instance count, `service.shutdown_*`/crash logs). Safe remediation: restart the
  worker or fix configuration; candidates are durable rows, so missed runs delay enforcement but
  lose nothing — the next successful run drains up to 25 per category and hourly runs catch up.
- **Sweep backlog saturation.** Meaning: abandoned uploads accumulating faster than 25/hour. First:
  the stale-upload stock SQL above grouped by `media_class`, and the upload funnel widget — a
  registration spike with flat completions localizes which client/class. Safe remediation: fix the
  abandoning client; the backlog drains automatically once production slows. Raising
  `RETENTION_SWEEP_BATCH_LIMIT` is a code change with documented reasoning, not a live-tuning knob.

**What this section deliberately does not claim.** No live dashboard, log-based metric, or alert
policy has been created against any environment (the P5-OBS-01/App-Check precedent; live
infrastructure actions need their own approval). The bucket-side orphan direction (objects with no
row) still has no producer of a signal — its listing reconciler itself is the deferred capability,
so there is honestly nothing to chart yet. Raw-capture deadline enforcement is declared
`enforced: false` and its "approaching deadline" query returns only `export_package` rows until
Garden Scan (Phase 10) stamps real deadlines. And `media.processing_job` rows that exhaust Cloud
Tasks retries have no automatic re-drive — the runbook's manual re-emit is the documented
remediation, and an automated re-drive is recorded in deferred-capabilities.md as a future
decision, not silently promised here.

## 14. SLOs

Initial SLO candidates include:

- API availability for core garden read/write operations.
- API latency for normal reads and mutations.
- Successful synchronization acceptance.
- Media verification completion.
- Processing job completion within stated window.
- Notification dispatch timeliness.

Exact targets are approved before production based on load tests and product expectations.

## 15. Alerts

Alerts are actionable and tied to user impact or imminent risk:

- API error or latency burn rate.
- Cloud SQL availability, storage, or connections.
- Queue oldest age.
- Dead-letter growth.
- Job terminal failure spike.
- Authentication or authorization anomaly.
- Upload verification failure spike.
- Raw media deletion lag.
- Budget anomaly.
- Certificate or uptime failure.

Avoid alerts for transient conditions without user impact.

## 16. Audit Versus Diagnostic Logs

Security and application audit records have distinct retention and access from diagnostic logs. An audit event must not rely solely on a sampled operational log.

Audit records cover role, ownership, support, export, deletion, session revocation, and sensitive raw-media access.

## 17. Retention and Access

- Diagnostic log retention is the shortest period that supports incident and reliability needs.
- Audit retention follows the approved security policy.
- Production telemetry access uses least privilege.
- Analytics access is separate from raw operational access.
- Export to BigQuery or another sink requires explicit cost and privacy review.

## 18. Runbooks

Every critical alert links to:

- Meaning and likely user impact.
- Immediate checks.
- Safe mitigation.
- Rollback or disable path.
- Escalation.
- Evidence to preserve.
- Follow-up verification.

## 19. Testing

- Trace propagation through outbox and jobs.
- Log redaction with malicious inputs.
- Alert policy in staging fault injection.
- Dashboard data completeness.
- Crash reporting symbol/source-map upload.
- Analytics consent on/off behavior.
- Cardinality controls.
- Runbook exercise for representative incidents.

## 20. Completion Criteria

- A user-visible workflow can be followed through correlation IDs without logging its private content.
- Alerts identify user impact and have runbooks.
- Audit events are durable and unsampled.
- Analytics is provider-independent at the event-schema boundary.
- Tokens, signed URLs, exact geometry, and media never enter ordinary telemetry.
