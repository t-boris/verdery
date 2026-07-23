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
