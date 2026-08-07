# Service levels, budgets, quotas, and retention — PROPOSED

> Work package: P8-SLO-01, buildable half
> Status: **DRAFT. Nothing in this document is approved.**
> Drafted against the repository as of July 28, 2026

## 1. What this document is, and what it is not

P8-SLO-01 reads "**Approve** numeric SLOs, error-budget alerts, performance budgets, quotas,
retention schedule, and operational owners **from beta evidence**". Two words in that sentence are
gates this document cannot pass:

- **Approve** is the repository owner's decision, not an agent's.
- **From beta evidence** presumes a private beta. There has been none. There is one environment
  (`verdery-dev`), one real user, no production project, and — per
  [runbooks.md](runbooks.md) §1.5 — **no alert policy, no notification channel, and no log-based
  metric in any Google Cloud project**.

So this is the draft that makes approving a real decision instead of a rubber stamp. Every number
carries a **derivation**: the constant, cadence, retry budget, or platform limit it was computed
from. Where a number has no derivation available today, it is marked
`PROPOSED-PENDING-MEASUREMENT` and the load harness scenario that would measure it is named
([load-testing.md](load-testing.md)).

Three marks are used throughout:

| Mark                           | Meaning                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `PROPOSED`                     | A number derived from something real in this repository. Approve, change, or reject it.     |
| `PROPOSED-PENDING-MEASUREMENT` | A number with no defensible derivation yet. The named load scenario must run first.         |
| `BLOCKED`                      | Cannot be proposed at all until a named thing exists. The blocker and its owner are stated. |

