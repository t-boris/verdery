# Load testing

> Work package: P8-LOAD-01, buildable half
> Harness: [`tests/load/`](../../tests/load/)
> Status: harness delivered and smoke-verified against `verdery-dev`. **The measurement runs are
> blocked** — see section 8.

## 1. What is delivered, and what is blocked

P8-LOAD-01 is "**Run** interactive, sync backlog, upload burst, recommendation batch, provider
slowdown, failover, and cost load tests", with "Production-like staging" as its stated dependency
and "Capacity and unit-cost report" as its completion evidence.

**There is no production-like staging.** Only `verdery-dev` exists
([deferred-capabilities.md](deferred-capabilities.md), "Staging and production"), and it is not
merely smaller — it is differently shaped in the exact dimensions a load test measures:

| Dimension            | `verdery-dev`                             | Why it invalidates a capacity number                                                                   |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cloud Run instances  | `--max-instances=2`                       | The cap is reached before any interesting saturation behaviour. The result is the cap, not the system. |
| Database             | `db-f1-micro`, `ZONAL`, no standby        | A shared-core instance's CPU credits dominate every latency measurement.                               |
| Workers              | **not deployed at all**                   | No relay, no sweeps, no media pipeline. Four of the seven scenarios have no server-side counterpart.   |
| Cloud Tasks          | API **not enabled**; queue does not exist | The upload-burst scenario's asynchronous half cannot run.                                              |
| Data volume          | one user, effectively empty               | The evaluation sweep's cost is O(eligible gardens); with ~0 gardens it measures nothing.               |
| Rate limiting / edge | none, no load balancer, no Cloud Armor    | A load test would measure the absence of the controls P8-NET-01 is meant to add.                       |

So this document delivers the **harness**: real, runnable scripts for each named scenario, derived
from how this system actually behaves, with pass/fail thresholds wired to the PROPOSED numbers in
[service-levels.md](service-levels.md). What it does not deliver is the capacity report, and it says
who unblocks that in section 8 rather than approximating it.

One thing was run for real, and its output is in section 7: the smoke scenario, against
`verdery-dev`, at trivial volume.

## 2. Tool choice: k6

