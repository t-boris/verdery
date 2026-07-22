# Observability and Analytics Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

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
