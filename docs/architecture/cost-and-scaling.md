# Cost and Scaling Design

> Status: Draft 0.3
> Decision status: Approved baseline  
> Last updated: July 28, 2026

## 1. Purpose

This document defines scaling boundaries, budgets, quotas, cost attribution, resource defaults, optimization order, and triggers for architectural expansion.

## 2. Principles

- Scale stateless compute horizontally and stateful infrastructure deliberately.
- Protect Cloud SQL before allowing unbounded Cloud Run scale.
- Move large bytes directly between clients and Cloud Storage.
- Queue expensive work and cap concurrency.
- Prefer measured optimization over speculative distributed architecture.
- Make user-visible expensive features quota-aware.
- Separate environment and workload cost attribution.

## 3. Cost Centers

Track at least:

- Firebase App Hosting and delivery.
- Cloud Run API.
- Cloud SQL compute, storage, backups, and network.
- Cloud Storage by media class and operations.
- Cloud Tasks, Pub/Sub, Scheduler, and Workflows.
- Cloud Run Jobs and specialist/GPU compute.
- Vertex AI.
- Map, weather, email, and plant-content providers.
- Logging, monitoring, traces, and analytics export.
- CI builds and artifact storage.

## 4. Labels and Attribution

Provisioning scripts apply labels for environment, service, module/workload, owner, and cost center where supported.

Provider adapters record privacy-safe usage units. Job manifests and metrics identify processing category and environment.

## 5. Budgets

Each project has:

- Monthly budget.
- Forecast alerts.
- Actual-spend thresholds.
- Anomaly alerts.
- Named owner and escalation.

Budget alerts do not automatically disable core user data access. Emergency controls first disable or constrain optional expensive processing.

## 6. Cloud Run API Defaults

Initial posture:

- Minimum instances: zero.
- Bounded maximum instances.
- Concurrency selected through load tests.
- CPU and memory sized from representative requests.
- Request timeout below platform maximum and appropriate for interactive use.
- Startup optimized without loading large models.

Enable one minimum instance only when measured cold-start latency materially harms the product, and never without allocating CPU outside requests in the same change. Cloud Run throttles an idle instance's CPU to near zero by default, which stops the application's event-loop-delay sampler; the delay it then reads on the next request is the entire idle period, and the overload guard rejects every request until that instance is replaced. A warm instance without always-on CPU is therefore strictly worse than scaling to zero — it converts an occasional cold start into a sustained outage. Confirmed by attempting exactly that on development, 2026-08-01.

## 7. Database Protection

Cloud Run maximum instances and connection pools satisfy:

```text
max API instances × pool size
+ worker connections
+ migration/operations reserve
< safe Cloud SQL connection budget
```

Scaling order is:

1. Fix inefficient queries and indexes.
2. Bound and cache repeated reads.
3. Tune connection and request concurrency.
4. Scale Cloud SQL vertically.
5. Add read replicas for demonstrated read workloads.
6. Partition selected high-volume tables.
7. Extract a service only for an independent need.

## 8. Spatial Query Scaling

- GiST indexes for geometry.
- Viewport-bounded queries.
- Simplified geometry or vector projections for lower zoom where needed.
- Server-side validation limited to affected objects and neighborhoods.
- Query-plan monitoring for large gardens.
- No unbounded whole-catalog spatial scans in interactive requests.

## 9. Synchronization Scaling

- Bounded push and pull pages.
- Change log indexed by sequence and authorization partition.
- Compact payloads.
- Per-client backoff and quotas.
- Full resync protected against thundering herd.
- Retention sized from supported offline duration and measured volume.
- Sync data transfer measured separately from ordinary screen queries.

## 10. Media Cost Controls

- Direct resumable uploads.
- File-size, dimension, and duration limits.
- Derivatives sized for actual UI needs.
- Explicit retention for approved raw AR captures.
- Short-lived exports.
- Rebuildable derivative lifecycle.
- Orphan cleanup.
- Quotas by account and garden.
- No duplicate derivative generation for same input/version.

Future automated reconstruction has no storage budget or retention promise. If promoted, its ADR
must define lifecycle rules before raw reconstruction media is collected.