**This document does not restate** the per-signal dashboards, log-based metric definitions, and
alert candidates already written in
[../architecture/observability-and-analytics.md](../architecture/observability-and-analytics.md)
(subsections "Synchronization dashboard and alert candidates (P5-OBS-01)", "Media dashboard, alert
candidates, and runbook (P6-OBS-01)", and "Care-loop quality measurement and dashboards
(P7-ANALYTICS-01)"). It **consumes** them: an SLI here names the log field and the proposed
log-based metric that would carry it, and an alert here is a burn-rate policy over those metrics,
not a second copy of them.

## 2. The measurement problem, stated before any number

Every SLI below is expressed over a signal that exists as a **structured log field** and does not
yet exist as a **metric**. This is not a caveat to skim; it is the largest single item of work
between this draft and an approved scorecard.

| Fact                                                                                                        | Consequence for this document                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| No OpenTelemetry meter, counter, or histogram exists anywhere in `services/` — telemetry is traces and logs | Every application SLI must first be created as a Cloud Monitoring **log-based metric** over `jsonPayload.<field>`.  |
| `gcloud logging metrics list` on `verdery-dev` returns empty                                                | Zero of the ~40 metric definitions in observability-and-analytics.md have been created.                             |
| `gcloud alpha monitoring policies list` returns empty                                                       | No error-budget alert can fire. Section 6's policies are definitions, not deployments.                              |
| `services/workers` has never been deployed to any environment                                               | Every sweep, relay, and media-pipeline SLI below has **no producer today**. They are commitments for after rollout. |
| `SERVICE_VERSION` is the deployed image's tag (the commit SHA CI built)                                     | Burn-rate slicing by release is now possible; the slicing key is a commit SHA, not a semantic release identifier    |
| `TRACING_ENABLED` gates tracing and is off by default                                                       | Trace-derived latency is unavailable unless the deployment sets it.                                                 |

**Consequence for approval:** approving section 4's targets commits to building the metric layer in
section 3. The two are one decision.

## 3. The measurement layer this proposal depends on

Ordered by what unblocks the most SLIs per unit of work. All are `BLOCKED` on nothing but a decision
to run them — none needs new application code.

| Step | Work                                                                                                                                                        | Unblocks                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| M1   | Create the Cloud Run/Cloud SQL built-in-metric dashboard (no definitions needed — `run.googleapis.com/request_count`, `request_latencies`, and Cloud SQL's) | SLI-1, SLI-2, SLI-3                   |
| M2   | Create the sync log-based metrics (observability-and-analytics.md, P5-OBS-01 subsection)                                                                    | SLI-4, SLI-5                          |
| M3   | Deploy `services/workers` (three prerequisites named in [deferred-capabilities.md](deferred-capabilities.md))                                               | Producers for SLI-6 … SLI-11          |
| M4   | Create the media/async log-based metrics (P6-OBS-01 subsection)                                                                                             | SLI-6, SLI-7, SLI-8, SLI-10           |
| M5   | Create the care-loop log-based metrics (P7-ANALYTICS-01 subsection)                                                                                         | SLI-9                                 |
| M6   | ~~Stamp a real `SERVICE_VERSION` at build time~~ — done: `deploy-api.sh`/`deploy-workers.sh` set it to the image tag                                        | Release-sliced burn rate, canary gate |
| M7   | Create one notification channel and the section 6 alert policies                                                                                            | Any budget alert firing at all        |

## 4. Proposed SLIs and SLOs

**Window: 28 days, rolling.** Not calendar-monthly: a rolling window removes the "budget resets on
the 1st" incentive to ship risk at month end, and 28 days is four whole weeks, so a weekly usage
cycle contributes equally to every window.

### SLI-1 — Core API availability

- **Definition**: proportion of requests to `/v1/gardens/**`, `/v1/sync/**`, `/v1/exports/**`,
  `/v1/account/**`, and `/v1/notifications*` that do not return `5xx`.
- **Source**: Cloud Run `run.googleapis.com/request_count` grouped by `response_code_class`, minus
  `/v1/health/*` and `/v1/internal/*` (the first is probe traffic, the second is worker traffic
  whose failures are covered by SLI-10).
- **Target**: `PROPOSED` **99.5%** — 3 h 22 m of error budget per 28 days.
- **Derivation, and why not 99.9%**: the database is a single-zone `db-f1-micro` with
  `availabilityType: ZONAL` and no standby (runbooks.md §1.2). Cloud SQL applies maintenance by
  restarting a zonal instance, and the API refuses to start without the database
  (`startup.database_unavailable`, `main.ts`), so each maintenance event is a full outage of every
  authenticated route. `--max-instances=2` (`deploy-api.sh`) additionally makes an instance-level
  stall a majority outage. 99.9% (40 m/28 d) is smaller than a single Cloud SQL maintenance restart
  plus one cold-start storm; committing to it before **P8-DB-01** enables regional HA would be
  committing to a number the infrastructure cannot deliver.
- **Revision trigger**: raise to 99.9% in the same change that lands regional HA (P8-DB-01) and
  raises `--max-instances`.

### SLI-2 — Read latency

- **Definition**: server-side duration of `GET /v1/gardens`, `GET /v1/gardens/{id}`,
  `GET /v1/gardens/{id}/today`, `GET /v1/gardens/{id}/plants`, `GET /v1/notifications`.
- **Source**: `run.googleapis.com/request_latencies`, and `jsonPayload.responseTime` on the
  `request completed` line for route-template granularity Cloud Run's own metric lacks.
- **Target**: `PROPOSED` **p95 ≤ 400 ms**, **p99 ≤ 1500 ms**, on warm instances.
- **Derivation**: a live `GET /v1/health/live` against `verdery-api-dev` measured **53.12 ms** from
  a laptop over the public internet (k6, this work package — see load-testing.md §7), and
  `GET /v1/health/ready`, which includes a full database round trip, returns in under 400 ms
  (runbooks.md §1.8). A garden read is one to three indexed queries against the same connection
  pool, so 400 ms at p95 is "no worse than the readiness probe" — a target the system already
  meets on its slowest currently-measurable path. p99 at 1500 ms leaves room for pool contention
  at `DATABASE_POOL_MAX_CONNECTIONS = 10` without approaching the 10 s
  `DATABASE_STATEMENT_TIMEOUT_MS`, which is the hard ceiling any single request can consume.
- **Precondition that must be approved with it**: **cold starts are excluded from this SLI and
  covered by SLI-3a instead.** With `--min-instances=0` on `verdery-api-dev`, a cold request pays
  container start plus Cloud SQL connector certificate fetch and mTLS negotiation — the same
  latency that forced `DATABASE_CONNECTION_TIMEOUT_MS=15000` for the deployed environment
  (infrastructure.md). Folding a 5–15 s cold start into a 400 ms p95 would either make the SLO
  unmeetable or make it meaningless. Either set `--min-instances=1` and delete this exclusion, or
  approve the exclusion knowingly.

### SLI-2a — Cold-start frequency

- **Definition**: proportion of requests served by an instance on its first request.
- **Target**: `PROPOSED` **≤ 1%** of requests, or `--min-instances=1`, whichever the owner prefers.
- **Derivation**: Cloud Run's `container/startup_latency` and `instance_count` are built-ins; no
  application work is needed. The choice is a cost decision, not a technical one: one always-warm
  `cpu=1, memory=512Mi` instance is the price of deleting a 5–15 s tail from every idle period.

### SLI-3 — Mutation latency

- **Definition**: server-side duration of `POST`/`PATCH`/`DELETE` under `/v1/gardens/**`.
- **Target**: `PROPOSED` **p95 ≤ 800 ms**, **p99 ≤ 2500 ms**.
- **Derivation**: every mutation in this codebase commits, in one transaction, the domain write plus
  a `platform.audit_event` row plus (where applicable) a `platform.outbox_event` row plus a
  `platform.sync_change` row plus an idempotency record — four to five inserts where a read does
  one select. 2× the read target at p95 is that ratio, rounded to a number an operator can hold in
  their head. p99 stays well inside the 10 s statement timeout.

### SLI-4 — Synchronization push acceptance

- **Definition**: `accepted + duplicate` as a proportion of
  `accepted + duplicate + rejected + conflict`, per operation, over a trailing 1 hour.
- **Source**: `jsonPayload.event="sync.push.completed"` fields, via the proposed
  `sync_push_accepted` / `_duplicate` / `_rejected` / `_conflict` log-based metrics.
- **Target**: `PROPOSED` **≥ 95%**.
- **Derivation**: this is exactly P5-OBS-01's own push-rejection burn candidate (">5% over a
  trailing 10-minute window") restated as an objective rather than a page. `conflict` is included
  in the denominator but not the numerator deliberately — a conflict is a routine outcome of
  concurrent editing, but a system producing conflicts on more than one operation in twenty is not
  serving the user well either.
- **Excluded from the ratio**: `blockedByDependency` and `retryLater`. Both are transient by
  construction and deliberately not persisted to the idempotency store
  (`sync-push-idempotency.ts`); `retryLater` is additionally always `0` today because no command
  throws `DependencyUnavailableError`. Counting a structural zero would fake precision.

### SLI-5 — Full-resynchronization rate

- **Definition**: `sync_pull_rejected` (all codes) over `sync_pull_completed + sync_pull_rejected`,
  trailing 24 hours.
- **Target**: `PROPOSED` **≤ 2%**.
- **Derivation**: P5-OBS-01's own full-resync burn candidate, verbatim. The dominant rejection code
  is `sync.changes.cursor_expired`, which fires when a client's cursor is older than
  `SYNC_CHANGES_RETENTION_MILLISECONDS = 30 days`
  (`synchronization/application/sync-changes-cursor.ts`). 2% means "at most one client in fifty is
  offline longer than a month, or has lost its cursor to a bug" — above that, the 30-day window
  itself is the wrong number and should be revisited rather than alerted on.

### SLI-6 — Media upload verification completion

- **Definition**: `media.upload.completed` with `outcome="available"` as a proportion of all
  `media.upload.completed`, trailing 1 hour; **and** deep-validation `failed_terminal` results as a
  proportion of all `media_validation` results, trailing 1 hour.
- **Target**: `PROPOSED` **≥ 95% synchronously available**, and **≤ 5% terminal validation
  failures**.
- **Derivation**: the 5% figure is P6-OBS-01's own validation-failure-ratio alert candidate.
- **Known baseline that must be subtracted before this SLI is meaningful**: every PDF
  `imported_plan` fails validation **retryably by design** while `UnavailableMalwareScanner` is the
  selected adapter (no malware provider has been chosen — deferred-capabilities.md). That produces
  a nonzero `media_processing.job_failed_retryable` baseline proportional to PDF plan uploads. The
  SLI must filter `jobKind="media_validation" AND outcome="failed_terminal"` specifically;
  measuring "any validation failure" would score a documented no-op as an outage.

### SLI-7 — Media processing pipeline latency

- **Definition**: `requestedToCompletedMs` (job row creation → terminal recording, including Cloud
  Tasks queueing and every retry) p95, trailing 6 hours.
- **Target**: `PROPOSED` **p95 ≤ 10 minutes**, **p99 ≤ 60 minutes**.
- **Derivation**: the healthy path is one relay poll (`RELAY_POLL_INTERVAL_MS = 5000`) plus a Cloud
  Tasks dispatch plus worker execution — seconds. The p99 ceiling is not invented: Cloud Tasks is
  configured with `--max-retry-duration=3600s` (`10-media-processing-queue.sh`), so **no job can
  legitimately take longer than one hour**; anything beyond it has exhausted its retry budget and
  is a stuck job, not a slow one. The 10-minute p95 is P6-OBS-01's own pipeline-stall threshold.

### SLI-8 — Media deletion completion

- **Definition**: `deletionLagMs` (`deletion_scheduled` → confirmed `deleted`) p95, trailing 24
  hours; **and** the count of `jobKind="media_deletion"` results with `outcome != "succeeded"`.
- **Target**: `PROPOSED` **p95 ≤ 2 hours**, and **zero** non-`succeeded` deletion outcomes.
- **Derivation**: P6-OBS-01's candidate 4, with its own reasoning: a deletion's entire retry budget
  is one hour, so a deletion completing much later was completed by a re-emitted cleanup event
  rather than the primary path. The zero-tolerance half is structural — a deletion job has exactly
  one legitimate terminal outcome.
- **Why this one is compliance-relevant and not merely operational**: it is the only SLI whose
  breach means a user was told their data was deleted while the bytes are still in Cloud Storage.
  Section 6 gives it a stricter alert policy than its error budget alone would justify.

### SLI-9 — Notification dispatch timeliness

- **Definition**: `earliest_delivery_at` → first `intentsSent`, p95.
- **Target**: `PROPOSED` **p95 ≤ 5 minutes**.
- **Derivation**: the delivery sweep runs every `NOTIFICATION_DELIVERY_SWEEP_INTERVAL_MS = 60000`
  and claims `DELIVERY_SWEEP_CLAIM_LIMIT = 25` intents per tick, under a
  `DELIVERY_CLAIM_LEASE_MS = 5 minutes` lease. First-attempt delivery is therefore at most ~1
  minute after the intent becomes due; 5 minutes matches the lease and the first retry step
  (`DELIVERY_RETRY_BASE_DELAY_MS = 5 minutes`), so an intent that needs exactly one retry still
  fits.
- **Hard throughput ceiling this target implies**: 25 intents/tick × 60 ticks/hour = **1,500
  intents per hour**. Above that the backlog grows monotonically and this SLO is unmeetable at any
  latency. That is the number to watch as user count grows, and the reason the load harness's
  recommendation-batch scenario measures intents created per sweep.

### SLI-10 — Outbox publication lag

- **Definition**: `relay.tick_completed.oldestClaimedEventAgeMs` p99, trailing 1 hour.
- **Target**: `PROPOSED` **p99 ≤ 60 seconds**.
- **Derivation**: P6-OBS-01's candidate 1. Healthy steady state is within one or two 5 s poll
  intervals; 60 s is twelve consecutive failed drains. Note the relay claims
  `RELAY_BATCH_SIZE = 20` per 5 s tick — a **240 events/minute** publication ceiling, which is the
  real capacity number behind this latency target.

### SLI-11 — Deletion purge completion

- **Definition**: recovery deadline → `garden.purged` / `account.purged` audit event, p95.
- **Target**: `PROPOSED` **p95 ≤ 24 hours after the recovery deadline**.
- **Derivation**: the deletion sweep runs hourly and claims `DELETION_CLAIM_BATCH_LIMIT = 10` plus
  `DELETION_RESUME_BATCH_LIMIT = 10` per tick — **240 subjects claimed per day**. A purge
  additionally _waits_ for every media record to reach `deleted`, which is itself bounded by SLI-8's
  2-hour target. 24 hours accommodates one full media-deletion cycle plus several deferred-and-
  resumed sweep passes, and is far inside any reasonable reading of the 30-day promise.

### SLI-12 — Export package delivery

- **Definition**: `export.requested` → `export_generation.package_completed`, p95.
- **Target**: `PROPOSED-PENDING-MEASUREMENT`. Suggested starting point **p95 ≤ 30 minutes** for a
  garden-scope export without media.
- **Why not derived**: the export job is checkpointed and drains a `PAGE_SIZE = 1000` keyset over
  every section, and its duration is dominated by garden size and media byte count — neither of
  which has a measured distribution, because no real garden of any size exists. The
  `LOAD-04 recommendation batch` and a dedicated export run in load-testing.md must produce the
  distribution first.

## 4.1 The one recovery number that is now measured

Every objective above describes the service running. This one describes it coming back, and unlike
the rest it is no longer an estimate.

On 2026-07-26 the 09:00 UTC automated backup of `verdery-dev-pg` was restored by cloning to a
scratch instance, which reached `RUNNABLE` with the `verdery` database present; the scratch
instance was then deleted. **Measured end to end: 52 minutes** (`04:46:57Z` → `05:38:52Z`, taken
from the Cloud SQL operation's own timestamps, not a stopwatch).

Three consequences for approving this document:

- The backups are **validated** by reliability-and-disaster-recovery.md §7's own standard
  ("Backups are not considered valid until restoration is tested"), which they were not before.
- **52 minutes is longer than a one-hour recovery objective can absorb** once the decision to
  restore, the DNS or configuration cutover, and any verification are added. An RTO for the
  database layer alone should be proposed at **PROPOSED: 2 hours**, not one, on the current
  `db-f1-micro` zonal instance.
- It measures the **database layer only**: no application was pointed at the restored instance, and
  the drill ran on a quiet morning rather than under pressure. A full service-recovery number is
  still unmeasured, and regional HA (P8-DB-01, deferred to production by owner decision) would
  change this figure entirely, since a failover is minutes rather than an hour.

## 5. Error-budget policy

### 5.1 The budget

| SLO   | Target | Budget per 28 days                                                |
| ----- | ------ | ----------------------------------------------------------------- |
| SLI-1 | 99.5%  | 0.5% of requests, ≈ 3 h 22 m of total unavailability              |
| SLI-4 | 95%    | 5% of push operations                                             |
| SLI-5 | ≤ 2%   | 2% of pulls                                                       |
| SLI-6 | 95%    | 5% of uploads                                                     |
| SLI-8 | 0 bad  | **No budget.** Any non-`succeeded` media deletion is an incident. |

Latency SLIs (2, 3, 7, 9, 11) are budgeted the same way: the "bad event" is a request or job
exceeding the target percentile bound, and the budget is the complement of the percentile.

### 5.2 Burn-rate alerting

Multi-window, multi-burn-rate, over a 28-day budget. These are the standard SRE-workbook windows;
the value of using them unmodified is that they are widely understood and their false-positive
behaviour is documented, which nothing invented here would be.

| Policy      | Burn rate | Long window | Short window | Budget consumed | Response                    |
| ----------- | --------- | ----------- | ------------ | --------------- | --------------------------- |
| Fast burn   | 14.4×     | 1 hour      | 5 minutes    | 2% in 1 h       | Page. Treat as an incident. |
| Medium burn | 6×        | 6 hours     | 30 minutes   | 5% in 6 h       | Page during working hours.  |
| Slow burn   | 1×        | 3 days      | 6 hours      | 10% in 3 d      | Ticket. Review at the next  |
|             |           |             |              |                 | weekly check.               |

Both windows must be burning for a policy to fire — the short window is what makes the alert stop
when the problem stops.

**SLI-8 (deletion) overrides this table**: a single `media_deletion` result with
`outcome != "succeeded"` pages immediately, with no window. Its runbook is
[runbooks.md](runbooks.md) RB-07 and the P6-OBS-01 "Deletion lag / deletion not completing" entry.

### 5.3 What exhausting the budget means

Proposed policy, to be accepted or replaced:

1. **Budget below 25% remaining**: no non-essential deploy to the affected surface. Reliability
   work takes priority over feature work until the trailing window recovers.
2. **Budget exhausted**: change freeze on the affected surface except for fixes to the cause and
   security patches. The freeze lifts when the rolling 28-day window shows the budget positive
   again — not when the incident is closed.
3. **Two consecutive windows exhausted**: the SLO is wrong or the architecture is. Re-derive rather
   than re-freeze.

With one operator (section 8), a freeze is self-imposed, and that is the point: it is a written
commitment to stop shipping, made in advance, when the operator is least inclined to.

### 5.4 The honest state of alerting today

**Zero of these policies can exist right now.** There are no notification channels and no
log-based metrics in `verdery-dev` (runbooks.md §1.5), and `services/workers` has no deployment, so
the majority of the signals have no producer. Section 3's M1–M7 are the prerequisites. Until they
are done, the operating model is exactly what runbooks.md documents: **a person runs a query**.

## 6. Performance budgets

### 6.1 Web client

| Budget                    | Proposed                       | Derivation                                                                                                                                 |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Largest Contentful Paint  | `PROPOSED` p75 ≤ 2.5 s         | Core Web Vitals "good" threshold — an external published standard, deliberately not a number invented here.                                |
| Interaction to Next Paint | `PROPOSED` p75 ≤ 200 ms        | Same source.                                                                                                                               |
| Cumulative Layout Shift   | `PROPOSED` p75 ≤ 0.1           | Same source.                                                                                                                               |
| First-load JS per route   | `PROPOSED-PENDING-MEASUREMENT` | Must be set from the actual `next build` route table, not guessed. Set it at the current measured value plus 15%, so it becomes a ratchet. |
| Map editor interaction    | `PROPOSED-PENDING-MEASUREMENT` | Geometry tolerances (ADR-0010) bound correctness, not frame time. Needs a real garden with real object counts, which no environment has.   |

**Blocker for all four**: nothing collects web vitals today. `apps/web` declares no RUM or analytics
SDK, and observability-and-analytics.md §9's web telemetry is a design. These budgets are
enforceable in CI against a synthetic run (Lighthouse) before any RUM exists; that is the cheaper
half and is the recommended starting point.

### 6.2 Native client

`BLOCKED`. observability-and-analytics.md §8 routes launch, garden-open, map-render, sync-cycle and
upload spans to Crashlytics/Firebase Performance, and `apps/ios/Package.swift` declares neither
dependency — only `FirebaseAuth`, `FirebaseAppCheck`, and `FirebaseCore`. Adding one is a new
third-party SDK, which this repository's rules require an ADR for. **Owner decision, one ADR.**
Until then the only native performance signal is `CoreObservability.DiagnosticLog` on the device.

### 6.3 Backend budgets that are already enforced in code

Not proposals — these are live and worth listing because they are the real ceilings any SLO sits
under.

| Ceiling                                | Value                   | Where                                                                                     |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Request body                           | 1 MiB                   | `HTTP_BODY_LIMIT_BYTES`, global, no per-route override                                    |
| Event-loop delay before `503` shedding | 1000 ms                 | `MAX_EVENT_LOOP_DELAY_MS`, `@fastify/under-pressure`                                      |
| Statement timeout                      | 10 s                    | `DATABASE_STATEMENT_TIMEOUT_MS`                                                           |
| Connection pool                        | 10 (API) / 5 (workers)  | `DATABASE_POOL_MAX_CONNECTIONS`                                                           |
| Sync push batch                        | 500 operations          | `MAX_PUSH_BATCH_SIZE`                                                                     |
| Sync `dependsOn` per operation         | 20                      | `MAX_DEPENDS_ON_IDS`                                                                      |
| List page size                         | 100 max, 50 default     | Contract `Limit` parameter, enforced per route                                            |
| Today page size                        | 25 max, 10 default      | `TODAY_MAX_LIMIT` / `TODAY_DEFAULT_LIMIT`                                                 |
| AI explanation call                    | 10 s, 512 output tokens | `RECOMMENDATION_AI_CALL_TIMEOUT_MS` / `_MAX_OUTPUT_TOKENS`                                |
| AI call budget                         | 50/hour, 500/day        | `RECOMMENDATION_AI_MAX_CALLS_PER_HOUR` / `_PER_DAY`, consumed atomically before each call |

**One of these is a trap worth naming.** The 1 MiB body limit is global and the sync push batch cap
is 500 operations, so the _effective_ per-operation payload ceiling is roughly 2 KB. A client that
batches 500 map-geometry operations will hit the body limit, not the batch limit, and receive a
`413` from Fastify rather than the contract's typed `request.operations.too_large`. The load
harness's `sync-backlog` scenario probes exactly this boundary.

## 7. Quotas

### 7.1 The state today: there are no quotas

Three findings, all verified in code, that this section exists to resolve:

1. **No rate limiting of any kind exists.** `@fastify/rate-limit` is not a dependency. The `429`
   machinery (`quota.rate_limited`, `QuotaExceededError`) is a translation layer for _inbound_
   provider 429s and has no producer of its own. `trustProxy: true` is set but nothing consumes the
   client address for limiting. This is threat-model.md's `T-COST-01`, `-02`, `-05`, `-10`.
2. **The storage quota is a complete ledger with no ceiling.**
   `media/domain/quota-reservation.ts` implements reserve → commit/release correctly and says so in
   its own header: "nothing here sums reservations against a limit or rejects a reservation for
   exceeding one." This is `T-COST-03`. Enforcing it is a small API-layer check once a number
   exists — the mechanism is already built.
3. **Two list endpoints have no pagination at all.** `ListObservationsForGarden`,
   `ListObservationsForPlant`, and `ListTasksForGarden` have no `limit` in the application layer,
   the transport layer, or the SQL. A garden with 100,000 observations returns all of them in one
   response, against a service whose only backpressure is a 1000 ms event-loop shed.

The numbers below are the missing input threat-model.md §13 names explicitly ("the numbers are the
missing input").

### 7.2 Proposed rate limits, by operation class

Per-profile unless stated. Enforcement point is the API for now and the load balancer / Cloud Armor
once **P8-NET-01** lands; the two are complementary, not alternatives.

| Class                               | Proposed limit                | Derivation                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/session`             | 10/min and 60/hour **per IP** | The most expensive unauthenticated call in the product: one Firebase `verifyIdToken` **and** one `createSessionCookie` per request (`T-COST-02`). A real user signs in a handful of times a day; 60/hour is two orders of magnitude of headroom over legitimate use and still bounds the cost of a flood. |
| Reads (`GET` under `/v1/**`)        | 300/min                       | The web client's heaviest screen issues under 10 requests; TanStack Query dedupes and caches. 300/min is 5/s sustained — a rate no human interaction produces and every scripted scrape does.                                                                                                             |
| Mutations (`POST`/`PATCH`/`DELETE`) | 120/min                       | Each mutation costs 4–5 inserts (SLI-3's derivation). 120/min against a 10-connection pool with a 10 s statement timeout keeps a single abusive profile from consuming the pool.                                                                                                                          |
| `POST /v1/sync/push`                | 30/min **per installation**   | At the 500-operation cap this is 15,000 operations/minute from one device — far above any real offline backlog, and the natural unit is the installation, not the profile, because a profile legitimately has several.                                                                                    |
| `GET /v1/sync/changes`              | 60/min per installation       | A catching-up client pages at 100 changes each; 60 pages/minute drains 6,000 changes/minute, which exceeds any realistic backlog drain need.                                                                                                                                                              |
| `POST .../media` (registration)     | 60/hour                       | A heavy capture session is tens of photos. The request-rate bound limits object count; because garden photos have no fixed product byte ceiling, the separate stored-byte ceiling below remains the authoritative cost control.                                                                           |
| `POST /v1/exports`                  | already enforced              | One active export per requester, pre-checked and race-protected by the `export_request_one_active_per_requester` partial unique index. The only real per-user limit that exists today; no change proposed.                                                                                                |
| `/v1/internal/**`                   | not rate-limited              | Reachable only with a valid Google OIDC token for the configured service account. **P8-NET-01** must additionally make it unreachable from the public internet; a rate limit is not the right control here.                                                                                               |

### 7.3 Proposed storage and entity ceilings

| Ceiling                  | Proposed              | Derivation                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored bytes per account | `PROPOSED` **5 GiB**  | Garden photos have no per-object product byte limit, so an aggregate account ceiling is the correct control: it permits a few unusually large originals without allowing storage cost to grow without bound. Enforced by summing `quota_reservation` at registration, which the existing ledger already supports. |
| Stored bytes per garden  | `PROPOSED` **2 GiB**  | Bounds a single shared garden independently of who uploads into it, which matters once Phase 9 adds collaborators.                                                                                                                                                                                                |
| Gardens per account      | `PROPOSED` **25**     | The product is "a living map of a real garden". 25 admits a professional's portfolio without admitting a script.                                                                                                                                                                                                  |
| Active plants per garden | `PROPOSED` **5,000**  | The evaluation sweep reads plants in `PLANT_PAGE_SIZE = 200` pages per garden; 5,000 is 25 pages, keeping one garden's evaluation bounded to roughly the same work as one 25-garden keyset page.                                                                                                                  |
| Observations per garden  | `PROPOSED` **50,000** | Directly bounds the unbounded `ListObservationsForGarden` response. At the observed row shape this keeps a worst-case listing inside the 1 MiB body limit only if pagination is _also_ added — see the note below.                                                                                                |
| Tasks per garden         | `PROPOSED` **20,000** | Same reasoning for `ListTasksForGarden`.                                                                                                                                                                                                                                                                          |
| Map objects per garden   | `PROPOSED` **10,000** | Geometry rows are the largest per-row payload in the product; this is the ceiling the map editor's own rendering budget should be measured against.                                                                                                                                                               |

**An entity ceiling is not a substitute for pagination.** The observation and task listings must
gain a bounded `limit` regardless — a 50,000-row response is a denial of service against the client
even when it is a legal one against the server. Both changes belong together: the ceiling stops
unbounded _growth_, pagination stops unbounded _responses_.

### 7.4 Platform quotas that must move with these

| Setting                     | Today         | Needed for the above                                                                                                          |
| --------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run `--max-instances` | 2             | 2 is simultaneously a cost cap and a denial-of-service surface (`T-COST-01`): the cap _is_ the outage.                        |
| Cloud Run `--min-instances` | 0 (API)       | 1, if SLI-2's cold-start exclusion is not accepted.                                                                           |
| Cloud SQL tier              | `db-f1-micro` | A shared-core instance with a 10-connection application pool is the binding constraint on every latency SLO.                  |
| Billing budget              | none          | `billingbudgets.googleapis.com` is **not enabled** on `verdery-dev`, so no budget can exist at all (runbooks.md §1.6, RB-08). |

## 8. Retention schedule

Two columns matter more than the durations: **enforced** (is there code that actually deletes?) and
**mechanism**. Several rows are declared policy with no enforcement, and one is unbounded growth
nobody has decided about.

| Data                        | Period                      | Enforced | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export packages             | 7 days from registration    | **Yes**  | `EXPORT_PACKAGE_RETENTION_DAYS = 7` stamps `retention_deadline_at`; the hourly retention sweep schedules deletion; the exports bucket lifecycle rule deletes at `age: 7` independently. Two mechanisms, deliberately reconciled to the same number.                                                                                                                                                                                                     |
| Export download URLs        | 15 minutes per mint         | **Yes**  | `MEDIA_SIGNED_DOWNLOAD_TTL_MS = 900000`, bounded at load by a 7-day hard maximum in the config schema (`T-SIGN-07`). Not the same thing as the package's 7-day life.                                                                                                                                                                                                                                                                                    |
| Media upload sessions       | 1 hour (advisory)           | Partial  | `MEDIA_UPLOAD_SESSION_TTL_MS = 3600000` is what the API _tells_ the client. GCS resumable sessions live 7 days regardless; the advisory value is not enforced at the storage layer.                                                                                                                                                                                                                                                                     |
| Raw capture (`raw_capture`) | 30 days after extraction    | **No**   | `RAW_CAPTURE_RETENTION_DAYS = 30`, `enforced: false`, and structurally unreachable: `deriveDefaultRetentionDeadline` returns `null` for every class except `export_package`, so no raw-capture deadline is ever computed. No committed feature produces the anchoring event; automated reconstruction is research-only. There is also no bucket lifecycle rule on `verdery-dev-raw-capture`. **This is reserved policy the system does not implement.** |
| Abandoned uploads           | 7 days                      | **Yes**  | `STALE_UPLOAD_RECONCILIATION_DAYS = 7`; hourly sweep, `RETENTION_SWEEP_BATCH_LIMIT = 25` per run — a **600/day drain ceiling**.                                                                                                                                                                                                                                                                                                                         |
| Garden / account deletion   | 30-day recovery, then purge | **Yes**  | `DELETION_RECOVERY_WINDOW_MS`; hourly deletion sweep; a real ordered, checkpointed, resumable purge plan.                                                                                                                                                                                                                                                                                                                                               |
| Sync change log             | 30 days (client-facing)     | **No**   | `SYNC_CHANGES_RETENTION_MILLISECONDS` rejects an older cursor, but **no job ever deletes a `platform.sync_change` row**. The table grows without bound.                                                                                                                                                                                                                                                                                                 |
| Idempotency records         | 24 h / 30 d (client-facing) | **No**   | Same shape: the TTL gates reuse; **nothing prunes `platform.idempotency_record`**.                                                                                                                                                                                                                                                                                                                                                                      |
| Audit events                | none stated                 | **No**   | Nothing deletes from `platform.audit_event`, by design (an audit row must outlive its subject) — but "forever" has never been decided as a policy.                                                                                                                                                                                                                                                                                                      |
| Derived media               | Nearline at 30 days         | **Yes**  | `derived` bucket lifecycle rule (a storage-class change, not a deletion).                                                                                                                                                                                                                                                                                                                                                                               |
| Cloud Storage soft delete   | 7 days, all four buckets    | **Yes**  | Bucket default, never changed. This is the only recovery path for an accidental object delete — object versioning is off everywhere.                                                                                                                                                                                                                                                                                                                    |
| Cloud SQL backups           | 7 retained, daily 09:00 UTC | **Yes**  | Real and succeeding. **No restore has ever been performed** — RB-02.                                                                                                                                                                                                                                                                                                                                                                                    |
| Cloud SQL PITR              | 7 days of transaction logs  | **Yes**  | `pointInTimeRecoveryEnabled: true`, logs in `CLOUD_STORAGE`.                                                                                                                                                                                                                                                                                                                                                                                            |
| Diagnostic logs             | 30 days                     | Default  | Cloud Logging `_Default` bucket retention, never configured. observability-and-analytics.md §17 asks for "the shortest period that supports incident needs" — nobody has chosen one.                                                                                                                                                                                                                                                                    |

### 8.1 Retention decisions this document asks for

| Decision                             | Options                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.sync_change` growth        | Add a pruning sweep deleting rows older than the 30-day cursor window, **or** accept unbounded growth and record it. It cannot be both a 30-day promise and permanent storage.                                                          |
| `platform.idempotency_record` growth | Same choice, same 30-day figure.                                                                                                                                                                                                        |
| `platform.audit_event` retention     | `PROPOSED` **7 years** for security-relevant types (deletion, export, restricted media access, purge) and **2 years** for the rest, per observability-and-analytics.md §16's "distinct retention". Needs a legal input P8-PRIV-01 owns. |
| Diagnostic log retention             | `PROPOSED` **30 days** — the platform default, chosen deliberately rather than inherited, because RB-01…RB-09's queries all use `--freshness` windows of days, not months.                                                              |
| Raw-capture enforcement              | Accept `enforced: false` until Phase 10, **and** state it in the privacy notice in exactly those words (P8-PRIV-01), or add a bucket lifecycle rule now as a backstop that does not depend on the missing anchoring event.              |

## 9. Operational owners

Roles, not names, per the work package. **One person holds every role today**, and that is the most
important line in this section.

| Role                   | Owns                                                                                                  | Today                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Service owner          | The SLO targets themselves; accepting or rejecting this document; error-budget freeze decisions       | Repository owner                                                            |
| Primary on-call        | First response to any page; runbooks.md RB-01…RB-09; incident commander for SEV-1/SEV-2               | Repository owner                                                            |
| Secondary / escalation | Takes over when primary is unavailable or the incident exceeds 2 hours                                | **Does not exist.** Single point of failure, recorded not hidden.           |
| Data and privacy owner | Retention schedule §8; deletion and export correctness; the privacy notice (P8-PRIV-01)               | Repository owner                                                            |
| Security owner         | threat-model.md's mitigation register; credential compromise (RB-05); authorization incidents (RB-06) | Repository owner                                                            |
| Release manager        | The G8 checklist ([ga-checklist.md](ga-checklist.md)); canary and rollback decisions                  | Repository owner                                                            |
| Cost owner             | Budgets, quota ceilings §7, cost anomalies (RB-08)                                                    | Repository owner                                                            |
| Horticultural reviewer | [recommendation-safety-catalog.md](recommendation-safety-catalog.md) sign-off; safety escalations     | Named in that document; not an operational on-call role                     |
| Support owner          | Intake, triage, and severity assignment ([support-operations.md](support-operations.md))              | **Does not exist.** No inbox, no rota — P8-SUPPORT-01's establishment gate. |

**What single-operator ownership actually costs, stated plainly:** there is no escalation path, no
second pair of eyes on a destructive command, and no coverage while that person sleeps. The
proposed SLI-1 target of 99.5% (3 h 22 m per 28 days) is roughly one unattended overnight outage.
That is not a coincidence — it is the honest availability of a product with one operator and no
alerting. Approving 99.5% is approving that model; approving anything higher requires a second
person or an automated remediation path, not a stricter number.

## 10. What approval means

Signing this document is five decisions, not one:

1. **The targets in §4** — accept, change, or reject each. A rejected SLI is fine; an unowned one is
   not.
2. **The measurement layer in §3** — approving targets commits to M1–M7, because an SLO with no
   metric is a sentence, not an objective.
3. **The quota numbers in §7** — these are the "missing input" threat-model.md `T-COST-03`,
   `T-COST-05`, and §13's gap list are blocked on. Approving them unblocks a small,
   well-understood API-layer change.
4. **The retention decisions in §8.1** — particularly the two unbounded tables and the
   raw-capture enforcement gap, which is user-visible policy the system does not implement.
5. **The owner model in §9** — specifically, whether a single operator with no escalation is
   acceptable for the beta, and if so, that the availability target reflects it.

Until then this document is what it says on its first line: a draft, and the evidence needed to
turn it into a decision.