**Chosen: [k6](https://grafana.com/docs/k6/latest/) (Grafana Labs, AGPL-3.0), scripts in JavaScript,
executed by a single Go binary.**

| Alternative                             | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Artillery**                           | Closest competitor and a genuine option — Node-native, so it would install through pnpm like everything else. Rejected because its load generator runs on the Node event loop, which makes the generator itself the first thing to saturate on a laptop, and because its YAML-first model fits the sync/upload scenarios poorly: both need real per-iteration control flow (cursor paging, resumable chunk loops), which is k6's default mode and Artillery's escape hatch. |
| **Gatling**                             | Excellent and widely used, but introduces a JVM and Scala/Java to a repository whose toolchain is pinned to Node 24 and Swift 6.3 by ADR-0009. A second language runtime for one work package is not proportionate.                                                                                                                                                                                                                                                         |
| **JMeter**                              | Mature, but XML test plans are not reviewable in a pull request in any meaningful sense, and scripting the resumable-upload and keyset-pagination loops means BeanShell/Groovy — worse than the JavaScript we would otherwise write.                                                                                                                                                                                                                                        |
| **Locust**                              | Python, pleasant to write, but adds a third language runtime and its default generator is likewise single-process-bound.                                                                                                                                                                                                                                                                                                                                                    |
| **`autocannon` / `oha` / `wrk`**        | Excellent single-endpoint benchmarks with no scripting model at all. Five of the seven scenarios are multi-step flows with state (cursors, media ids, idempotency keys). Wrong shape.                                                                                                                                                                                                                                                                                       |
| **Cloud-hosted (k6 Cloud, BlazeMeter)** | Removes the generator-side ceiling, and is the right answer eventually. Rejected now because it needs an account, a budget, and an owner decision — none of which exist, and none of which is needed to write the scripts.                                                                                                                                                                                                                                                  |

**k6 is a binary, not an npm dependency, and that is deliberate.** It is a Go program; there is no
meaningful `k6` package on npm, and vendoring one would be a wrapper around a download. Concretely,
this means:

- it does **not** appear in `package.json`, `pnpm-lock.yaml`, or any workspace;
- `pnpm install` does not obtain it — `tests/load/run.sh` checks for it and prints installation
  instructions when it is missing;
- its version is not pinned by the lockfile. Record the version used in any capacity report
  (`k6 version`); the smoke run in section 7 used **k6 v1.3.0**.

Install it with `brew install k6` on macOS, or the distribution packages linked from the k6
documentation on Linux. CI does not run these scenarios and should not: a load test against a
shared environment from every pull request is a denial-of-service against yourself.

## 3. Where the harness lives, and why

`tests/load/` at the repository root.

- **Not a pnpm workspace package.** `pnpm-workspace.yaml` globs `apps/web`, `services/*`, and
  `packages/*`. A top-level `tests/` is outside all three, so `pnpm -r build`, `-r test`, and
  `-r typecheck` can never pick it up — which is correct, because there is nothing here for them to
  build or type-check.
- **Not under `services/api/tests/`.** That directory is Vitest's, runs against Testcontainers, and
  belongs to one service. This harness targets a deployed environment across two services and the
  web front door.
- **Not under `infrastructure/`.** That directory is provisioning, and is owned by a different
  work package.
- **Files are `.mjs`, not `.js`.** The repository's ESLint configuration applies type-checked rules
  through the TypeScript project service; a `.js` file in no tsconfig fails to parse at all
  (verified). The existing `**/*.mjs` block already covers exactly this case — "build scripts and
  tool configuration files sit outside the TypeScript projects on purpose" — so `.mjs` makes the
  harness lint cleanly with no change to shared configuration. k6 runs `.mjs` files without
  complaint (verified, section 7). k6 runtime globals are declared per file with a
  `/* global __ENV */` comment rather than by widening the shared ESLint globals.

## 4. Credentials

Every scenario except `smoke` and `failover` needs authenticated callers. The harness **never mints
credentials**; they are supplied from outside.

- `VERDERY_ID_TOKENS` — comma-separated Firebase ID tokens, or
- `VERDERY_ID_TOKEN_FILE` — path to a JSON array of them.

The API accepts `Authorization: Bearer <Firebase ID token>` (the native client's path) or a session
cookie plus a double-submit `x-csrf-token` header (the web path). The harness uses the bearer form
only, for two reasons: no cookie jar, and — more importantly — it avoids turning
`POST /v1/auth/session` into background load. That endpoint costs a Firebase `verifyIdToken` **and**
a `createSessionCookie` per call, has no throttle of any kind, and is named in
[threat-model.md](threat-model.md) as `T-COST-02`, "the most expensive unauthenticated endpoint in
the product". A load harness should not be the first thing to prove that.

**Obtaining tokens.** Against a local stack, use the Firebase Auth emulator the Playwright E2E suite
already starts (`apps/web/e2e/run-e2e.sh`). Against a real project, exchange a test account's
credentials through the Identity Toolkit REST API and collect the `idToken` field. Either way a
Firebase ID token lives **one hour**, so a soak run longer than that needs the pool refreshed
between runs — a limitation to design around, not to hide.

`VERDERY_GARDEN_IDS` supplies garden ids the tokens can access. Scenarios refuse to start without
them rather than measuring a wall of 404s.

`VERDERY_INTERNAL_ID_TOKEN` (recommendation-batch and provider-slowdown only) is a **Google** OIDC
ID token, not a Firebase one, minted for the deployment's callback audience — the one worker-to-API
identity every sweep shares:

```bash
gcloud auth print-identity-token --audiences="<MEDIA_PROCESSING_CALLBACK_AUDIENCE>"
```

## 5. The seven scenarios

Each is derived from a real mechanism in this codebase; each derivation is stated so that a
reviewer can disagree with the shape rather than only with the numbers.

### LOAD-01 `interactive` — interactive read/write

**Shape.** One person's session: garden list → Today → plants → tasks, with think time, and a
mutation on roughly one iteration in ten. Read-to-write ratio ~9:1.

**Derivation.** The care loop's own asymmetry: a user looks at Today far more than they change
anything. Reads use the _contract maxima_ (`limit=100`, Today `limit=25`) rather than the defaults,
so the measurement is of the worst legal page, not the cheapest one. Reads and mutations are
recorded as two separate trends because SLI-2 and SLI-3 are two separate targets and a blended p95
hides exactly the regression they exist to catch.

**Measure.** `verdery_read_duration` p95/p99, `verdery_mutation_duration` p95/p99,
`http_req_failed`.

**Pass/fail.** Read p95 < 400 ms and p99 < 1500 ms (SLI-2); mutation p95 < 800 ms and p99 < 2500 ms
(SLI-3); failure rate < 0.5% (SLI-1).

### LOAD-02 `sync-backlog` — synchronization backlog drain

**Shape.** A device returning from a long offline period: push a bounded batch, then page the change
log until caught up. `full` uses a **ramping arrival rate**, not fixed VUs, because reconnections
are bursty — many devices come back at once after a network event.

**Derivation, entirely from the protocol.** `MAX_PUSH_BATCH_SIZE = 500`; each operation's own
client-generated `operationId` is the idempotency key, so this endpoint takes no `Idempotency-Key`
header; a structurally valid batch always returns `200` with one result per operation, and only a
request-level problem fails the whole call; pull pages are capped at `MAX_CHANGES_LIMIT = 100` and
resume from an opaque cursor that is present even on an empty page; a `409` is one of exactly two
codes and both mean "full resynchronization".

**The boundary this scenario exists to probe.** The body limit is **1 MiB globally, with no
per-route override**, and the batch cap is 500 operations — an effective ceiling of roughly **2 KB
per operation**. A client batching map-geometry commands will hit Fastify's `413` before it reaches
the contract's typed `request.operations.too_large`. `PROBE_BODY_LIMIT=true` asserts which ceiling
fires, once per VU. Both answers are legitimate; not knowing which is not.

**Measure.** `verdery_sync_push_duration`, `verdery_sync_pull_page_size` (a page sitting at 100
means clients are behind, not that pull is slow), `verdery_sync_push_rejected`,
`verdery_sync_full_resync`.

**Pass/fail.** Push rejection rate < 5% (SLI-4); full-resync rate < 2% (SLI-5).

### LOAD-03 `upload-burst` — media upload burst

**Shape.** A capture session: 5–30 photos over a couple of minutes, through the real three-step
flow — register (API) → PUT bytes (**direct to Cloud Storage, not through the API**) → complete
(API).

**Derivation.** The API never touches upload bytes: registration returns a raw GCS resumable session
URL, and **there is no chunk-size constant anywhere in this repository** — chunking is entirely the
client's choice. The scenario therefore makes chunk size an explicit knob
(`VERDERY_UPLOAD_CHUNK_BYTES`, default 8 MiB) and reports upload throughput separately from API
latency, because they load completely different systems. `308 Resume Incomplete` is treated as
success for non-final chunks; counting it as a failure would make every chunked upload look like an
outage.

**Two behaviours it is built to surface.** Registration performs **no size or MIME check** — the API
requires only a non-empty `declaredContentType` and a positive `declaredByteSize`, while the real
ceilings (25 MiB for `garden_photo`, 50 MiB for `imported_plan`) live in the worker's validation
policy and apply _after_ the bytes are stored. And the quota ledger reserves bytes at registration
and compares them to nothing (`T-COST-03`). `VERDERY_UPLOAD_OVERSIZE=true` demonstrates both in one
run.

**Measure.** `verdery_media_register_duration`, `verdery_media_complete_duration`,
`verdery_media_upload_duration` by chunk size, `verdery_media_uploaded_bytes`,
`verdery_media_completion_rejected`.

**Pass/fail.** Register and complete p95 < 800 ms (SLI-3); synchronous rejection rate < 5% (SLI-6).

**Server-side signals to read alongside it** (once workers are deployed):
`media_processing_pipeline_ms` p95 < 10 min (SLI-7) and `relay_oldest_claimed_event_age_ms` p99
< 60 s (SLI-10). k6 cannot see these — they are Cloud Monitoring metrics over worker logs, and the
report must include them.

### LOAD-04 `recommendation-batch` — recommendation evaluation batch

**Shape.** Drive the evaluation sweep directly through
`POST /v1/internal/recommendation-evaluation/sweep`, measure wall-clock and per-garden throughput,
then read Today and assert it still meets SLI-2.

**Derivation.** This is the one job whose cost scales with the **dataset**, not with traffic. It
reads eligible gardens in `EVALUATION_SWEEP_PAGE_SIZE = 25` keyset pages ordered by `garden.id ASC`
and **drains the entire eligible set every run** — a per-run cap was rejected in the implementation
because evaluation leaves no durable ordering key, so a cap would starve gardens past it forever.
Each garden then evaluates under a transaction-scoped advisory lock, reading plants in
`PLANT_PAGE_SIZE = 200` pages. So the meaningful measurement is _seconds per sweep as a function of
eligible-garden count_, which is why this scenario is one iteration of a long call rather than a
request-rate ramp.

**Guards.** It refuses to run without `VERDERY_ALLOW_SWEEP_WRITES=true`, because a sweep writes
recommendation candidates. It asserts the shape of the `embellishment` summary, which is `null`
while the AI kill-switch (`RECOMMENDATION_AI_EXPLANATION_ENABLED`, default `false`) is off — a
silently enabled Vertex path would otherwise go unnoticed in a cost run.

**Measure.** `verdery_evaluation_sweep_duration`, `verdery_evaluation_gardens`,
`verdery_evaluation_candidates_created`, `verdery_today_after_sweep_duration`.

**Pass/fail.** Today p95 < 400 ms during and after the sweep. The sweep's own duration has **no pass
mark** until section 4 of service-levels.md is approved — the run's job is to produce the
gardens-per-second figure that a target could then be set from.

**The number the report must contain.** Sweep duration divided by `gardensEvaluated`, extrapolated
to the eligible-garden count at which it exceeds the 6-hour interval
(`RECOMMENDATION_EVALUATION_SWEEP_INTERVAL_MS = 21600000`). That crossing point is when this design
must move to a Cloud Run Job — a migration the implementation's own comments already anticipate.

### LOAD-05 `provider-slowdown` — provider slowdown

**Shape.** Hold steady interactive read traffic while driving the weather-refresh sweep
concurrently. Assert the read path stays inside SLI-2.

**Derivation, and the property under test.** Every provider call in this system happens inside a
worker-driven sweep — never inside a request a user is waiting on. If that holds, a slow provider
degrades _freshness_, not _availability_. That is the property worth a load test, and it is what
this scenario asserts.

**What it can and cannot measure today, precisely.** Zero providers are registered:
`compose-integrations.ts` constructs `new WeatherProviderRegistry([])`,
`WEATHER_ACTIVE_PROVIDER_KEY` is unset everywhere, and the AI kill-switch is off. So today the sweep
returns the typed `noProviderConfigured` degradation for every considered garden, and the run
measures the **floor** — the sweep's cost with no provider latency in it at all. That is still the
baseline every later measurement is compared against, and it proves the assertion mechanism works.

Inducing real provider latency is **blocked on a provider existing** (`P0-PROV-01`, undecided), not
deferred by choice. When one is selected, point its registration's base URL at a delaying stub in a
staging deployment and re-run this script unchanged — the assertions are already correct. Note that
a provider registration carries a `fetchTimeoutMs` with **no default**: the deadline is
per-registration, so "how slow is too slow" is a per-provider number this scenario will measure
rather than assume.

**Measure.** `verdery_read_during_provider_load` p95/p99, `verdery_weather_sweep_duration`.

**Pass/fail.** Reads hold SLI-2 while the provider path is busy. Nothing else.

### LOAD-06 `failover` — failover and restart

**Shape.** Not a load test. A **witness**: a 1/second probe of `/v1/health/ready` plus one
authenticated read, running across an operator-initiated disruption, reporting the failure rate and
— more importantly — the **longest consecutive run of failed probes**, which is the outage duration
an average cannot show.

**Derivation.** A service that is down produces no logs, so the outage window cannot be reconstructed
from Cloud Logging afterwards. Readiness returns `503` (not `500`) when the database is unreachable
and is unauthenticated, so it distinguishes "dependency down" from "service broken" without
credentials. The authenticated probe runs alongside it because readiness can pass while a user-facing
path fails, and the gap between the two curves is what tells an operator whether the disruption
reached users.

**How to use it.** Start the probe, then in a second terminal perform the disruption:
`gcloud sql instances failover` (RB-02 — **needs HA, which `verdery-dev` does not have**),
`gcloud run services update-traffic --to-revisions=<older>=100` (RB-01), or a forced cold start.

**Measure.** `verdery_probe_failures`, `verdery_probe_successes`, `verdery_longest_outage_seconds`,
`verdery_ready_duration` tagged by status code.

**Pass/fail.** Deliberately none. A failover has no pass mark until an RTO is approved; the run
produces the number that an RTO would be set from. This is the artifact P8-DB-01's "failover and
restore report" needs.

### LOAD-07 `cost` — unit cost

**Shape.** Perform exactly N of each countable operation — reads, mutations, media registrations —
and report the counts with clean start and end timestamps.

**Derivation.** Cost cannot be measured from inside a load generator; the number lives in Cloud
Billing. What a generator _can_ produce is a precise, reproducible denominator. The costed unit is
**one active garden-day** (a garden's worth of a day's reads, writes, and uploads), not a request,
because this product's dominant costs are storage bytes and the evaluation sweep, both of which
scale with dataset rather than traffic.

**Measure.** `verdery_cost_garden_days`, `verdery_cost_reads`, `verdery_cost_mutations`,
`verdery_cost_media_registrations`, `verdery_cost_declared_media_bytes`, plus the run window printed
in `teardown`.

**Pass/fail.** None; it is a measurement. See section 6 for the arithmetic.

**Standing warning.** `billingbudgets.googleapis.com` is **not enabled** on `verdery-dev`, so no
budget exists and none can be created (runbooks.md §1.6, RB-08). There is no automatic ceiling on
what a cost run can spend.

### LOAD-00 `smoke` — harness self-test

Unauthenticated, single VU, five iterations, three requests each: both health endpoints and one
deliberate root-path `404` that also verifies the error envelope carries a `correlationId` and a
`retryable` flag. This is the only scenario safe to point at any environment without further
thought, and the only one that has actually been run (section 7).

## 6. Turning a cost run into a unit-cost figure

1. Record the window `teardown` prints.
2. Query Cloud Billing for that window, grouped by service. The dominant lines will be Cloud Run
   (vCPU-seconds and requests), Cloud SQL (instance-hours, which are constant and must be
   apportioned, not divided), Cloud Storage (bytes stored × time, which accrues **after** the
   window), and Cloud Tasks operations once the queue exists.
3. Divide the **variable** portion by `verdery_cost_garden_days`.
4. Add the storage term separately: `verdery_cost_declared_media_bytes` × the bucket's per-GiB-month
   rate × retention. Media bytes are stored indefinitely for `garden_photo` (no duration-based
   retention rule — see service-levels.md §8), so this term is a recurring cost per garden-day
   forever, not a one-off. It is the single most important number in the report.
5. Note the fixed floor separately. A `db-f1-micro` running continuously costs the same with zero
   users as with a thousand; dividing it by garden-days at low volume produces a per-garden cost
   that is an artifact of the denominator, not of the product.

## 7. The one real run

Executed July 25, 2026 against the live `verdery-dev` API, k6 v1.3.0 (`darwin/arm64`), from a
laptop over the public internet. Trivial volume by construction: 1 VU, 5 iterations, 15 requests
total, no writes.

```
$ k6 run -e VERDERY_BASE_URL=https://verdery-api-dev-t6amsr5o6a-uc.a.run.app \
    tests/load/scenarios/smoke.mjs

  █ THRESHOLDS
    http_req_duration
    ✓ 'p(95)<400' p(95)=84.37ms
    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS
    checks_total.......: 45      7.692725/s
    checks_succeeded...: 100.00% 45 out of 45
    checks_failed......: 0.00%   0 out of 45

    ✓ live is 200
    ✓ live reports alive
    ✓ live carries a version
    ✓ ready is 200
    ✓ ready reports ready
    ✓ database dependency is available
    ✓ root health is 404
    ✓ error envelope carries a correlation id
    ✓ error envelope declares retryability

    http_req_duration: avg=48.42ms min=33.01ms med=39.81ms max=161.38ms p(90)=48.86ms p(95)=84.37ms
    http_req_failed..: 0.00%  0 out of 15
    http_reqs........: 15     2.564242/s
    iterations.......: 5
    data_received....: 12 kB
```

**What this proves**, and only this: k6 executes the `.mjs` scripts; the shared config, threshold,
and check plumbing works; `VERDERY_BASE_URL` and the `/v1` prefix are handled correctly; the live
API answers both health endpoints with the database reachable; and the error envelope is the shape
every scenario's assertions assume. The `p(95)=84.37 ms` figure is one client, one region hop, and
three trivial endpoints — it is _not_ a capacity result and must not be quoted as one. It does,
however, supply the only real latency datum this repository has for a database-touching request,
which is where service-levels.md SLI-2's 400 ms proposal is anchored.

**What it deliberately did not do:** no authenticated call, no write, no concurrency beyond one
virtual user. Every non-smoke profile against any remote target is refused by `run.sh` unless
`VERDERY_CONFIRM_NON_SMOKE=yes` is set, because the only deployed service runs with
`--max-instances=2` — where a real load profile is a self-inflicted outage, not a measurement.

Three further verification runs are worth recording, because two of them found real defects in this
harness rather than in the system:

- `k6 inspect` on all eight scenario files: all parse and expose valid `options`.
- Each authenticated scenario's `setup()` guard: refuses with a named environment variable and a
  document reference rather than measuring a wall of 401s. Verified by running `interactive` with no
  token pool (exit 107, correct message).
- **A defect found and fixed in `run.sh`'s own guard.** Its first version matched the target URL
  against `*verdery-dev*`, but the live service's host is `verdery-api-dev-…` — the substring never
  matched, so a `full` profile against the real service was silently permitted. It was caught by
  running the refusal case rather than by reading the script. The guard now confirms **every**
  non-smoke run against any non-localhost target, which does not depend on knowing an environment's
  name in advance.

## 8. What is blocked, precisely, and who unblocks it

| Blocked                                     | Blocker                                                                                               | Unblocked by                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Every capacity number                       | No production-like staging exists                                                                     | **Owner** — a decision to create `verdery-staging`; the scripts and configuration pattern already exist |
| LOAD-03's asynchronous half                 | Cloud Tasks API not enabled; queue never created; workers never deployed                              | The three prerequisites in deferred-capabilities.md, then a live deploy (owner-confirmed action)        |
| LOAD-04 at a meaningful scale               | Effectively zero eligible gardens; the sweep's cost is O(eligible gardens)                            | A seeded dataset, which needs a staging environment to seed into                                        |
| LOAD-05's actual slowdown                   | Zero providers registered; `P0-PROV-01` undecided                                                     | **Owner** — provider selection                                                                          |
| LOAD-06's database failover                 | `verdery-dev` is `ZONAL` with no standby; `gcloud sql instances failover` has nothing to fail over to | **P8-DB-01** — regional HA                                                                              |
| LOAD-07's cost arithmetic                   | `billingbudgets` API not enabled; no budget; no billing export configured                             | **Owner** — enable the API and configure export                                                         |
| Server-side thresholds (SLI-7, -8, -9, -10) | The metrics do not exist: zero log-based metrics in any project                                       | service-levels.md §3, steps M2–M5                                                                       |
| Interpreting a saturation result at all     | No rate limiting, no load balancer, no Cloud Armor — a test would measure the absence of the controls | **P8-NET-01**, **P8-SEC-02**                                                                            |

**The honest summary.** Six of seven scenarios are runnable against `verdery-dev` today at a smoke
profile and will produce output; none of them will produce a _capacity_ number, because the
environment's two-instance ceiling and shared-core database are the answer to every question before
the application is. The harness is the half that could be built without those; the report is the
half that cannot.