## 11. Future Reconstruction Cost Gate

Automated reconstruction remains research-only. A promotion decision must show a viable unit-cost
model and define:

- Validation and sampling before expensive stages.
- CPU-before-GPU policy where quality permits.
- Explicit per-account concurrency and processing allowances.
- User confirmation before any high-cost pipeline.
- Stage checkpointing and cancellation checks.
- Time, memory, and retry limits.
- Estimated and actual usage metrics by pipeline version.

## 12. Vertex AI Controls

- One primary model per approved use case.
- Token/input/output limits.
- Deterministic fallback.
- Cached result when evidence and version are identical and policy permits it.
- Per-user and system quotas.
- No unconstrained agent loops.
- Cost included in model evaluation and rollout gates.

## 13. Provider Controls

- Central adapter rate limits.
- Cache by provider license and freshness.
- Request deduplication.
- Quota monitoring.
- Fail closed for expensive optional calls when budget protection activates.
- Provider replacement evaluation when unit economics or coverage becomes unacceptable.

## 14. Observability Cost

- Structured concise logs.
- Trace sampling.
- Bounded metric labels and cardinality.
- Short diagnostic retention.
- No duplicate provider payload logging.
- BigQuery export only with explicit query and retention budget.

## 15. Environment Cost

- Development scales to zero where possible.
- Staging mirrors topology but not production capacity except during tests.
- Production preserves required HA and recovery even when scale is low.
- Ephemeral preview resources have expiration and cleanup.
- Orphaned images, revisions, IPs, disks, and secrets are detected.

## 16. User Quotas

Potential quota dimensions are:

- Gardens per account.
- Collaborators per garden.
- Stored media bytes.
- Individual upload size and video duration.
- Concurrent uploads.
- Approved AR capture storage. Future reconstruction runs and retained artifacts become quota
  dimensions only after promotion.
- AI explanations or assistant usage.
- Export frequency.
- Notification rate.

Product plans may expose different limits later. Security limits apply regardless of payment.

## 17. Backpressure

When capacity is constrained:

- Core reads and ordinary edits remain prioritized.
- New expensive processing returns queued or quota state.
- Queue concurrency protects Cloud SQL and providers.
- Non-urgent recommendation batches delay.
- Upload registration may reject files beyond quota before transfer.
- Clients receive explicit retry guidance.

## 18. Scaling Triggers

Consider architectural expansion only with evidence:

### Add Minimum API Instances

Cold starts violate latency target at meaningful frequency.

### Add Read Replica

Read load limits the primary after query and caching optimization.

### Add PgBouncer

Connection churn or limits remain a bottleneck after pool and concurrency tuning.

### Add Dedicated Search

PostgreSQL search cannot meet measured relevance or latency needs.

### Add GPU/Specialist Compute

An approved media or future reconstruction workload demonstrates that it requires specialist
compute and its unit economics are accepted.

### Extract Service

A module has a distinct scaling, runtime, security, reliability, or ownership requirement.

### Add Multi-Region

Measured user geography, contractual availability, or residency requires it.

## 19. Load Testing

Load tests model:

- Normal interactive traffic.
- Morning/evening task bursts.
- Large sync backlog after outage.
- Media upload completion burst.
- Approved plan, video, and AR processing submissions.
- Recommendation batches.
- Provider slowdown.
- Database failover and connection recovery.

Future reconstruction submissions join the model only after the research is promoted.

Tests measure user latency, connection pressure, queue age, error rate, and unit cost.

## 20. Cost Review Cadence

- Weekly during active development of new cloud workloads.
- Before enabling a new provider or processing stage.
- Before production launch.
- Monthly in steady operation.
- Immediately after anomaly alert.

Review compares actual cost per active garden, stored GB, approved processing job, AI call, and
synchronized operation where measurable. A promoted reconstruction pipeline must add its own unit
cost.

## 21. Completion Criteria

- Every expensive workload has quota, concurrency, timeout, and retry limits.
- Cloud Run cannot scale beyond safe database connection capacity.
- Raw media and exports have lifecycle policy.
- Cost can be attributed by environment and major workload.
- Optional processing can be constrained without disabling core garden access.
- Architecture expands only after a measurable trigger.
