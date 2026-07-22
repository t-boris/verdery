# Asynchronous Processing Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines reliable asynchronous commands, events, batch jobs, orchestration, retries, dead-letter behavior, idempotency, cancellation, and observability.

## 2. Primitive Selection

| Requirement | Service |
|---|---|
| Execute one known HTTP handler with scheduling and rate control | Cloud Tasks |
| Broadcast a fact to independent subscribers | Pub/Sub |
| Run finite containerized compute | Cloud Run Jobs |
| Coordinate long visible multi-service steps | Google Cloud Workflows |
| Schedule periodic initiation | Cloud Scheduler |
| Commit domain state and future publication atomically | PostgreSQL transactional outbox |

These services are complementary and must not be substituted without preserving the required semantics.

## 3. Message Envelope

Application-owned messages contain:

- Message ID UUIDv7.
- Type and schema version.
- Creation time.
- Producer service and version.
- Correlation and causation IDs.
- Actor or system context reference where permitted.
- Aggregate or job identifiers.
- Small structured payload or data reference.

Messages do not contain large media, secrets, signed URLs, or unnecessary personal data.

## 4. Transactional Outbox

Domain transactions append outbox records atomically with authoritative changes. A relay:

1. Claims unpublished records in bounded batches.
2. Publishes to the intended Pub/Sub topic or task creation adapter.
3. Records publication result idempotently.
4. Retries transient failures.
5. Moves terminal defects to an operator-visible state.

Consumers remain duplicate-safe because a relay can publish before recording success.

## 5. Cloud Tasks

Use Cloud Tasks for:

- Media verification.
- Notification dispatch.
- Provider calls with rate limits.
- Deletion steps.
- Export initiation.
- Reconciliation commands.
- Starting a known Cloud Run Job.

Each queue has an explicit target, service identity, retry policy, rate, concurrency, and dead-letter or terminal-failure process.

Task names may derive from a stable operation ID when deduplication behavior is required.

## 6. Pub/Sub

Use Pub/Sub for facts such as:

- Media verified.
- Garden geometry accepted.
- Observation recorded.
- Membership changed.
- Processing completed.
- Account deletion completed.

Subscribers own their retries and dead-letter subscriptions. A subscriber cannot assume it is the only consumer or that messages arrive exactly once.

Ordering keys are used only when a demonstrated consumer invariant requires per-aggregate ordering.

## 7. Cloud Run Jobs

Cloud Run Jobs execute:

- Video frame extraction.
- Property-plan processing.
- Scan reconstruction.
- Large imports and exports.
- Bulk recommendation computation.
- Data repair and projection rebuild.
- Retention and reconciliation batches.

Each execution uses a versioned container and manifest. Large jobs checkpoint progress in PostgreSQL or Cloud Storage so retries do not restart all successful work unnecessarily.

## 8. Python and TypeScript Workers

- TypeScript workers handle domain-adjacent commands, notifications, provider coordination, and exports where ecosystem support is sufficient.
- Python workers handle OpenCV, computer vision, photogrammetry, scientific processing, and approved ML workflows.

Both use the same message envelope, job-state contract, telemetry fields, and workload-identity model.

## 9. Workflows

Google Cloud Workflows is introduced when a process has multiple long-running remote steps whose durable state and operational visibility justify an orchestrator.

Candidate use cases are:

- Garden Scan pipeline with multiple job stages.
- Account deletion across providers.
- Cross-region recovery automation.
- Complex export assembly.

Domain decision logic remains in application services. Workflow YAML coordinates calls and waits; it does not become the only representation of business rules.

## 10. Job State Machine

```text
requested → queued → running → succeeded
                 │        ├──→ partial
                 │        ├──→ failed_retryable → queued
                 │        ├──→ failed_terminal
                 │        └──→ cancelled
                 └────────────→ expired
```

Transitions use expected attempt/revision checks. Late results from superseded attempts cannot overwrite newer state.

## 11. Idempotency

Every handler defines its idempotency boundary:

- Message or task ID.
- Domain operation ID.
- Job attempt ID.
- Source checksum plus processor version for deterministic derivatives.

Idempotency state is durable and checked before external side effects where possible.

## 12. Retry Classification

Retryable:

- Network timeout.
- Temporary provider unavailability.
- Rate limit with valid retry guidance.
- Transient database or storage availability.
- Worker interruption before durable completion.

Terminal:

- Invalid schema version.
- Unsupported or corrupt input.
- Authorization or ownership mismatch.
- Permanent provider rejection.
- Domain precondition conflict requiring user review.
- Repeated deterministic processing defect.

Retries use bounded exponential backoff with jitter. Infinite poison-message loops are prohibited.

## 13. Dead-Letter Handling

Every dead-letter destination has:

- Owning team or module.
- Alert threshold.
- Safe inspection procedure.
- Replay tool with idempotency safeguards.
- Retention period.
- Runbook for terminal resolution.

Dead-letter payload access follows the same sensitivity controls as the source operation.

## 14. Cancellation

Cancellation is cooperative:

1. API records cancellation requested.
2. Pending task or workflow is cancelled when supported.
3. Running worker checks cancellation between safe stages.
4. Partial outputs remain hidden or are marked incomplete.
5. Worker records terminal cancellation and cleanup state.

Cancellation does not promise immediate compute termination. User-facing status explains when cleanup continues.

## 15. Concurrency Control

- Queue-level concurrency protects providers and database capacity.
- Per-garden or per-job locks prevent duplicate incompatible processing.
- Database expected revisions protect terminal result updates.
- Worker parallelism is explicit and bounded.
- Cloud Run API scaling and worker scaling have separate limits.

## 16. Scheduling

Cloud Scheduler initiates periodic commands such as weather refresh, recommendation batches, retention scans, and reconciliation. Scheduled handlers use a stable schedule-execution ID and remain duplicate-safe.

Schedules use UTC. Garden-local time is resolved inside domain scheduling logic, not embedded as many infrastructure cron expressions.

## 17. Security

- Cloud Tasks and Pub/Sub invoke private handlers with IAM service identities.
- Worker identities receive least-privilege database and bucket access.
- Payloads contain references rather than credentials.
- Administrative repair tasks require separate authorization.
- Untrusted parsers run with minimal network and storage access.

## 18. Observability

Measure by operation type:

- Queue depth and oldest age.
- Delivery and retry count.
- Handler latency.
- Success, partial, cancellation, and terminal failure.
- Dead-letter volume.
- Job cold start and compute duration.
- Cost attribution.
- Outbox publication lag.
- Workflow step duration.

Trace context propagates from the initiating request through outbox, task/event, job, and provider spans.

## 19. Testing

- Duplicate delivery before and after commit.
- Lost acknowledgment.
- Retryable and terminal provider outcomes.
- Poison message to dead letter.
- Concurrent duplicate job start.
- Cancellation at every stage boundary.
- Late stale worker result.
- Outbox relay crash after publish.
- Workflow retry and timeout.
- Queue overload and backpressure.
- IAM denial and secret absence.

## 20. Completion Criteria

- Every asynchronous operation has one named owner and primitive.
- Domain commit cannot silently lose its publication intent.
- Duplicate delivery cannot duplicate domain effects.
- Queue retries are bounded and terminal failures are visible.
- Long processing has durable status, cancellation, and progress.
- Large media is referenced, never embedded in messages.
