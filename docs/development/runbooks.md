# Operational runbooks

> Work package: P8-REL-01
> Last exercised: July 25, 2026
> Environment covered: `verdery-dev` (the only environment that exists)

This document is the consolidated operational response layer for
[../architecture/reliability-and-disaster-recovery.md](../architecture/reliability-and-disaster-recovery.md)
section 18 ("Required runbooks") and section 19 ("Exercises"). That document states what the
system should do under failure; this one states what a person types, in what order, against the
infrastructure that exists on the day of writing.

**One file, not a directory.** `docs/development/` is flat — every entry in it is a single `.md`
with no subdirectories — and splitting ten runbooks across ten files would put the one artifact
this package is actually judged on, the [exercise log](#exercise-log), either in an eleventh file
disconnected from the procedures it scores or duplicated ten times. The runbooks also share one
factual foundation ([section 1](#1-ground-truth-what-exists-in-verdery-dev-today)) that every
scenario reads from; separate files would either repeat it or drift from it. The repository's
file-size rule exempts documentation explicitly (`AGENTS.md`: "Documentation and other text-only
files may exceed 600 lines when needed for completeness and coherence"; `scripts/check-file-size.mjs`
inspects only `SOURCE_EXTENSIONS`, which does not include `.md`), so length is not a reason to
split.

**What this document does not do.** It does not restate the per-alert runbook entries already
written against specific instrumented signals:

- Synchronization alerts and their responses: [../architecture/observability-and-analytics.md](../architecture/observability-and-analytics.md),
  "Synchronization dashboard and alert candidates (P5-OBS-01)".
- Media upload, processing, retention, and deletion alerts and their responses: same document,
  "Media dashboard, alert candidates, and runbook (P6-OBS-01)" — six named alert candidates with
  reasoned thresholds and a runbook entry each.
- Care-loop quality signals: same document, "Care-loop quality measurement and dashboards
  (P7-ANALYTICS-01)".

Those are the leaf-level responses to individual signals. This document is the incident-level
layer above them: it covers the ten scenarios reliability-and-disaster-recovery.md section 18
names, cross-references the per-alert entries where they already exist, and fills the eight
scenarios that had no procedure at all.

## Status legend

Every procedural step carries one of three marks, and every runbook ends with a per-step
disposition. The marks are load-bearing: an unmarked runbook is a runbook nobody has tried.

| Mark | Meaning                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `E`  | **Exercised.** Run for real during this work package, against `verdery-dev` or a local harness. Real output and elapsed time in the log.  |
| `R`  | **Read-only verified.** The command was run; it is a query, not a mutation. It returned what the runbook claims it returns.               |
| `U`  | **Unexercised.** Not run, with a named blocker. Never "we did not get to it" — always a specific missing authorization or missing system. |

## 1. Ground truth: what exists in `verdery-dev` today

Every fact in this section was read from the live project on July 25, 2026 with the commands
shown. Nothing here is inferred from a script that was written but never run — several scripts in
`infrastructure/gcloud/scripts/` are in exactly that state, and the difference matters enormously
to an operator at 03:00.

### 1.1 Compute

```bash
gcloud run services list --project=verdery-dev --region=us-central1 \
  --format='table(metadata.name,status.url,status.latestReadyRevisionName,spec.template.spec.serviceAccountName)'
```

| Service           | URL                                               | Runtime service account     |
| ----------------- | ------------------------------------------------- | --------------------------- |
| `verdery-api-dev` | `https://verdery-api-dev-t6amsr5o6a-uc.a.run.app` | `verdery-dev-api-runtime@…` |
| `verdery-web-dev` | `https://verdery-web-dev-t6amsr5o6a-uc.a.run.app` | `verdery-dev-web-runtime@…` |

Plus one Cloud Run Job, `verdery-api-dev-migrate`.

**`verdery-workers-dev` does not exist.** This is the single most important operational fact in
this document, and it silently invalidates a large share of the failure surface the architecture
describes. The outbox relay, the media-validation HTTP target, and all four interval sweeps
(weather refresh, recommendation evaluation, media retention, notification delivery) live in
`services/workers`, which has never been deployed to any environment. `deploy-workers.sh` says so
in its own header ("written and syntax-checked … NOT executed against `verdery-dev`"), and the
live project confirms it. Consequences that thread through this whole document:

- No domain event ever leaves `platform.outbox_event` in `verdery-dev`. Rows accumulate
  unpublished. Nothing is lost — the relay is designed to drain whatever it finds whenever it
  starts — but nothing is delivered either.
- The media retention sweep does not run, so scheduled deletions never complete and stale uploads
  are never reconciled.
- Every P6-OBS-01 alert candidate keyed on `service: "verdery-workers"` log events has no producer.

### 1.2 Database

```bash
gcloud sql instances describe verdery-dev-pg --project=verdery-dev \
  --format='yaml(settings.backupConfiguration,settings.availabilityType,settings.deletionProtectionEnabled,gceZone,secondaryGceZone)'
```

| Property                       | Live value                        | Target in reliability-and-disaster-recovery.md |
| ------------------------------ | --------------------------------- | ---------------------------------------------- |
| `availabilityType`             | `ZONAL`                           | §6: "Regional high availability"               |
| `gceZone` / `secondaryGceZone` | `us-central1-a` / _(none)_        | A standby zone                                 |
| `deletionProtectionEnabled`    | `false`                           | §6, §15: deletion protection                   |
| `backupConfiguration.enabled`  | `true`, daily at `09:00` UTC      | §7: automated backups                          |
| `backupRetentionSettings`      | `retainedBackups: 7`, unit COUNT  | §7: "approved retention"                       |
| `pointInTimeRecoveryEnabled`   | `true`                            | §3: RPO ≤ 5 minutes                            |
| `transactionLogRetentionDays`  | `7`, stored in `CLOUD_STORAGE`    | §7: PITR window sufficient for RPO             |
| `tier` / `dataDiskSizeGb`      | `db-f1-micro` / 10 GB, autoresize | —                                              |
| `ipConfiguration.ipv4Enabled`  | `false` (private IP only)         | ADR-0007                                       |

**The honest backup posture, stated plainly:** backups and point-in-time recovery are real,
enabled, and succeeding. This was worth checking rather than assuming — the brief anticipated
"none configured", and that turned out to be wrong. What is missing is not backup, it is
_availability_ and _protection_: the instance is single-zone with no standby, and deletion
protection is off, so a mistaken `gcloud sql instances delete` succeeds today.

Backups actually on disk:

```bash
gcloud sql backups list --instance=verdery-dev-pg --project=verdery-dev
```

Four `SUCCESSFUL` backups, none in error: `2026-07-25T09:00Z`, `2026-07-24T09:00Z`,
`2026-07-23T09:00Z`, and `2026-07-22T12:48:19Z` (the automatic first backup taken at instance
creation). The retention policy allows seven; four exist because the instance is four days old.

**No restore has ever been performed.** Per reliability-and-disaster-recovery.md §7, "Backups are
not considered valid until restoration is tested" — by that standard these backups are unvalidated.
See [RB-02](#rb-02-database-restore).

### 1.3 Storage

```bash
gcloud storage buckets list --project=verdery-dev \
  --format='table(name,location,storage_class,versioning_enabled,soft_delete_policy.retention_duration_seconds,lifecycle_config.rule.len())'
```

| Bucket                    | Location      | Versioning | Soft delete   | Lifecycle rules |
| ------------------------- | ------------- | ---------- | ------------- | --------------- |
| `verdery-dev-user-media`  | `US-CENTRAL1` | _off_      | 604800s (7 d) | 0               |
| `verdery-dev-raw-capture` | `US-CENTRAL1` | _off_      | 604800s (7 d) | 0               |
| `verdery-dev-derived`     | `US-CENTRAL1` | _off_      | 604800s (7 d) | 1               |
| `verdery-dev-exports`     | `US-CENTRAL1` | _off_      | 604800s (7 d) | 1               |

Object versioning is off everywhere; the recovery mechanism for an accidental object delete is
Cloud Storage **soft delete**, whose 7-day window is the bucket default nobody has changed. All
four buckets are single-region `US-CENTRAL1`, so they share the region's fate — see
[RB-09](#rb-09-regional-recovery).

### 1.4 Identity and secrets

```bash
gcloud iam service-accounts list --project=verdery-dev --format='table(email,disabled)'
gcloud secrets list --project=verdery-dev
gcloud iam workload-identity-pools list --location=global --project=verdery-dev
```

Five service accounts: `verdery-dev-api-runtime`, `verdery-dev-web-runtime`,
`verdery-dev-deployer`, `firebase-adminsdk-fbsvc`, and the Compute Engine default
`417008876420-compute@developer`. **`verdery-dev-worker` does not exist**, consistent with §1.1.

One secret: `verdery-dev-pg-postgres-superuser-password`. **`verdery-dev-worker-database-url` does
not exist**, which is the second of the three blockers `deploy-workers.sh` names in its own header.

Workload identity pool `github-actions` is `ACTIVE`. CI authenticates through it and holds no
stored key.

**Zero user-managed service-account keys exist, on any of the five accounts.** Verified rather
than asserted:

```bash
for sa in $(gcloud iam service-accounts list --project=verdery-dev --format='value(email)'); do
  echo "$sa $(gcloud iam service-accounts keys list --iam-account="$sa" --managed-by=user \
    --project=verdery-dev --format='value(name)' | grep -c .)"
done
```

Every line returned `0`. The keyless posture is real, not aspirational, and this loop is the
standing audit command — see [RB-05](#rb-05-credential-compromise).

### 1.5 Observability

```bash
gcloud alpha monitoring policies list --project=verdery-dev
gcloud alpha monitoring channels list --project=verdery-dev
gcloud logging metrics list --project=verdery-dev
```

All three returned **empty**. There are no alert policies, no notification channels, and no
log-based metrics in `verdery-dev`.

This is the second fact that reshapes every runbook below. observability-and-analytics.md
documents dashboards, alert candidates, and thresholds in detail, and is explicit that they are
designs rather than deployments ("not a deployed dashboard or alert policy"). The live project
agrees. **Therefore no runbook in this document may open with "when the alert fires."** Detection
today is a person running a query. Each runbook's trigger section gives the query that a human
runs, and names the alert that would replace it once alerting is built.

### 1.6 Enabled APIs, and what their absence means

```bash
gcloud services list --enabled --project=verdery-dev --format='value(config.name)'
```

Present and relevant: `run`, `sqladmin`, `secretmanager`, `logging`, `monitoring`, `cloudtrace`,
`storage`, `artifactregistry`, `iam`, `sts`, `iamcredentials`, `identitytoolkit`, `securetoken`,
`fcm`, `recaptchaenterprise`, `servicenetworking`, `pubsub`.

**Absent, each with an operational consequence:**

| API              | Consequence                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| `cloudtasks`     | The media-processing queue does not exist. `10-media-processing-queue.sh` never ran. |
| `aiplatform`     | Vertex AI is unreachable; the explanation adapter cannot call anything.              |
| `cloudscheduler` | No Google-side scheduling. Sweeps rely on the (undeployed) worker's own intervals.   |
| `billingbudgets` | No budget can exist. See [RB-08](#rb-08-cost-anomaly).                               |

Confirmed directly for Cloud Tasks:

```bash
$ gcloud tasks queues list --location=us-central1 --project=verdery-dev
ERROR: (gcloud.tasks.queues.list) PERMISSION_DENIED: Cloud Tasks API has not been used in
project verdery-dev before or it is disabled.
```

### 1.7 Log shape

Verified by reading two real entries. Structured application logs land in
`run.googleapis.com%2Fstdout` as `jsonPayload`, and Cloud Run's own access logs land in
`run.googleapis.com%2Frequests` as `httpRequest`. The application fields that exist on every line:

| Field                                                    | Example                 | Notes                                       |
| -------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| `jsonPayload.service`                                    | `verdery-api`           | `verdery-workers` once that service deploys |
| `jsonPayload.level`                                      | `info`, `warn`, `error` | Maps correctly to Cloud Logging `severity`  |
| `jsonPayload.msg`                                        | `request completed`     | Human message                               |
| `jsonPayload.reqId`                                      | UUID                    | Per-request                                 |
| `jsonPayload.traceId`                                    | 32 hex chars            | Joins to Cloud Trace                        |
| `jsonPayload.spanId`                                     | 16 hex chars            |                                             |
| `jsonPayload.environment`                                | `development`           |                                             |
| `jsonPayload.version`                                    | `0.0.0-development`     | Not a release identifier yet                |
| `jsonPayload.res.statusCode`, `jsonPayload.responseTime` | `200`, `0.897`          | On `request completed` only                 |

The pino-to-Cloud-Logging severity mapping was checked rather than assumed, because
severity-based alerting depends on it:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-api-dev"
   AND logName:"stdout" AND severity>=WARNING' \
  --project=verdery-dev --limit=5 --freshness=7d \
  --format='value(severity,jsonPayload.level,jsonPayload.msg)'
```

Returned rows where `severity=ERROR` and `jsonPayload.level=error` agree, including two real
incidents worth naming: `The database is unavailable; refusing to start` (the startup readiness
gate doing its job) and `Request failed with a server-side error`.

> **Bound every log query.** `gcloud logging read` over a wide time range can block for minutes.
> Every log command in this document carries `--limit` and `--freshness`, and an operator should
> wrap it in `timeout 60` when working an incident. A query that returns nothing inside that
> budget is a signal about the query, not about the system.

### 1.8 Health endpoints

Both verified live, returning in under 400 ms:

```bash
$ curl -s https://verdery-api-dev-t6amsr5o6a-uc.a.run.app/v1/health/live
{"status":"alive","version":"0.0.0-development"}

$ curl -s https://verdery-api-dev-t6amsr5o6a-uc.a.run.app/v1/health/ready
{"status":"ready","version":"0.0.0-development","dependencies":[{"name":"database","status":"available"}]}
```

The paths are `/v1/health/live` and `/v1/health/ready` — under the `/v1` prefix, not at the root.
`/health/ready` returns 404. The readiness body is the fastest database-reachability check an
operator has, and it is unauthenticated.

The 404 body also documents the API's error envelope, which appears throughout this document:

```json
{
  "error": {
    "code": "request.route_not_found",
    "message": "The requested route does not exist.",
    "correlationId": "7efac0dc-396e-42cb-9dc3-afc63c97b79a",
    "retryable": false
  }
}
```

`correlationId` is the value to carry into a log query; `retryable` tells a client whether to
retry and tells an operator whether the failure was classified as transient.

---

## RB-01: Bad deployment rollback

Covers reliability-and-disaster-recovery.md §18 "API bad deployment rollback" and §5
("Deployment traffic can roll back to a known compatible revision").

### Trigger and detection

There is no alert (§1.5). Detection today is one of:

- The deploy pipeline itself fails at its own verification step. `.github/workflows/deploy-dev.yml`
  curls `${SERVICE_URL}/v1/health/ready` with `--fail` after `deploy-api.sh`, and curls
  `${WEB_URL}/auth/sign-in` after `deploy-web.sh`. A red run at either step means the new revision
  is already deployed and already broken.
- A revision that never becomes ready. The classic shape here is a startup-configuration failure:
  `services/api` validates its whole environment at `loadConfiguration()` and refuses to start on
  any missing required variable. This has happened twice for real in this project — see
  [Known failure modes](#known-failure-modes-that-have-actually-occurred) below.
- A human noticing errors. The standing query:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-api-dev"
   AND severity>=ERROR' \
  --project=verdery-dev --limit=20 --freshness=1h \
  --format='value(timestamp,resource.labels.revision_name,jsonPayload.msg,jsonPayload.reqId)'
```

Once alerting exists, the replacing alert is observability-and-analytics.md §15's "API error or
latency burn rate", scoped by `resource.labels.revision_name` so a bad revision is distinguishable
from a bad dependency.

### Immediate assessment

**Step 1 — what is serving traffic right now.** `R`

```bash
gcloud run services describe verdery-api-dev --project=verdery-dev --region=us-central1 \
  --format='value(status.traffic.revisionName,status.traffic.percent)'
```

Real output during the exercise: `verdery-api-dev-00145-x7n	100`.

**Step 2 — is the newest revision even ready?** `R`

```bash
gcloud run revisions list --service=verdery-api-dev --project=verdery-dev --region=us-central1 \
  --format='table(metadata.name,status.conditions[0].status,metadata.creationTimestamp,spec.containers[0].image.basename())' \
  --limit=8
```

If the newest revision is `Ready=False`, Cloud Run never shifted traffic to it and **you are not in
an outage** — the previous revision is still serving. Fix forward calmly. If it is `Ready=True` and
serving, continue.

**Step 3 — pick the rollback target. This is the step that surprises people.** `E`

`deploy-api.sh` deploys in **two** calls: `gcloud run deploy --set-env-vars=…` followed by
`gcloud run services update --update-env-vars=MEDIA_PROCESSING_CALLBACK_AUDIENCE=…`. Each call
creates a revision. **Every API deploy therefore produces two revisions with the same image
digest**, and "roll back one revision" rolls back to the same code you are trying to escape.

This was verified against the live service across five consecutive deploys — the digests pair
exactly:

```
verdery-api-dev-00145-x7n  api@sha256:4a4dbc67…   <- current
verdery-api-dev-00144-6rc  api@sha256:4a4dbc67…   <- same code, NOT a rollback target
verdery-api-dev-00143-b6f  api@sha256:4460cd90…   <- the real previous release
verdery-api-dev-00142-x77  api@sha256:4460cd90…
verdery-api-dev-00141-nv9  api@sha256:9542e5c7…
verdery-api-dev-00140-d4f  api@sha256:9542e5c7…
```

Select the target by **image digest change**, never by revision ordinal:

```bash
CURRENT=$(gcloud run services describe verdery-api-dev --project=verdery-dev \
  --region=us-central1 --format='value(status.traffic[0].revisionName)')
CURRENT_IMG=$(gcloud run revisions describe "$CURRENT" --project=verdery-dev \
  --region=us-central1 --format='value(spec.containers[0].image)')
TARGET=$(gcloud run revisions list --service=verdery-api-dev --project=verdery-dev \
  --region=us-central1 --format='value(metadata.name,spec.containers[0].image)' --limit=20 \
  | awk -v img="$CURRENT_IMG" '$2 != img {print $1; exit}')
echo "current=$CURRENT target=$TARGET"
```

Exercised end to end read-only in 4.9 s. It correctly returned
`current=verdery-api-dev-00145-x7n target=verdery-api-dev-00143-b6f`, skipping the pair-twin
`00144`.

**Step 4 — confirm the target's environment is not missing anything the current one has.** `R`

```bash
diff <(gcloud run revisions describe "$CURRENT" --project=verdery-dev --region=us-central1 \
        --format='value[delimiter="\n"](spec.containers[0].env.name)' | sort) \
     <(gcloud run revisions describe "$TARGET" --project=verdery-dev --region=us-central1 \
        --format='value[delimiter="\n"](spec.containers[0].env.name)' | sort)
```

Empty output means the two revisions require the same variables and the rollback is
configuration-safe. Non-empty output means a required variable was **added** in the current
release; rolling back is still fine (the old code did not read it), but rolling _forward_ again
later must re-supply it. Verified empty between `00143` and `00141`.

### The migration-shaped rollback problem

**Read this before switching traffic.** `.github/workflows/deploy-dev.yml` runs migrations
_before_ deploying the API:

```
Build and push the API image  →  Run database migrations  →  Deploy to Cloud Run  →  Verify
```

So by the time you are rolling back, **the new schema is already applied**. A traffic rollback
moves code backwards and leaves the database forwards. Whether that is safe is decided entirely by
which phase of the expand/contract sequence the migration belonged to
([database-migrations.md](database-migrations.md), "The expand and contract sequence"):

| Migration phase in the rolled-back release | Is a traffic-only rollback safe?                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expand** (add nullable/defaulted shape)  | **Yes.** This is precisely what expand/contract buys: "A migration must be compatible with the application version that is already running." The old revision ignores the new column. |
| **Backfill** (data only)                   | **Yes.** No schema surface changed.                                                                                                                                                   |
| **Switch** (code reads the new shape)      | **Yes** for the schema; the old code reads the old shape, which is still present by policy.                                                                                           |
| **Contract** (drop the old shape)          | **NO.** The old revision still references the dropped column or table and will fail at query time. A traffic rollback across a contract migration trades one outage for another.      |

The policy is what makes this tractable, and the policy is only as good as the review that
enforced it. So the assessment step is: **read the migration files added in the release you are
rolling back.**

```bash
git diff --name-only "$TARGET_SHA".."$CURRENT_SHA" -- services/api/migrations/
```

If that list is empty, the rollback is unambiguously safe. If it contains a `DROP`, you are in the
contract case.

**Undoing a migration is possible, and is a separate, riskier action.** `services/api` ships a
down direction (`migrate.ts`'s `resolveDirection` accepts `up` | `down`, defaulting to `up`; each
migration file carries both directions by convention, and `database-migrations.md` requires `down`
to genuinely reverse `up`). The deployed job runs `node dist/migrate.js` with no direction
argument, so it migrates up. To migrate **down one migration**, override the job's args at
execution time:

```bash
gcloud run jobs execute verdery-api-dev-migrate \
  --project=verdery-dev --region=us-central1 \
  --args=dist/migrate.js,down --wait
```

`gcloud run jobs execute --args` is a real, supported override (confirmed against Google Cloud SDK
552.0.0). This is **mutating and was not exercised.** Constraints an operator must hold in mind:

- It rolls back exactly one migration per execution. Two migrations in the release means two runs.
- The down direction is exercised only by the Testcontainers migration suite, never against
  `verdery-dev`.
- A down migration that drops a column added in the expand phase **destroys any data written into
  it by the newer code**. Take a recovery point first ([RB-02](#rb-02-database-restore), §7 of
  reliability-and-disaster-recovery.md: "Point-in-time recovery before high-risk migrations").
- Prefer fixing forward. Down-migrating production data to escape a code bug is close to always
  the wrong trade.

### Remediation

**Option A — shift traffic to the previous good revision.** The fast path. Not exercised
(mutating).

```bash
gcloud run services update-traffic verdery-api-dev \
  --project=verdery-dev --region=us-central1 \
  --to-revisions="$TARGET=100"
```

Trade-offs: seconds to take effect; no rebuild; leaves the service **pinned** to a named revision,
so the next `deploy-api.sh` (which deploys with `--set-env-vars` and no traffic flag) will resume
`latestRevision` behavior — do not assume the pin persists. Does not touch the schema.

**Option B — re-deploy the previous image through the script.** Slower and more faithful, because
it reproduces the full environment-variable set rather than trusting the old revision's frozen
copy:

```bash
infrastructure/gcloud/scripts/deploy-api.sh dev \
  us-central1-docker.pkg.dev/verdery-dev/verdery/api@sha256:<previous-digest>
```

Trade-offs: takes minutes; produces two more revisions; but it is the only option that reapplies
`deploy-api.sh`'s current env-var logic, which matters if the bad release's problem was an
env-var gap the script has since fixed.

**Option C — fix forward.** Correct whenever the fault is a one-line configuration or copy error
and the pipeline is healthy. The whole pipeline (build, migrate, deploy, verify, web build, web
deploy, web verify) is the unit of latency here.

**Do not** roll back the web client and the API independently without checking their contract. The
web image bakes `API_PROXY_ORIGIN` and every `NEXT_PUBLIC_*` at **build** time
(`apps/web/Dockerfile` build args, set in `deploy-dev.yml`), so a web revision is bound to the API
origin it was built against — not to the API's current behavior. The pipeline already orders this
correctly (the web image is built only after the API verified healthy); a manual rollback must
preserve that ordering by hand.

### Verification

```bash
curl -sf https://verdery-api-dev-t6amsr5o6a-uc.a.run.app/v1/health/ready
```

Expect `{"status":"ready","version":"…","dependencies":[{"name":"database","status":"available"}]}`
— verified live, 0.35 s. Then confirm traffic actually moved and errors stopped:

```bash
gcloud run services describe verdery-api-dev --project=verdery-dev --region=us-central1 \
  --format='value(status.traffic.revisionName,status.traffic.percent)'

gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-api-dev"
   AND severity>=ERROR' \
  --project=verdery-dev --limit=10 --freshness=10m \
  --format='value(timestamp,resource.labels.revision_name,jsonPayload.msg)'
```

The web side: `curl -sf -o /dev/null -w '%{http_code}' https://verdery-web-dev-t6amsr5o6a-uc.a.run.app/`
returns `307` (the front door redirecting into the app) — verified live.

### Known failure modes that have actually occurred

Every one of these happened in this project and cost real time. They are here because a runbook
that encodes a failure the team has already hit beats a hypothetical one.

| Symptom                                                                                                                                           | Root cause                                                                                                                                                                                                      | Response                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revision never starts; log `MEDIA_PROCESSING_CALLBACK_AUDIENCE: Invalid input: expected string, received undefined` (`verdery-api-dev-00055-p8g`) | `gcloud run deploy --set-env-vars` **replaces** the whole env-var set rather than merging. A planned "set it in a follow-up call" pattern produced a first revision missing a required variable.                | Fixed in `deploy-api.sh` by resolving the URL _before_ the first call. If you ever write a two-step env update, expect this.                                                       |
| Revision never starts; log `The database is unavailable; refusing to start`                                                                       | Two distinct causes seen: the Cloud SQL connector's certificate fetch plus mTLS handshake exceeding the old 5 s `DATABASE_CONNECTION_TIMEOUT_MS` on a cold revision (now 15000), and genuine DB unavailability. | Check `/v1/health/ready` and `gcloud sql instances describe --format='value(state)'` before assuming the revision is at fault.                                                     |
| Migration Cloud Run Job fails before any migration runs                                                                                           | The job shares the API's whole-process `loadConfiguration()` validation, but for a long time only `deploy-api.sh` was updated when new required variables landed.                                               | `deploy-migration-job.sh` now sets the full set. Any new required variable must be added to **both** scripts in the same change.                                                   |
| Web deploy fails on `actAs`                                                                                                                       | Omitting `--service-account` made Cloud Run default to the compute default service account, which the deployer deliberately cannot impersonate.                                                                 | `deploy-web.sh` now passes a dedicated zero-permission identity. Never "fix" this by granting the deployer `actAs` on the compute default SA.                                      |
| Service deployed but returns 403 to everyone                                                                                                      | An `--allow-unauthenticated` invoker binding that silently did not apply.                                                                                                                                       | Verify with `gcloud run services get-iam-policy verdery-api-dev --region=us-central1` that `allUsers` holds `roles/run.invoker`, rather than trusting the deploy flag's exit code. |
| Deploy succeeds, sign-in silently fails in the browser                                                                                            | `SameSite=strict` session cookies are dead across sites; the web client and API were on different origins.                                                                                                      | The web server now proxies `/v1` same-origin. A rollback that changes which origin serves `/v1` re-breaks this — verify sign-in, not just `/v1/health/ready`.                      |

### Follow-up

- Record the incident, the target revision, and the elapsed time in the [exercise log](#exercise-log).
- If the cause was a missing environment variable, the fix belongs in **both** `deploy-api.sh` and
  `deploy-migration-job.sh`.
- If the cause was a migration, the follow-up is a review question, not a code question: was the
  expand/contract sequence actually followed?

### Step disposition

| Step                                       | Mark | Note                                                                                                     |
| ------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------- |
| Detection query                            | `R`  | Ran against live logs, bounded by `--limit`/`--freshness`.                                               |
| Assessment steps 1, 2, 4                   | `R`  | Read-only; returned exactly what this runbook claims.                                                    |
| Assessment step 3 (target selection)       | `E`  | Full pipeline run; correctly skipped the pair-twin revision.                                             |
| `update-traffic` remediation               | `U`  | Mutating. Blocker: owner authorization for a live traffic switch.                                        |
| `migrate … down` remediation               | `U`  | Mutating and destructive. Blocker: owner authorization; down direction never run outside Testcontainers. |
| Verification (`/v1/health/ready`, web `/`) | `E`  | Both curled live.                                                                                        |

---

## RB-02: Database restore

Covers reliability-and-disaster-recovery.md §18 "Database restore", §7 ("Database Backup"), and §8
("Restore Testing").

### What actually exists — the finding

This was checked, not assumed, and the answer is better than expected in one dimension and worse in
another.

**Backups exist and are healthy.** `verdery-dev-pg` has automated daily backups at 09:00 UTC with
`retainedBackups: 7`, point-in-time recovery **enabled**, and `transactionLogRetentionDays: 7` with
logs in `CLOUD_STORAGE`. Four successful backups are on disk, none in error. Full evidence in
[§1.2](#12-database).

**Against reliability-and-disaster-recovery.md's own targets, three gaps remain:**

1. `availabilityType: ZONAL`, `gceZone: us-central1-a`, no `secondaryGceZone`. §6 requires
   "Regional high availability". A zone failure is a full outage with a restore-shaped recovery,
   not a failover.
2. `deletionProtectionEnabled: false`. §6 and §15 both require deletion protection. A mistaken
   `gcloud sql instances delete verdery-dev-pg` succeeds today.
3. **No restore has ever been performed.** §7 is unambiguous: "Backups are not considered valid
   until restoration is tested." By the project's own standard, these backups are unvalidated.

These are `verdery-dev` facts. `P8-DB-01` (production database hardening) is unbuilt and there is
no production project, so the production posture is not "worse than this" — it does not exist.

### Trigger and detection

- **Backup age / failure.** No alert exists. The standing check, exercised in 2.3 s:

  ```bash
  gcloud sql backups list --instance=verdery-dev-pg --project=verdery-dev --limit=10
  ```

  Every row must read `SUCCESSFUL` with an empty `ERROR` column, and the newest `WINDOW_START_TIME`
  must be under ~26 hours old. Observability-and-analytics.md §15's "Cloud SQL availability,
  storage, or connections" is the alert that should replace this.

- **Corruption or destructive command.** Detected by the data-integrity checks
  reliability-and-disaster-recovery.md §16 enumerates, or by a human. Restore is the response of
  last resort; prefer targeted repair.

- **Instance gone or unhealthy.**

  ```bash
  gcloud sql instances describe verdery-dev-pg --project=verdery-dev \
    --format='value(state,settings.availabilityType,gceZone)'
  ```

### Immediate assessment

**Step 1 — is the database actually the problem?** `E` The API's readiness probe answers this in
one call and needs no database credentials:

```bash
curl -s https://verdery-api-dev-t6amsr5o6a-uc.a.run.app/v1/health/ready
```

`dependencies[].name="database"` with `status:"available"` means the database is reachable and
serving; the fault is elsewhere. Verified live.

**Step 2 — what is recoverable, and to when.** `R`

```bash
gcloud sql instances describe verdery-dev-pg --project=verdery-dev \
  --format='yaml(settings.backupConfiguration)'
gcloud sql backups list --instance=verdery-dev-pg --project=verdery-dev --limit=10
```

The PITR window is bounded by `transactionLogRetentionDays: 7`. Anything older than seven days is
recoverable only to a nightly backup boundary, which is an RPO of up to 24 hours — far outside the
five-minute target in §3. Establish the target timestamp **before** touching anything.

**Step 3 — decide restore-in-place versus clone.** This is the decision that matters most, and the
answer is almost always clone. See below.

### Remediation options

**Option A — clone to a new instance at a point in time. Strongly preferred.**

```bash
gcloud sql instances clone verdery-dev-pg verdery-dev-pg-restore-20260725 \
  --project=verdery-dev \
  --point-in-time='2026-07-25T20:45:00.000Z'
```

Trade-offs: **non-destructive** — the damaged instance stays untouched and available for forensics;
it is also the only form that satisfies §8's "Restore … into an isolated recovery project or
instance". Costs a second running instance. The application does not point at it until you
repoint it, which is a deliberate, reviewable second step. This is the shape a restore _drill_
should use, because it is safe enough to run without an outage.

**Option B — restore a backup over the existing instance.**

```bash
gcloud sql backups restore <BACKUP_ID> --restore-instance=verdery-dev-pg --project=verdery-dev
```

Trade-offs: **destructive and irreversible** — it overwrites the instance's current state, losing
everything written since the backup. Fastest path back to a known-good state when the current
state is known-worthless (e.g. a destructive command wiped a table and no good writes followed).
Requires an explicit owner decision. Never the first move.

**Option C — targeted repair instead of restore.** For a scoped logical error (one bad batch, one
table), a reviewed SQL repair against a clone-verified plan beats a whole-instance restore.
Reliability-and-disaster-recovery.md §16 is explicit that integrity checks "report and quarantine;
they do not perform broad automatic destructive repair" — the same restraint applies to the
operator.

### Post-restore verification

This is §8's checklist, made concrete for this schema. Run against the **restored** instance before
repointing any traffic.

1. **Extensions.** PostGIS is created by explicit migration SQL, not implicitly:
   `SELECT extname, extversion FROM pg_extension ORDER BY extname;` — expect `postgis` and
   `pg_trgm` among them.
2. **Migration state.** `services/api/src/migrate.ts` tracks applied migrations in the
   `pgmigrations` table:
   `SELECT name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 5;`
   The newest row must correspond to the newest file in `services/api/migrations/` (20 files as of
   this writing, newest `1786400000000_deletion-baseline.sql`). A restore to a point _before_ a
   migration leaves the schema behind the deployed code — that is a rollback problem, and
   [RB-01](#rb-01-bad-deployment-rollback)'s expand/contract table decides whether the running
   revision tolerates it.
3. **Roles.** `\du` must still show `verdery_migration` and `verdery_application`, both `NOLOGIN`,
   with the IAM database user holding the right memberships. A restore recreates database contents,
   not the Cloud SQL IAM user grants that `07-iam-database-bootstrap.sh` establishes — re-run that
   script's grant step if the restore target is a new instance.
4. **Geometry validity and ownership invariants.** The §16 checks: valid PostGIS geometries, garden
   owner invariant, foreign-key and ownership consistency.
5. **Sync continuity.** §16's "Sync sequence continuity" and "Outbox stuck records". A PITR restore
   rewinds the outbox along with everything else; events already published before the restore point
   but rewound will be republished. Every consumer is duplicate-safe by design
   (reliability-and-disaster-recovery.md §11, "Tasks and messages are duplicate-safe"), which is
   what makes this survivable — but it is a property to confirm, not assume, and it is currently
   unexercised because no relay is deployed ([§1.1](#11-compute)).
6. **Media references.** §16's "Media reference reconciliation": rows restored to an earlier point
   may reference objects since deleted, and objects may exist with no row. Cloud Storage is **not**
   rewound by a database restore — this cross-system skew is the single most under-appreciated
   consequence of PITR here. Soft delete gives a 7-day grace on the object side
   ([§1.3](#13-storage)), which happens to match the transaction-log retention window.
7. **Record the timings.** §8 step 7: "Record actual RPO/RTO and corrective actions." That is what
   the [exercise log](#exercise-log) is for.

### Follow-up

- A restore that has not been timed has not been tested. Add the row.
- If the restore was needed because of a destructive command, the follow-up is §15's list:
  deletion protection, separate migration identity, approval for production destructive commands.

### Step disposition

| Step                                | Mark | Note                                                                                                             |
| ----------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| Backup inventory / config read      | `R`  | Ran live; produced the posture in [§1.2](#12-database).                                                          |
| Readiness-probe assessment          | `E`  | Curled live, 0.35 s.                                                                                             |
| PITR window determination           | `R`  | Read from `transactionLogRetentionDays`.                                                                         |
| Clone / restore execution           | `U`  | Mutating and cost-bearing. Blocker: owner authorization; a clone spins up a second billable instance.            |
| Post-restore verification checklist | `U`  | Blocker: nothing to verify without a restore. The checklist is derived from the real schema, not generic.        |
| Restore timing for RPO/RTO          | `U`  | Blocker: depends on the restore itself. **This is the single largest unvalidated DR assumption in the project.** |

---

## RB-03: Queue backlog and dead letter

Covers reliability-and-disaster-recovery.md §18 "Queue backlog and dead letter" and §11 ("Queue and
Job Reliability"). The per-signal responses for the media pipeline are already written in
observability-and-analytics.md, "Media dashboard, alert candidates, and runbook (P6-OBS-01)" —
specifically the entries for _outbox publication lag_, _processing pipeline stall_, _deletion lag_,
_retention sweep absent_, and _sweep backlog saturation_. **This runbook does not repeat them.** It
supplies the layer those entries assume: what the queue substrate actually is, what "dead letter"
does and does not mean here, and the state of the system today.

### The state of the world, and why it changes the whole runbook

Two live facts:

- **`verdery-workers-dev` is not deployed** ([§1.1](#11-compute)). Nothing drains the outbox.
- **The Cloud Tasks API is not enabled** ([§1.6](#16-enabled-apis-and-what-their-absence-means)).
  `gcloud tasks queues list` returns `PERMISSION_DENIED: Cloud Tasks API has not been used in
project verdery-dev`. The `media-processing-dev` queue does not exist;
  `10-media-processing-queue.sh` has never been run.

So in `verdery-dev` today there is no backlog because there is no drain, and no dead letter because
there is no queue. The procedures below are written against the design as built in code and
scripts, and every one of them is marked `U` with that blocker. They are not speculative — the
retry numbers, table names, and event names are read from the repository — but they are unrun.

### There is no dead-letter queue, and there cannot be one

This is the most important correction this runbook makes to a generic mental model.

**Cloud Tasks has no dead-letter concept.** Pub/Sub does; Cloud Tasks does not. When a task
exhausts its retry policy, Cloud Tasks **deletes it**. There is no dead-letter destination to
inspect, drain, or replay. The queue's configured policy
(`infrastructure/gcloud/scripts/10-media-processing-queue.sh`) is:

```
--max-attempts=10  --max-retry-duration=3600s
--min-backoff=10s  --max-backoff=300s
--max-concurrent-dispatches=10  --max-dispatches-per-second=10
```

So a failing task is retried for **at most one hour**, then vanishes from the queue. What survives
is the durable row in `media.processing_job`, which is the real system of record. The "dead letter"
an operator inspects is therefore a **SQL query, not a queue**.

The transactional outbox has the mirror-image property, and it is worth stating just as plainly.
`platform.outbox_event` is:

```sql
-- services/api/migrations/1784736116655_identity-and-gardens-baseline.sql
CREATE TABLE platform.outbox_event (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  trace_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_event_unpublished_idx ON platform.outbox_event (occurred_at)
  WHERE published_at IS NULL;
```

Note what is **absent**: no `next_attempt_at`, no backoff column, no failure state, no maximum
attempt count, no terminal/dead status. `publish_attempts` counts up and nothing ever reads it as a
ceiling. The consequences are exactly two, and they pull in opposite directions:

- **Nothing is ever lost.** An event stays unpublished until it publishes. A relay outage of any
  length is pure delay. This is the property that makes an undeployed worker survivable.
- **A poisoned event retries forever, at full poll rate, with no backoff and no escape.** One event
  the relay cannot process will be re-claimed every poll interval indefinitely, and — because the
  relay claims in batches — can starve the events behind it. There is no automatic quarantine.

Detecting the second case is what the queries below are for, and the response is a code fix, never
a hand-edited row.

### Trigger and detection

No alerts exist ([§1.5](#15-observability)). The alert candidates that _should_ fire, with the
thresholds already reasoned in observability-and-analytics.md (P6-OBS-01), are: outbox publication
lag (`relay_oldest_claimed_event_age_ms` p99 > 60 s for 10 min), relay event failures (> 0 for
15 min), processing pipeline stall (p95 > 10 min for 1 h), deletion lag, retention-sweep absence
(3 h), and sweep backlog saturation. Consult that section for the reasoning behind each number.

Detection today is by query.

**Outbox stock — the single most useful query in this runbook.** `U` (blocker: no psql path from a
workstation; Cloud SQL is private-IP only, `ipv4Enabled: false`, so this must run from inside the
VPC or via the break-glass path in [RB-05](#rb-05-credential-compromise)).

```sql
SELECT event_type,
       count(*)                                        AS unpublished,
       min(occurred_at)                                AS oldest,
       now() - min(occurred_at)                        AS oldest_age,
       max(publish_attempts)                           AS worst_attempts
  FROM platform.outbox_event
 WHERE published_at IS NULL
 GROUP BY event_type
 ORDER BY oldest;
```

Reading it: a large `unpublished` with a **low** `worst_attempts` means the relay is not running
(the `verdery-dev` case today). A small `unpublished` with a **high and climbing**
`worst_attempts` on one `event_type` means a poisoned event. `oldest_age` is the user-visible
delay.

**Job stock — the real "dead letter".** `U` (same blocker)

```sql
SELECT job_kind, state, outcome_code, count(*), max(attempt) AS worst_attempt,
       min(created_at) AS oldest
  FROM media.processing_job
 WHERE state IN ('requested', 'queued', 'running', 'failed_retryable', 'failed_terminal')
 GROUP BY job_kind, state, outcome_code
 ORDER BY oldest;
```

The full state set is `requested`, `queued`, `running`, `succeeded`, `partial`,
`failed_retryable`, `failed_terminal`, `cancelled`, `expired`
(`media_processing_job_state_check`). A job sitting in `queued` or `failed_retryable` for **more
than one hour** has outlived the entire Cloud Tasks retry budget — its task is gone and it will
never be retried by anything. That is this system's dead letter.

**Log-side detection**, once workers are deployed (`jsonPayload.service = "verdery-workers"`):

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-workers-dev"
   AND jsonPayload.event=("relay.event_failed" OR "media_processing.job_failed_retryable"
                          OR "retention.sweep_failed")' \
  --project=verdery-dev --limit=20 --freshness=1h \
  --format='value(timestamp,jsonPayload.event,jsonPayload.outboxEventId,jsonPayload.jobId,jsonPayload.err)'
```

`relay.tick_completed` carries `claimed`, `enqueued`, `alreadyQueued`, `notificationsDispatched`,
`failed`, and `oldestClaimedEventAgeMs`; note that an **idle relay deliberately logs nothing per
tick**, so silence is not evidence of health — `retention.sweep_completed` (hourly, emitted even
with all-zero counts) is the worker's actual heartbeat.

### Immediate assessment

1. **Is the drain alive at all?** `gcloud run services list --region=us-central1 --project=verdery-dev`
   — if `verdery-workers-dev` is absent or has zero instances, stop here; nothing else matters.
   `deploy-workers.sh` requires **always-allocated CPU**: a CPU-throttled relay is a documented
   failure mode, because a Cloud Run service without always-on CPU stops executing its own poll
   timer between requests.
2. **Is the queue reachable?** `gcloud tasks queues describe media-processing-dev --location=us-central1 --project=verdery-dev`
   and check `state: RUNNING` — a **paused** queue accumulates silently.
3. **Is it broad or narrow?** The two SQL queries above answer this. Broad failure across every
   `event_type` points at Cloud Tasks or the database; a single `event_type` or a single repeated
   `outboxEventId` points at one poisoned event.
4. **Is the callback path healthy?** A worker that processes successfully but cannot report back
   leaves jobs in `running`. 401s in the **API's** logs mean the two-hop OIDC identity drifted —
   compare `MEDIA_PROCESSING_CALLBACK_AUDIENCE` on `verdery-api-dev` against
   `MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE` on `verdery-workers-dev`; `deploy-api.sh` and
   `deploy-workers.sh` are written to derive the identical string, and they must match exactly.

### Remediation options

**Option A — restore the drain.** Redeploy or restart the worker. The outbox's no-terminal-state
design means the backlog drains by itself once the relay runs; nothing needs replaying. Preferred
in essentially every backlog case. Trade-off: none, beyond the deploy itself.

**Option B — unpause or re-provision the queue.** `gcloud tasks queues resume media-processing-dev`,
or re-run `10-media-processing-queue.sh` for a queue that does not exist. Trade-off: a resumed
queue immediately dispatches its whole backlog at up to 10/s, which can stampede a dependency that
is still recovering. Fix the dependency first.

**Option C — re-drive a job whose Cloud Tasks retries were exhausted.** There is **no automatic
re-drive** — this is the documented gap from P6-OBS-01, and it is the single operational hole in
the async design. The manual procedure for a media record stuck in `deletion_scheduled` is written
in full in observability-and-analytics.md's P6-OBS-01 runbook entry ("Deletion lag / deletion not
completing"). Operationally it is: insert one new `platform.outbox_event` row with
`event_type = 'media.deletion_requested'`, a fresh UUID `id`, `aggregate_type = 'media_record'`,
the media id as `aggregate_id`, and the payload rebuilt exactly as
`appendMediaDeletionRequestedEvent` (`media-deletion-workflow.ts`) builds it. The relay picks it up
within one poll interval. This is safe **only** because the P6-RET-01 deletion path is idempotent
end to end by design — same object prefixes, fresh event id, convergent completion.

Trade-offs and hard rules:

- It is a hand-written row in a production table. Two people, one reviewing.
- **Never flip `upload_state` to `deleted` by hand.** That records an absence verification that
  never happened, and it is a compliance statement, not a status field.
- Re-driving a job whose failure was _deterministic_ just burns another hour of retries. Read
  `outcome_code` first.

**Option D — quarantine a poisoned outbox event.** There is no supported mechanism. The schema has
no dead state to move it to. The only correct responses are to fix the code that cannot process it
or, with owner approval and a recovery point taken first, to delete the row — accepting that the
event is then permanently lost. Prefer the code fix; the relay's infinite retry is buying time, not
losing data.

**Do not** raise `RETENTION_SWEEP_BATCH_LIMIT` (default 25) to drain a backlog faster. It is a
reviewed code constant, not a live-tuning knob.

### Verification

- Unpublished count falls and `oldest_age` shrinks on repeated runs of the outbox query.
- `relay.tick_completed` shows `failed: 0` and `oldestClaimedEventAgeMs` within a poll interval or
  two of zero.
- No `media.processing_job` row remains in `queued`/`failed_retryable` older than one hour.
- For a re-driven deletion: the record reaches `upload_state = 'deleted'`, and a `media.deleted`
  entry exists in `platform.audit_event`.

### Follow-up

- A poisoned event is always a producer bug. The payload is producer-written and trusted; a
  malformed one means the API wrote it wrong.
- Retry exhaustion with no re-drive is a **recorded gap**, not an accepted one. See
  [Gaps needing an owner decision](#gaps-needing-an-owner-decision).

### Step disposition

| Step                        | Mark | Note                                                                                                        |
| --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `gcloud tasks queues list`  | `R`  | Ran live; returned `PERMISSION_DENIED / SERVICE_DISABLED`, which **is** the finding.                        |
| Worker-presence check       | `R`  | Ran live; `verdery-workers-dev` absent.                                                                     |
| Outbox / job stock SQL      | `U`  | Blocker: Cloud SQL is private-IP only (`ipv4Enabled: false`); no VPC-side psql path exists for an operator. |
| Worker log queries          | `U`  | Blocker: no `verdery-workers-dev` service, so no log stream to query.                                       |
| Queue resume / re-provision | `U`  | Blocker: Cloud Tasks API disabled; enabling it is a mutating, cost-bearing action needing owner approval.   |
| Manual deletion re-drive    | `U`  | Blocker: mutating write to a production table; also no relay exists to pick the row up.                     |

---

## RB-04: Provider outage

Covers reliability-and-disaster-recovery.md §18 "Provider outage" and §12 ("Provider
Degradation").

### The design property that makes this runbook short

Every external provider in this system is reached through a registry that returns a **typed**
degradation rather than throwing, and every consumer has a defined behavior for each type. A
provider outage is therefore a **product-quality event, not an availability event**: core garden
read/write continues. Reliability-and-disaster-recovery.md §20 states this as a completion
criterion — "Core garden use degrades gracefully during optional-provider outage."

The operator's job is consequently _not_ to restore the provider. It is to (a) confirm the
degradation is the typed one rather than a crash, (b) confirm core paths are unaffected, and
(c) decide whether to disable the integration to stop wasting quota or money.

### Today's baseline: every optional provider is already off

This is not a hypothetical outage — it is the current steady state, and it is deliberate.

| Provider          | Selector                                                  | State in `verdery-dev`                                                                                      | Degraded behavior                                                                            |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Weather**       | `WEATHER_ACTIVE_PROVIDER_KEY` (optional, unset)           | No vendor selected (`P0-PROV-01` undecided)                                                                 | Typed `noProviderConfigured` on every request; `weather.refresh_sweep_completed` counts it   |
| **Plant content** | Provider-agnostic layer (P7-INT-02)                       | No vendor registered                                                                                        | Typed unavailable; catalog falls back to local taxonomy                                      |
| **Vertex AI**     | `RECOMMENDATION_AI_EXPLANATION_ENABLED` (default `false`) | Off. `aiplatform.googleapis.com` is **not enabled** ([§1.6](#16-enabled-apis-and-what-their-absence-means)) | No GenAI client constructed at all; deterministic rules produce every recommendation         |
| **FCM**           | `fcm.googleapis.com` enabled; no worker to deliver        | Delivery worker undeployed                                                                                  | In-app notification intent is preserved; push is best-effort transport                       |
| **Malware scan**  | No provider selected                                      | `UnavailableMalwareScanner`                                                                                 | PDF `imported_plan` validation fails **retryably by design** — a standing 503, not an outage |

That last row is the one that most often wastes an operator's time: a steady stream of
`media_processing.job_failed_retryable` for `jobKind` PDF validation is **expected**, not an
incident. Check whether the volume is simply PDF uploads before escalating.

Weather freshness windows double as cache windows: `WEATHER_OBSERVATION_FRESH_FOR_MS` (default
3 600 000 ms = 1 h) and `WEATHER_FORECAST_FRESH_FOR_MS` (default 21 600 000 ms = 6 h). Inside those
windows a provider outage is **invisible** — cached data serves. The frost-watch rule, the only
forecast consumer, declares `skip` on stale data rather than guessing.

### Trigger and detection

No alerts exist. Detection by query, once workers are deployed:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-workers-dev"
   AND jsonPayload.event="weather.refresh_sweep_completed"' \
  --project=verdery-dev --limit=10 --freshness=6h \
  --format='value(timestamp,jsonPayload.gardensConsidered,jsonPayload.refreshed,jsonPayload.freshCacheHits,jsonPayload.staleServed,jsonPayload.unavailable,jsonPayload.degradationReasons,jsonPayload.stoppedOnQuotaExhaustion)'
```

Interpretation:

- `degradationReasons.noProviderConfigured` equal to `gardensConsidered` — the documented no-op.
  **Not an incident.**
- `unavailable` climbing while `refreshed` collapses, with a _different_ reason — a real vendor
  outage.
- `staleServed` rising — the cache is doing its job; users see a stale indicator. Degraded, not
  broken.
- `stoppedOnQuotaExhaustion: true` — not an outage at all; this is a cost/quota event, see
  [RB-08](#rb-08-cost-anomaly).

For the API side, the general error query from [RB-01](#rb-01-bad-deployment-rollback) scoped by
`jsonPayload.msg` works; a typed degradation should produce **no** `severity=ERROR` line, and its
appearance there is itself the finding (a provider failure escaping as an exception rather than a
typed result is a bug).

### Immediate assessment

1. **Confirm the core is unaffected.** `curl -sf https://verdery-api-dev-t6amsr5o6a-uc.a.run.app/v1/health/ready`
   — provider health is deliberately **not** a readiness dependency (the live body lists only
   `database`). If readiness is green, the outage is confined to optional enrichment, which is the
   designed outcome. Verified live.
2. **Classify the degradation.** Typed-and-handled, or an exception? The second is a code defect
   and takes a different path entirely.
3. **Check the vendor.** Vendor status page; for Google-side providers, `gcloud services list
--enabled` plus the Google Cloud status dashboard.
4. **Bound the blast radius.** Which surfaces degrade — Today recommendations, plant catalog
   enrichment, push delivery — and for how long the cache windows above will mask it.

### Remediation options

**Option A — do nothing and let the typed degradation stand.** Usually correct. The system is
behaving as designed; users see stale indicators or fewer optional embellishments. Trade-off: for
a long outage, continued failing calls burn quota and add latency.

**Option B — disable the integration deliberately.** For Vertex AI this is the purpose-built
kill-switch:

```bash
gcloud run services update verdery-api-dev --project=verdery-dev --region=us-central1 \
  --update-env-vars=RECOMMENDATION_AI_EXPLANATION_ENABLED=false
```

**A critical operational detail: this is not a live toggle.** Configuration is parsed once at
process start by `loadConfiguration()`, so the flag is read at startup, not per request. Changing
it creates a **new revision** and restarts the service. Budget a deploy, not a config push. When
off, no GenAI client is constructed, the sweep's embellishment phase does not exist, and the Today
read path never touches the verdict table — behavior is exactly the pre-P7-AI-01 baseline.
Flipping it off **is** the rollback, and the model/prompt versions stored on each record are what
let evaluation compare across flips.

Use `--update-env-vars` (merge), never `--set-env-vars` (replace) — see
[RB-01](#known-failure-modes-that-have-actually-occurred) for the outage that lesson came from.

Trade-off: users lose AI explanations entirely rather than intermittently. For a vendor outage
lasting hours, that is the better experience and the cheaper one.

**Option C — unset the provider selector.** Removing `WEATHER_ACTIVE_PROVIDER_KEY` returns the
system to the typed `noProviderConfigured` path. Note the asymmetry, which is deliberate: setting
the key to a name with **no registration fails at startup construction, by design** — the system
refuses to run half-configured rather than degrading silently. So this must be an unset, not a
substitution to a placeholder.

**Do not** weaken verification during a provider outage. §12 is explicit for Firebase
Authentication: "Existing server-verifiable credentials may continue within safe validity; new
authentication may be unavailable. Do not weaken verification during outage." The same applies to
media validation — never relax `validation-policy.ts` ceilings as a firefight.

### Verification

- `weather.refresh_sweep_completed` shows `refreshed` recovering and `unavailable` falling.
- `/v1/health/ready` stayed green throughout (it should never have moved).
- For a kill-switch flip: confirm the new revision is serving
  (`gcloud run services describe … --format='value(status.traffic.revisionName)'`) and that
  recommendations still generate from the deterministic rule engine.

### Follow-up

- A provider failure that escaped as an exception rather than a typed result is a bug in the
  registry adapter, and it is the highest-value follow-up this runbook produces.
- Record the outage duration against the cache windows. If a one-hour observation window did not
  cover a routine vendor blip, that is evidence for a longer window, not for a retry loop.

### Step disposition

| Step                                    | Mark | Note                                                                                              |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| Readiness independence of providers     | `E`  | Curled live; `dependencies` lists only `database`, confirming providers are not readiness-gating. |
| Vertex AI reachability                  | `R`  | `gcloud services list --enabled` — `aiplatform` absent, so the kill-switch state is consistent.   |
| Provider configuration state            | `R`  | Read from `configuration-schema.ts` and confirmed against enabled APIs.                           |
| `weather.refresh_sweep_completed` query | `U`  | Blocker: no `verdery-workers-dev` service, so the event has no producer.                          |
| Kill-switch flip                        | `U`  | Blocker: mutating (creates a revision, restarts the service); needs owner authorization.          |

---

## RB-05: Credential compromise

Covers reliability-and-disaster-recovery.md §18 "Credential compromise" and §4's "Credential
compromise" failure domain.

### The attack surface, enumerated from the live project

The good news is structural: **there is almost nothing to steal.** Verified, not assumed.

**Zero user-managed service-account keys exist**, across all five service accounts
([§1.4](#14-identity-and-secrets)). This is the standing audit command, and it should return `0` on
every line forever:

```bash
for sa in $(gcloud iam service-accounts list --project=verdery-dev --format='value(email)'); do
  echo "$sa $(gcloud iam service-accounts keys list --iam-account="$sa" --managed-by=user \
    --project=verdery-dev --format='value(name)' | grep -c .)"
done
```

Ran in 7.7 s. A non-zero line is an incident on its own: a downloadable key is a credential that
can leave Google's boundary, and this architecture deliberately has none.

**CI holds no key either.** GitHub Actions authenticates through workload identity federation. The
binding, read live:

```
$ gcloud iam workload-identity-pools providers describe github-actions-oidc \
    --workload-identity-pool=github-actions --location=global --project=verdery-dev
attributeCondition: assertion.repository == 't-boris/verdery'
attributeMapping:
  attribute.environment: assertion.environment
  attribute.ref:         assertion.ref
  attribute.repository:  assertion.repository
  google.subject:        assertion.sub
oidc.issuerUri: https://token.actions.githubusercontent.com
state: ACTIVE

$ gcloud iam service-accounts get-iam-policy verdery-dev-deployer@verdery-dev.iam.gserviceaccount.com
bindings:
- members:
  - principalSet://.../workloadIdentityPools/github-actions/attribute.environment/development
  role: roles/iam.workloadIdentityUser
```

The trust chain is: GitHub's OIDC issuer → `repository == 't-boris/verdery'` →
`attribute.environment/development` → `verdery-dev-deployer`. The `environment: development`
declaration in `deploy-dev.yml` is **load-bearing** — without it GitHub issues no `environment`
claim and the binding denies every request. The binding is on the `environment` attribute rather
than an exact `subject` string precisely because GitHub's real `sub` claim embeds numeric owner and
repository ids that an exact-match condition did not anticipate: a real bug already found and fixed
here.

**What therefore can be compromised, in rough order of severity:**

| Credential                                                 | Compromise path                                             | Blast radius                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The **break-glass Postgres superuser password**            | Secret Manager read, or a copy taken during an attended run | Full database read/write, bypassing `verdery_application`'s least-privilege boundary |
| The **owner account** (`t.boris@gmail.com`, `roles/owner`) | Google account compromise                                   | Everything. There is no second owner and no separation of duties                     |
| **GitHub write access to `master`**                        | GitHub account or token compromise                          | Arbitrary code deployed by `deploy-dev.yml` as `verdery-dev-deployer`                |
| The **compute default SA** (`roles/editor`)                | Any workload able to impersonate it                         | Project-wide editor. Nothing currently runs as it, but the role is broad and unused  |
| A **user's Firebase session**                              | Token theft                                                 | That user's gardens only — see [RB-06](#rb-06-cross-garden-authorization-incident)   |

### The break-glass superuser, in detail

`infrastructure/gcloud/scripts/07-iam-database-bootstrap.sh` maintains a Postgres superuser
password in Secret Manager as `verdery-dev-pg-postgres-superuser-password`, labelled
`purpose=break-glass,used-by=none`. It is the only secret in the project
([§1.4](#14-identity-and-secrets)).

Two properties matter operationally:

- **The script rotates the password on every run** — `openssl rand -base64 24`, added as a new
  secret version, applied with `gcloud sql users set-password`. Re-running the script _is_ the
  rotation procedure; there is no separate rotate command to write.
- **It must be run attended, because it briefly gives Cloud SQL a public IP** restricted to the
  caller's own address (`--authorized-networks="${caller_ip}/32"`) for the few seconds the grant
  takes. That window is the most dangerous thing this repository does, and it is why the script is
  deliberately not part of `provision.sh`.

Because Cloud SQL is private-IP only (`ipv4Enabled: false`), this is also the **only** interactive
psql path an operator has from a workstation — which is why several SQL steps elsewhere in this
document are marked `U` with that blocker.

### Trigger and detection

No alerts exist. Detection is external (a leaked-credential report, GitHub secret scanning) or by
these standing audits:

```bash
# 1. Any user-managed key appearing at all — the loop above. Expect all zeros.

# 2. Unexpected IAM changes. Compare against the known-good set in §1.4.
gcloud projects get-iam-policy verdery-dev \
  --flatten='bindings[].members' --format='table(bindings.role,bindings.members)'

# 3. Who has read the break-glass secret.
gcloud logging read \
  'protoPayload.serviceName="secretmanager.googleapis.com"
   AND protoPayload.methodName:"AccessSecretVersion"' \
  --project=verdery-dev --limit=20 --freshness=7d \
  --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)'

# 4. Whether Cloud SQL has a public IP right now. It must not, outside a bootstrap run.
gcloud sql instances describe verdery-dev-pg --project=verdery-dev \
  --format='value(settings.ipConfiguration.ipv4Enabled,settings.ipConfiguration.authorizedNetworks)'
```

Query 4 is the highest-signal one-liner here: `False` with no authorized networks is correct.
Anything else means a bootstrap run is in progress, or the instance has been exposed.

Query 3 depends on Cloud Audit Logs for Secret Manager **data access**, which is off by default in
Google Cloud. Whether it is enabled for this project is itself an open question — see
[Gaps](#gaps-needing-an-owner-decision).

### Immediate assessment

1. **What identity, and what can it reach?** Map the credential to the table above. A leaked _user_
   session is [RB-06](#rb-06-cross-garden-authorization-incident), not this runbook.
2. **Was it used?** Admin Activity audit logs are always on, unlike data access:

   ```bash
   gcloud logging read 'protoPayload.authenticationInfo.principalEmail="<suspect>"' \
     --project=verdery-dev --limit=50 --freshness=2d \
     --format='value(timestamp,protoPayload.methodName,protoPayload.resourceName)'
   ```

3. **Is anything persistent?** New service accounts, new IAM bindings, new secret versions, new
   Cloud Run revisions. An attacker's most useful move here is deploying a revision, which is
   visible in `gcloud run revisions list`.

### Remediation options

All mutating; none exercised.

**Option A — rotate the break-glass password.** Re-run `07-iam-database-bootstrap.sh dev`.
Trade-offs: attended only; it briefly re-exposes the public IP, which is the very risk being
mitigated — do it from a trusted network and confirm withdrawal with detection query 4 afterwards.
Nothing in the running system uses this password, so rotation has no service impact.

**Option B — revoke the CI trust path.** The precise instrument is the service-account binding, not
the pool:

```bash
gcloud iam service-accounts remove-iam-policy-binding \
  verdery-dev-deployer@verdery-dev.iam.gserviceaccount.com --project=verdery-dev \
  --role=roles/iam.workloadIdentityUser \
  --member='principalSet://iam.googleapis.com/projects/417008876420/locations/global/workloadIdentityPools/github-actions/attribute.environment/development'
```

Trade-off: deployment stops immediately — including the deployment that would ship the fix.
Reversible by re-running `06-workload-identity-federation.sh`. Disabling the deployer service
account is the blunter alternative and also blocks a legitimate operator.

**Option C — disable a compromised service account.**
`gcloud iam service-accounts disable <email> --project=verdery-dev`. Trade-off: instantly breaks
whatever runs as it; for `verdery-dev-api-runtime` that is the entire API, making this an
availability decision as much as a security one.

**Option D — revoke user sessions.** Firebase-side; see
[RB-06](#rb-06-cross-garden-authorization-incident).

**Explicitly not available:** there is no service-account key to delete, because none exist. If
this runbook ever needs such a step, the deeper failure already happened when the key was created.

### Verification

- The key-audit loop returns `0` on every line.
- Project IAM policy matches the known-good set in [§1.4](#14-identity-and-secrets).
- Cloud SQL reports `ipv4Enabled: False` with no authorized networks.
- No unexpected Cloud Run revisions, cross-checked against `deploy-dev.yml` run history.
- A new secret version exists and the old one is disabled or destroyed.

### Follow-up

- **Preserve evidence before rotating.** Rotation destroys the timeline; export audit logs, the
  revision list, and secret version history first.
- If data-access audit logging was off, enabling it is the highest-value follow-up — without it,
  "was the secret read?" is unanswerable.
- Reliability-and-disaster-recovery.md §19 requires a **credential revocation exercise**. It has
  not been run; see the [exercise log](#exercise-log).

### Step disposition

| Step                                 | Mark | Note                                                                                      |
| ------------------------------------ | ---- | ----------------------------------------------------------------------------------------- |
| User-managed key audit               | `E`  | Full loop run live over all five service accounts; all zeros. 7.7 s.                      |
| WIF provider + deployer binding read | `E`  | Ran live; the trust chain quoted above is real output.                                    |
| Project IAM policy read              | `R`  | Ran live; produced the known-good baseline in §1.4.                                       |
| Cloud SQL public-IP check            | `R`  | Ran live; `ipv4Enabled: false`.                                                           |
| Secret-access audit query            | `U`  | Blocker: unverified whether data-access audit logs are enabled. Query bounded but unrun.  |
| Password rotation                    | `U`  | Blocker: mutating; attended-only; briefly exposes a public IP. Needs owner authorization. |
| CI trust revocation                  | `U`  | Blocker: mutating; halts all deployment.                                                  |
| Service-account disable              | `U`  | Blocker: mutating; an availability decision.                                              |

---

## RB-06: Cross-garden authorization incident

Covers reliability-and-disaster-recovery.md §18 "Cross-garden authorization incident".

This is the scenario where a user saw, or may have seen, data belonging to a garden they do not
have access to. It is a confidentiality incident, and the response order is deliberately different
from every other runbook here: **contain, then measure, then fix** — because the affected
population must be established before the evidence ages out of the retention window.

### The model being defended

Access is mediated by `collaboration.membership`:

```sql
CREATE TABLE collaboration.membership (
  id uuid PRIMARY KEY,
  garden_id  uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  profile_id uuid NOT NULL REFERENCES identity_access.profile (id),
  role  text NOT NULL,   -- 'owner' | 'editor' | 'viewer'
  state text NOT NULL,   -- 'active' | 'removed'
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT membership_garden_profile_key UNIQUE (garden_id, profile_id)
);
```

Two structural properties do real work during an incident:

- **Revocation is a state change, not a delete.** `state = 'removed'` preserves the row, so the
  record of who had access when survives the revocation. Never `DELETE` a membership during an
  incident — it destroys exactly the evidence needed to scope the exposure.
- **Ownership never moves through an invitation.** `collaboration.invitation` constrains
  `intended_role` to `('editor','viewer')`; ownership transfer has its own flow. So an incident in
  which someone unexpectedly became an _owner_ cannot have come from the invitation path, which
  narrows the investigation immediately.

Invitations carry a unique `token_hash` (hashed — never the opaque token) with states
`pending | accepted | revoked | expired` and an `expires_at`. A leaked invitation link is contained
by moving it to `revoked`.

The audit trail is `platform.audit_event`:

```sql
CREATE TABLE platform.audit_event (
  id uuid PRIMARY KEY,
  event_type       text NOT NULL,
  subject_type     text NOT NULL,
  subject_id       uuid NOT NULL,
  actor_profile_id uuid REFERENCES identity_access.profile (id),
  actor_type       text NOT NULL,  -- 'user' | 'system' | 'administrator'
  details          jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_subject_idx
  ON platform.audit_event (subject_type, subject_id, occurred_at DESC);
```

Observability-and-analytics.md §16 requires these records to be durable and unsampled, and distinct
from diagnostic logs: "An audit event must not rely solely on a sampled operational log." That
index — subject first, newest first — is built for exactly the question this runbook asks:
_everything that ever touched this garden._

### Trigger and detection

No alerts exist. Observability-and-analytics.md §15 names "Authentication or authorization anomaly"
as the alert that should.

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-api-dev"
   AND jsonPayload.res.statusCode=(403 OR 404)' \
  --project=verdery-dev --limit=50 --freshness=6h \
  --format='value(timestamp,jsonPayload.reqId,jsonPayload.res.statusCode)'
```

A caution that matters: this API deliberately returns **404 rather than 403** for resources the
caller cannot see, so as not to confirm existence. That is correct security behavior, and it makes
403-counting an incomplete signal — a cross-garden probe looks like ordinary 404 noise. Correlate
by actor and target id, not by status code alone.

### Immediate assessment

1. **Did access actually occur, or was it only possible?** These lead to very different responses.
   `platform.audit_event` filtered by `subject_type='garden'` and the garden id, ordered by
   `occurred_at DESC`, is the authoritative answer.
2. **Scope the exposure.** `jsonPayload.reqId` and `jsonPayload.traceId` join a log line to a
   request; the `correlationId` from the API's error envelope
   ([§1.8](#18-health-endpoints)) is the value a reporting user can supply.
3. **Establish the mechanism.** Three plausible ones, distinguishable from data:
   - A **membership that should not exist** — query `collaboration.membership` for the garden.
   - A **stale membership**: `state='removed'` but access still worked, meaning a cached or
     token-embedded capability outlived the revocation. Check `revision`.
   - A **missing authorization check** in a code path — the most serious, because it is not
     user-specific and its blast radius is every request to that route.
4. **Preserve evidence first.** Export the relevant `platform.audit_event` rows and log entries
   _before_ remediating.

### Remediation options

**Option A — revoke the specific membership.** Set `state = 'removed'` through the application's own
membership-removal path, never by hand-editing the row: the application path writes the
`platform.audit_event` record and bumps `revision`. A hand-edit produces a revocation with no audit
trail — precisely what makes the _next_ incident unanswerable. Trade-off: none; this is the
intended mechanism.

**Option B — revoke the user's sessions.** Firebase-side. Necessary whenever a capability could be
cached in a live session: a membership change that does not invalidate an existing session leaves a
window open. Trade-off: the user is signed out everywhere, including on devices holding pending
offline work. Reliability-and-disaster-recovery.md §13 is the mitigating property — native local
changes and the outbox commit atomically, so pending work survives a forced sign-out — but it is a
visible disruption.

**Option C — revoke outstanding invitations.** Move `pending` invitations for the affected garden to
`revoked`. Cheap, and the right reflex whenever a share link may have leaked.

**Option D — disable the affected route.** For a confirmed missing-authorization defect,
containment is at the deployment layer: roll back to a revision predating the defect
([RB-01](#rb-01-bad-deployment-rollback)). Trade-off: loses every other change in that release. It
is still usually right — a confidentiality defect outranks a feature.

**Do not** "fix" a capability incident by narrowing the data in a response while leaving the
authorization check absent. The check is the control.

### Verification

- The revoked principal receives 404 on the affected resources (not 403 — see above).
- `collaboration.membership` shows `state='removed'` with a bumped `revision`, and a matching
  `platform.audit_event` row exists with the correct `actor_profile_id` and `actor_type`.
- No further access appears in the audit trail after the revocation timestamp.
- For a code defect: a regression test exists that fails against the vulnerable revision.

### Follow-up

- Notification obligations are a policy question, not an engineering one. Route to the owner with
  the scoped population from step 2.
- A cross-garden defect is the strongest possible argument for route-level authorization test
  coverage that a future refactor cannot silently remove.
- Audit retention (§17) must exceed the time it takes to notice an incident. If the investigation
  reached the edge of the retention window, that is itself the finding.

### Step disposition

| Step                                 | Mark | Note                                                                                                     |
| ------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------- |
| Schema / model facts                 | `R`  | Read from the live migration files, not from prose.                                                      |
| 403/404 detection query              | `R`  | Ran live against the API log stream, bounded.                                                            |
| `platform.audit_event` investigation | `U`  | Blocker: no operator SQL path (Cloud SQL private-IP only), and no real membership data in `verdery-dev`. |
| Membership revocation                | `U`  | Blocker: mutating; requires a real incident and owner authorization.                                     |
| Session revocation                   | `U`  | Blocker: mutating; Firebase-side.                                                                        |
| Route disable / rollback             | `U`  | Blocker: shares [RB-01](#rb-01-bad-deployment-rollback)'s traffic-switch blocker.                        |

---

## RB-07: Deletion failure

Covers reliability-and-disaster-recovery.md §18 "Media deletion/reconciliation failure", §9 ("Media
Durability"), and the account/garden purge contract in
[../architecture/data-export-and-deletion.md](../architecture/data-export-and-deletion.md).

Deletion is the one scenario where **doing nothing has a compliance cost**. Every other runbook can
end in "wait for it to drain"; this one cannot, because a user was told their data would be removed.

The purge workflow itself is `P8-DELETE-01`, landing concurrently. Its schema is already in the
repository (`services/api/migrations/1786400000000_deletion-baseline.sql`). The steps below stay at
the operational level — states, evidence, and decisions — so they survive that work package's
landing.

### The state machine, and the deliberate hole in it

```sql
CREATE TABLE deletion.deletion_record (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL,   -- 'garden' | 'account'
  subject_id   uuid NOT NULL,
  state        text NOT NULL,   -- 'purging' | 'purged'   <-- note what is missing
  requested_at            timestamptz NOT NULL,
  recovery_deadline_at    timestamptz NOT NULL,
  purge_started_at        timestamptz NOT NULL,
  completed_at            timestamptz,
  attempt_count           integer NOT NULL DEFAULT 0,
  deferred_reason         text,
  media_records_scheduled integer NOT NULL DEFAULT 0,
  identity_provider_deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1
);
```

**There is no `failed` state, by design.** The migration says so in its own words: a purge that
cannot finish stays `purging` and retries — "Terminal failure is a runbook concern, not a state that
would silently stop the sweep from trying again."

That sentence is this runbook's charter. The schema deliberately refuses to represent give-up, which
means **the only way a stuck purge is ever noticed is a human running the query below.** There is no
alert, and there is no state to alert on.

Progress is checkpointed per step:

```sql
CREATE TABLE deletion.purge_checkpoint (
  deletion_id uuid NOT NULL REFERENCES deletion.deletion_record (id) ON DELETE CASCADE,
  step_name    text NOT NULL,
  rows_deleted bigint NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (deletion_id, step_name)
);
```

A purge interrupted mid-way therefore resumes rather than restarting — the same checkpointing shape
the export job (`exports.export_section_checkpoint`) uses. `attempt_count` and `deferred_reason` on
the parent row are the honest record of how many passes it took and why the last one stopped.

The garden side carries its own recovery window: `gardens_mapping.garden.recovery_deadline_at`, with
`lifecycle_state = 'deletion_requested'` and a 30-day window (the migration backfills
`deletion_requested_at + interval '30 days'` for records predating the column). There is no `deleted`
lifecycle value — the purge removes the row, which makes the point of no return
unrepresentable-as-recoverable rather than merely unchecked.

### Trigger and detection

No alert exists; observability-and-analytics.md §15 names "Raw media deletion lag" as the alert that
should. Detection is by query.

**Stuck purges** — the query with no substitute:

```sql
SELECT subject_type, id, subject_id, attempt_count, deferred_reason,
       media_records_scheduled,
       now() - purge_started_at AS stuck_for,
       recovery_deadline_at
  FROM deletion.deletion_record
 WHERE state = 'purging'
   AND purge_started_at < now() - interval '24 hours'
 ORDER BY purge_started_at;
```

`deferred_reason` is the first thing to read: it distinguishes a purge waiting on media byte deletion
(normal, self-healing) from one blocked on something that will never resolve.

**Media stock still scheduled for deletion:**

```sql
SELECT media_class, count(*), min(updated_at) AS oldest
  FROM media.media_record
 WHERE upload_state = 'deletion_scheduled'
 GROUP BY media_class ORDER BY oldest;
```

Anything older than one hour has outlived the entire Cloud Tasks retry budget — see
[RB-03](#rb-03-queue-backlog-and-dead-letter). The `upload_state` set is `registered`, `authorized`,
`uploading`, `verifying`, `rejected`, `available`, `deletion_scheduled`, `deleted`.

**Accounts whose identity was not removed:**

```sql
SELECT id, subject_id, completed_at
  FROM deletion.deletion_record
 WHERE subject_type = 'account' AND state = 'purged'
   AND identity_provider_deleted_at IS NULL;
```

Rows here mean application data is gone but the Firebase identity survives — a real, user-visible
inconsistency: the user can still sign in, to an empty account.

### Immediate assessment

1. **Which stage stalled?** `deletion.purge_checkpoint` for the `deletion_id` shows exactly which
   `step_name` values completed and which never did. That is the difference between "nothing
   happened" and "eleven of twelve steps completed".
2. **Is the recovery deadline in the past?** `recovery_deadline_at` versus `now()`. A purge stalled
   before its deadline is not yet a compliance problem; one stalled after it is.
3. **Bytes or rows?** `media_records_scheduled > 0` with a `deferred_reason` naming media means the
   blockage is in the media pipeline, and the response is
   [RB-03](#rb-03-queue-backlog-and-dead-letter)'s re-drive, not anything deletion-specific.
4. **Is the sweep running at all?** Today it is not: `verdery-workers-dev` is undeployed
   ([§1.1](#11-compute)), so **every** purge in `verdery-dev` would stall at the first pass. That is
   the expected finding here, and it is not a defect in the deletion workflow.

### Remediation options

**Option A — restore the sweep.** If the purge stalled because nothing is running it, deploy the
worker. Checkpoints mean the purge resumes where it stopped and `attempt_count` increments. No
data-repair action is needed or appropriate. This is the correct response to today's state.

**Option B — re-drive the media deletion.** For a purge deferred on media bytes, re-emit the
`media.deletion_requested` outbox event exactly as
[RB-03 Option C](#rb-03-queue-backlog-and-dead-letter) describes. Safe because the deletion path is
idempotent end to end. Trade-off: a hand-written row in a production table; review it with a second
person.

**Option C — complete the identity-provider deletion.** For the `identity_provider_deleted_at IS
NULL` case, delete the Firebase user through the identity-provider path, then record the timestamp
through the application. Trade-off: irreversible. Confirm the application preconditions actually
held — the ordering (application data first, identity second) is deliberate, and reversing it
strands data whose owner can no longer be resolved.

**Never** mark a purge `purged`, or a media record `deleted`, by hand. Both are **assertions that
bytes are gone**, and writing them without verification converts an operational problem into a false
compliance statement. This is the hardest rule in this document.

### Verification

- `deletion.deletion_record` reaches `state = 'purged'` with a non-null `completed_at` (enforced by
  `deletion_record_completed_fields_check`).
- Every expected `step_name` has a `deletion.purge_checkpoint` row.
- No `media.media_record` for the subject remains in `deletion_scheduled`.
- For accounts: `identity_provider_deleted_at` is set.
- Corresponding `media.deletion_requested` / `media.deleted` entries exist in
  `platform.audit_event` — §16 requires deletion to be audited, and that trail is what a future
  question about this purge will be answered from.

### Follow-up

- Reliability-and-disaster-recovery.md §19 requires an **account deletion verification** exercise. It
  has not been run; see the [exercise log](#exercise-log).
- A purge that stalled for a reason the schema cannot express is evidence for extending the
  `deferred_reason` vocabulary, not for adding a `failed` state — the no-give-up property is
  deliberate and worth keeping.
- §9's precedence rule governs any conflict with recovery: "User-requested permanent deletion takes
  precedence over operational recovery after the communicated recovery window." Note the interaction
  with bucket **soft delete** (7 days, [§1.3](#13-storage)) and Cloud SQL **PITR** (7 days,
  [§1.2](#12-database)): both retain deleted data past the deletion event. Neither is wrong, but a
  deletion promise measured in "immediately" would be false while they are set.

### Step disposition

| Step                            | Mark | Note                                                                                                  |
| ------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| Deletion schema / state machine | `R`  | Read from the landed migration; the "no `failed` state" property is quoted from its own comment.      |
| Worker-presence assessment      | `R`  | Ran live; the sweep cannot be running.                                                                |
| Stuck-purge / media-stock SQL   | `U`  | Blocker: no operator SQL path (Cloud SQL private-IP only), and no purge data exists in `verdery-dev`. |
| Sweep restore                   | `U`  | Blocker: `deploy-workers.sh` has three unmet prerequisites — see [§1.1](#11-compute).                 |
| Media re-drive                  | `U`  | Blocker: inherits [RB-03](#rb-03-queue-backlog-and-dead-letter)'s.                                    |
| Identity-provider completion    | `U`  | Blocker: mutating and irreversible; needs a real subject and owner authorization.                     |

---

## RB-08: Cost anomaly

Covers reliability-and-disaster-recovery.md §18 "Cost anomaly" and §17 ("Capacity Reliability"), plus
[../architecture/cost-and-scaling.md](../architecture/cost-and-scaling.md).

### The finding: there is no budget, and there cannot be one right now

```
$ gcloud billing budgets list --billing-account=011376-3DA0B7-CA8AC5
ERROR: Cloud Billing Budget API has not been used in project verdery-dev before or it is disabled.
```

`billingbudgets.googleapis.com` is **not enabled**
([§1.6](#16-enabled-apis-and-what-their-absence-means)). No budget exists, no budget alert exists,
and none can be created until the API is enabled. Combined with the absence of any alert policy or
notification channel ([§1.5](#15-observability)), the honest statement is: **cost anomalies in this
project are detected by a human looking at the billing console, or by the monthly bill.**

Observability-and-analytics.md §15 names "Budget anomaly" as a required alert. It does not exist.

### What is actually bounded, and what is not

The application layer has real, reviewed ceilings — these are the controls that would blunt a cost
incident before billing ever noticed:

| Control                                   | Value                                               | Bounds                                                       |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Cloud Run `--max-instances`               | `2` on both `verdery-api-dev` and `verdery-web-dev` | Total compute. The hardest ceiling in the system             |
| Cloud Run `--min-instances`               | `0`                                                 | Idle cost is zero                                            |
| `HTTP_BODY_LIMIT_BYTES`                   | `1048576` (1 MiB)                                   | Request payload size                                         |
| `DATABASE_POOL_MAX_CONNECTIONS`           | `10`                                                | Cloud SQL connections per instance                           |
| `RECOMMENDATION_AI_MAX_CALLS_PER_HOUR`    | `50`                                                | Vertex AI spend per hour                                     |
| `RECOMMENDATION_AI_MAX_CALLS_PER_DAY`     | `500`                                               | Vertex AI spend per day                                      |
| `RECOMMENDATION_AI_MAX_OUTPUT_TOKENS`     | `512`                                               | Cost per call — calls × bounded tokens is the ceiling        |
| `RECOMMENDATION_AI_CALL_TIMEOUT_MS`       | `10000`                                             | A hung provider call cannot hold a sweep open                |
| Cloud Tasks `--max-dispatches-per-second` | `10`                                                | Worker invocation rate (queue not yet created)               |
| `media.quota_reservation`                 | table                                               | Per-subject media storage, reserved before upload            |
| `integrations.provider_quota_usage`       | table                                               | Provider call budget; surfaces as `stoppedOnQuotaExhaustion` |
| Bucket soft delete                        | 7 days on all four buckets                          | _Increases_ cost — deleted bytes are billed for 7 more days  |
| Cloud SQL `storageAutoResize`             | `true`, from 10 GB                                  | **Unbounded upward.** No maximum is configured               |

Two entries cut the other way and deserve emphasis.

**`storageAutoResize: true` with no maximum** is the one genuinely unbounded cost vector in the data
tier. Reliability-and-disaster-recovery.md §6 asks for "Storage auto-growth with alerting and
maximum-cost review"; the auto-growth is on, and the alerting and the cap are not.

**Both Cloud Run services are open to the internet.** Verified live:

```
$ gcloud run services get-iam-policy verdery-api-dev --region=us-central1 --project=verdery-dev
ROLE               MEMBERS
roles/run.invoker  allUsers

$ gcloud run services get-iam-policy verdery-web-dev --region=us-central1 --project=verdery-dev
ROLE               MEMBERS
roles/run.invoker  allUsers
```

`deploy-api.sh` logs its own warning about this: "`--allow-unauthenticated` is a deliberate
development-only choice — this service currently exposes nothing but health checks. Revisit before
any endpoint carries real data (P8-SEC-02)." That note is **now out of date** — the service carries
real endpoints. Anyone on the internet can drive traffic to both services, and the only thing between
them and unbounded compute spend is `--max-instances=2`. That ceiling is doing more work than it was
designed to do.

### Trigger and detection

- **Billing console.** The only real detection today; reviewing it is a manual recurring task, not an
  alert.
- **Traffic surge**, a leading indicator that precedes the bill by days:

  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="verdery-api-dev"
     AND logName:"requests"' \
    --project=verdery-dev --limit=100 --freshness=1h \
    --format='value(httpRequest.requestUrl,httpRequest.status,httpRequest.remoteIp)'
  ```

  A single `remoteIp` dominating, or a flat unauthenticated path being hammered, is the shape.

- **Database storage growth:**

  ```bash
  gcloud sql instances describe verdery-dev-pg --project=verdery-dev \
    --format='value(settings.dataDiskSizeGb,settings.storageAutoResize,settings.storageAutoResizeLimit)'
  ```

  Currently `10  True` with no limit. A rising first number with no third is the warning.

- **Bucket growth:** `gcloud storage du gs://verdery-dev-user-media --summarize`. Soft delete means
  deleted objects keep billing for 7 days, so a spike can outlive its cause.

- **Provider quota exhaustion:** `stoppedOnQuotaExhaustion: true` on
  `weather.refresh_sweep_completed` is the quota machinery working — a cost control _succeeding_, not
  an incident. Do not "fix" it by raising the budget reflexively.

### Immediate assessment

1. **Which service?** Billing console breakdown, or the traffic query above.
2. **Legitimate or abusive?** Real user growth, a runaway retry loop, or an unauthenticated endpoint
   being scraped. The third is what this project is currently most exposed to.
3. **Is a ceiling being hit?** A ceiling that is being hit is doing its job. `max-instances=2` means
   cost is capped even under attack — the symptom will be latency and 429/503s, not a large bill.
   That is the correct trade, and worth confirming before treating it as an incident.

### Remediation options

**Option A — lower `--max-instances`.** The fastest, bluntest lever:
`gcloud run services update verdery-api-dev --max-instances=1 --region=us-central1 --project=verdery-dev`.
Trade-off: directly trades availability for cost; at `1` the service is one cold start away from
queuing. Reversible in seconds.

**Option B — remove public invoker access.**
`gcloud run services remove-iam-policy-binding verdery-api-dev --member=allUsers --role=roles/run.invoker`.
Trade-off: takes the product offline for every user — the emergency brake, appropriate for confirmed
abuse and nothing less. Note that the web client proxies `/v1` to the API, so removing the API's
public access **also** breaks the web client's data path even though the web service stays reachable.

**Option C — flip the AI kill-switch off.** Removes the highest per-call cost immediately. Same
mechanics and the same redeploy caveat as [RB-04](#rb-04-provider-outage) Option B.

**Option D — enable budgets and set one.** Not remediation but the durable fix:
`gcloud services enable billingbudgets.googleapis.com --project=verdery-dev`, then create a budget
with threshold rules and a notification channel. Trade-off: none worth mentioning. **This is the
single highest-value cost action available, and it needs an owner decision** — see
[Gaps](#gaps-needing-an-owner-decision).

**Do not** raise a provider quota or a batch limit to make a symptom go away. Those numbers are
reviewed constants with documented reasoning.

### Verification

- Spend rate returns to the expected band in the billing console.
- Instance count and request rate fall.
- Whatever ceiling was lowered is deliberately restored afterwards, with a note on why that was safe.

### Follow-up

- The `--allow-unauthenticated` posture and its now-stale justification in `deploy-api.sh` need an
  owner decision. See [Gaps](#gaps-needing-an-owner-decision).
- A `storageAutoResizeLimit` should exist. Auto-growth without a cap is an unbounded liability.
- Budget alerts remain absent until Option D is taken.

### Step disposition

| Step                            | Mark | Note                                                                                    |
| ------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| Budget existence check          | `E`  | Ran live; the `SERVICE_DISABLED` error **is** the finding.                              |
| Public-invoker exposure check   | `E`  | Ran live on both services; `allUsers` holds `roles/run.invoker` on each.                |
| Ceiling inventory               | `R`  | Read from live service config, deploy scripts, and `configuration-schema.ts`.           |
| Storage auto-resize limit check | `R`  | Ran live; auto-resize on, no limit set.                                                 |
| Traffic-surge query             | `R`  | Ran live against the `requests` log, bounded.                                           |
| Max-instances / invoker changes | `U`  | Blocker: mutating; availability-affecting. Needs owner authorization.                   |
| Budget creation                 | `U`  | Blocker: requires enabling `billingbudgets.googleapis.com` — a mutating project change. |

---

## RB-09: Regional recovery

Covers reliability-and-disaster-recovery.md §18 "Regional recovery" and §14 ("Regional Disaster
Strategy"), under
[ADR-0007](../architecture/decisions/ADR-0007-us-central1-production-baseline.md).

### The honest RTO/RPO story

Everything is in `us-central1`, and one thing is narrower still. Read live:

| Resource                                          | Placement                               |
| ------------------------------------------------- | --------------------------------------- |
| `verdery-api-dev`, `verdery-web-dev`, migrate job | `us-central1`                           |
| `verdery-dev-pg`                                  | `us-central1`, **zone `us-central1-a`** |
| All four buckets                                  | `US-CENTRAL1` (single-region)           |
| Artifact Registry `verdery`                       | `us-central1`                           |
| VPC `verdery-dev-network` / subnet                | `us-central1`                           |

There are therefore **two** distinct disaster scopes, and conflating them is the most likely operator
error.

**Zone failure (`us-central1-a`).** Cloud Run is regional and survives; buckets are regional and
survive. **The database does not** — `availabilityType: ZONAL` with no `secondaryGceZone` means a
zone loss is a database outage recovered by restore, not by failover.
Reliability-and-disaster-recovery.md §6 requires regional HA precisely to make this a non-event, and
it is not configured. This is the most likely real disaster and the one with the largest gap between
design and reality.

**Region failure (`us-central1`).** Everything is gone at once: compute, database, media, images,
network.

Against the §3 targets:

| Target                         | Stated                | Honest assessment today                                                                                                                                                    |
| ------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core domain DB **RPO**         | ≤ 5 minutes           | **Plausible but unproven.** PITR is enabled with 7-day log retention, which supports it in principle. Never tested. §7: backups are not valid until restoration is tested. |
| Core service **RTO**           | ≤ 1 hour              | **Plausible for compute alone.** Scripts are parameterized by `<environment>.env`, so re-provisioning is scripted. Unproven end to end.                                    |
| Full regional disaster **RTO** | ≤ 4 hours best effort | **Not credible today.** No alternate region is chosen, no target project exists, no restore has been timed, and Cloud SQL cross-region restore duration is unknown.        |
| Rebuildable derivatives        | longer                | Consistent — derived media regenerates from originals.                                                                                                                     |
| Pending offline device work    | protected locally     | Holds by design (§13); native local changes and the outbox commit atomically.                                                                                              |

**Media has no cross-region story at all.** All four buckets are single-region with versioning off.
If `us-central1` is lost, user media is unavailable for the duration and, in a true regional data
loss, gone. §14 defers this explicitly ("Cross-region media replication is considered separately
based on storage class, cost, deletion, and regional requirements"), and it remains deferred. An
operator should know that the database can be recovered elsewhere and the photos cannot.

### Trigger and detection

Google Cloud status dashboard, plus:

```bash
gcloud run services list --project=verdery-dev --region=us-central1
gcloud sql instances describe verdery-dev-pg --project=verdery-dev --format='value(state)'
curl -sf https://verdery-api-dev-t6amsr5o6a-uc.a.run.app/v1/health/ready
```

A regional outage is not subtle. The judgment call is **zone versus region**, and the readiness probe
answers it faster than anything else: if the API answers `/v1/health/live` but `/v1/health/ready`
reports the database dependency unavailable, that is a **zone/database** event, not a regional one —
and the response is [RB-02](#rb-02-database-restore), not this runbook.

### The procedure

This is §14's nine steps made concrete for this repository. **None of it has been executed**; it is a
tabletop procedure, which is exactly what §19 asks for ("Tabletop regional disaster exercise").

1. **Declare, and freeze risky writes.** With no production traffic, this is a decision to record
   rather than a control to actuate.
2. **Select an approved alternate US region.** _No alternate region has been chosen._ ADR-0007 names
   only the `us-central1` baseline. **This is a prerequisite decision, not a step**, and its absence
   is what makes the 4-hour RTO not credible.
3. **Apply the recovery configuration through the approved scripts.** The mechanism genuinely exists
   and is the strongest part of this story. `lib/common.sh`'s `load_environment_config` reads
   `infrastructure/gcloud/config/<environment>.env`, and every script derives every name and region
   from it — `VERDERY_REGION`, network, subnet, buckets, service names. So regional recovery is: copy
   `dev.env` to `dr.env`, change `VERDERY_REGION` and the project/bucket names, run `provision.sh`.
   ADR-0011 chose scripts over Terraform, and this is where that choice pays. `require_active_project`
   guards against pointing a run at the wrong project.
4. **Restore Cloud SQL into the target.** [RB-02](#rb-02-database-restore) Option A, cross-region.
   Unproven, and its duration is the dominant unknown in the whole RTO.
5. **Recreate Cloud Run, jobs, queues, secrets access, and networking.** `provision.sh` plus
   `deploy-api.sh` / `deploy-web.sh` / `deploy-migration-job.sh`. **The container images live in
   `us-central1` Artifact Registry** and would need to be rebuilt or copied — a step easy to forget,
   because every script takes the image as a given. `07-iam-database-bootstrap.sh` must be re-run
   attended against the new instance.
6. **Validate storage availability and processing references.** Media does not move (see above). This
   step is honestly "confirm what is missing", not "confirm what recovered".
7. **Run data integrity and smoke tests.** [RB-02](#rb-02-database-restore)'s post-restore checklist,
   then `/v1/health/ready`.
8. **Shift API DNS/load-balancer routing.** There is **no DNS and no load balancer** — clients use the
   generated `*.run.app` URLs, and the web client's API origin is **baked into its image at build
   time** (`API_PROXY_ORIGIN`, an `apps/web/Dockerfile` build arg). So "shift routing" today means
   **rebuild and redeploy the web image** against the new API origin. `P8-NET-01` (load balancer and
   custom domain) is unbuilt; until it lands, every regional recovery includes a web rebuild on the
   critical path.
9. **Monitor sync replay, idempotency, and provider configuration.** Duplicate-safety is a design
   property (§11) that has never been exercised under replay.

### Verification

- `/v1/health/ready` green in the new region with the database dependency available.
- Migration state matches the deployed image ([RB-02](#rb-02-database-restore)'s `pgmigrations`
  check).
- The web client reaches the new API origin — verify sign-in, not just a page load, because the
  same-origin `/v1` proxy is what makes session cookies work at all.
- Record actual RTO and RPO. That number is the deliverable.

### Follow-up

- Choosing the alternate region is the blocking prerequisite. See
  [Gaps](#gaps-needing-an-owner-decision).
- Regional HA on Cloud SQL removes the far more likely zone-failure scenario entirely, and is a
  smaller decision than regional DR.
- `P8-NET-01` removes the web-rebuild step from the critical path by putting a real hostname in front
  of the API.

### Step disposition

| Step                                    | Mark | Note                                                                                                  |
| --------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| Regional placement inventory            | `R`  | Ran live across Cloud Run, Cloud SQL, buckets, and network.                                           |
| Zone-versus-region triage via readiness | `E`  | The readiness probe was curled live; its dependency list is what makes the triage possible.           |
| Script parameterization review          | `R`  | Verified `load_environment_config` derives every region-bearing name from `<environment>.env`.        |
| Alternate-region selection              | `U`  | **Blocker: no alternate region has been chosen. This is an owner decision, not an engineering task.** |
| Cross-region provision + restore        | `U`  | Blocker: no second project exists; `P8-NET-01`/`P8-DB-01` unbuilt; cost-bearing.                      |
| Routing shift                           | `U`  | Blocker: no DNS or load balancer exists (`P8-NET-01` unbuilt).                                        |
| Tabletop exercise                       | `U`  | Blocker: needs the owner in the room. The procedure above is the agenda.                              |

---

## Exercise log

All exercises were performed on **July 25, 2026**, between **21:19 UTC and 21:40 UTC**, against the
live `verdery-dev` project as `t.boris@gmail.com`, using Google Cloud SDK 552.0.0. Elapsed times are
wall-clock, measured per command. **No mutating command was run at any point.**

"Exercised" below means the command was executed and its output was compared against what the runbook
claims. Where the output contradicted an assumption, the runbook was rewritten to match the output —
that happened four times, and each is noted.

| #   | Scenario                               | What was exercised                                                                                     | How                                                                                       | Elapsed         | Outcome                                                                                                                                                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ground truth — compute                 | Service and job inventory                                                                              | `gcloud run services list`, `gcloud run jobs list`                                        | 2.0 s           | **Pass, with a finding.** `verdery-workers-dev` does not exist. Rewrote RB-03/04/07 around it.                                                             |
| 2   | RB-01 rollback — current traffic       | Identify the serving revision                                                                          | `gcloud run services describe --format='value(status.traffic…)'`                          | 1.4 s           | Pass. `verdery-api-dev-00145-x7n 100`.                                                                                                                     |
| 3   | RB-01 rollback — candidate listing     | Enumerate ready rollback candidates with image digests                                                 | `gcloud run revisions list --limit=5`                                                     | 1.1 s           | Pass.                                                                                                                                                      |
| 4   | RB-01 rollback — **target selection**  | Full derivation of the correct rollback target, skipping the same-digest pair-twin                     | Composite: describe service → describe revision → list revisions → `awk` on digest change | 4.9 s           | **Pass, with the document's most useful finding.** Returned `target=…-00143-b6f`, correctly skipping `…-00144-6rc`. Deploys create revisions in **pairs**. |
| 5   | RB-01 rollback — config-drift check    | Env-var name diff between current and rollback target                                                  | `diff <(…describe 00143…) <(…describe 00141…)`                                            | 1.8 s           | Pass. Empty diff — the rollback is configuration-safe.                                                                                                     |
| 6   | RB-01 — migration down path            | Confirm a down-migration is actually invocable                                                         | Read `migrate.ts` `resolveDirection`; `gcloud run jobs execute --help`                    | 0.9 s           | Pass. `--args` override exists; direction defaults to `up`. Command documented, **not run**.                                                               |
| 7   | RB-01/02/04/09 — health verification   | Both health endpoints, live                                                                            | `curl /v1/health/live`, `curl /v1/health/ready`                                           | 0.21 s / 0.35 s | **Pass, with a finding.** Paths are under `/v1`; `/health/ready` 404s. Readiness lists only `database`, proving providers are not readiness-gating.        |
| 8   | RB-02 restore — backup inventory       | What backups exist, and whether any failed                                                             | `gcloud sql backups list --limit=10`                                                      | 2.3 s           | **Pass, contradicting the brief's expectation.** Four `SUCCESSFUL` backups, none in error. Backups are **not** missing.                                    |
| 9   | RB-02 restore — recoverability posture | Backup config, PITR, HA, deletion protection                                                           | `gcloud sql instances describe --format='yaml(settings.backupConfiguration,…)'`           | 1.8 s           | **Pass, with three findings.** PITR on, 7-day logs, 7 retained backups; but `ZONAL`, no standby zone, `deletionProtectionEnabled: false`.                  |
| 10  | RB-03 queue — queue existence          | Whether the media-processing queue exists                                                              | `gcloud tasks queues list --location=us-central1`                                         | 1.0 s           | **Pass, with a finding.** `PERMISSION_DENIED` / `SERVICE_DISABLED` — the Cloud Tasks API is not enabled. No queue exists.                                  |
| 11  | RB-03 queue — schema reality           | Whether the outbox has a terminal/dead state                                                           | Read `platform.outbox_event` DDL from the landed migration                                | —               | **Pass, with a finding.** No `next_attempt_at`, no failure state, no max attempts. A poisoned event retries forever; nothing is ever lost.                 |
| 12  | RB-04 providers — reachability         | Whether Vertex AI is even reachable                                                                    | `gcloud services list --enabled`                                                          | 1.1 s           | Pass. `aiplatform` absent, consistent with the kill-switch default of `false`.                                                                             |
| 13  | RB-05 credentials — **key audit**      | Whether any downloadable service-account key exists, on any account                                    | Loop over all 5 SAs with `keys list --managed-by=user`                                    | 7.7 s           | **Pass.** Zero on every account. The keyless posture is real, not aspirational.                                                                            |
| 14  | RB-05 credentials — CI trust chain     | The exact federation binding CI authenticates through                                                  | `workload-identity-pools providers describe`; `service-accounts get-iam-policy`           | 1.4 s           | Pass. `repository == 't-boris/verdery'` → `attribute.environment/development` → deployer.                                                                  |
| 15  | RB-05 credentials — exposure check     | Whether Cloud SQL currently has a public IP                                                            | `gcloud sql instances describe --format='value(settings.ipConfiguration…)'`               | 0.9 s           | Pass. `ipv4Enabled: false`, no authorized networks.                                                                                                        |
| 16  | RB-05/06 — project IAM baseline        | Full project IAM binding inventory                                                                     | `gcloud projects get-iam-policy --flatten`                                                | 0.8 s           | **Pass, with a finding.** `verdery-dev-web-runtime` holds zero project bindings (correct); compute default holds `roles/editor` (broad, unused).           |
| 17  | RB-08 cost — budget existence          | Whether any budget or budget alert exists                                                              | `gcloud billing budgets list`                                                             | 0.7 s           | **Pass, with a finding.** `billingbudgets.googleapis.com` not enabled. No budget can exist.                                                                |
| 18  | RB-08 cost — public exposure           | Whether the services are internet-reachable                                                            | `gcloud run services get-iam-policy` on both                                              | 2.5 s           | **Pass, with a finding.** `allUsers` holds `roles/run.invoker` on **both** services.                                                                       |
| 19  | Detection layer — alerting reality     | Whether any alert, channel, or log metric exists                                                       | `monitoring policies list`, `monitoring channels list`, `logging metrics list`            | 2.5 s           | **Pass, with the finding that reshaped every runbook.** All three empty. No runbook may begin "when the alert fires."                                      |
| 20  | Detection layer — log field shapes     | The real `jsonPayload` field names an operator must filter on                                          | `gcloud logging read --limit=2 --freshness=2h --format=json`                              | 2.7 s           | Pass. Produced the field table in [§1.7](#17-log-shape).                                                                                                   |
| 21  | Detection layer — severity mapping     | Whether pino `level` actually maps to Cloud Logging `severity` (severity-based alerting depends on it) | `logging read 'severity>=WARNING'` cross-checked against `jsonPayload.level`              | 2.0 s           | **Pass.** Mapping is correct. Also surfaced two real historical errors, including `The database is unavailable; refusing to start`.                        |
| 22  | Storage posture                        | Versioning, soft delete, lifecycle rules across all four buckets                                       | `gcloud storage buckets list --format='table(…)'`                                         | 1.2 s           | **Pass, with a finding.** Versioning off everywhere; soft delete 7 days everywhere (the untouched default).                                                |
| 23  | Secrets and identities                 | Secret and service-account inventory                                                                   | `gcloud secrets list`, `gcloud iam service-accounts list`                                 | 3.2 s           | **Pass, with a finding.** Only the break-glass secret exists. `verdery-dev-worker` SA and its DATABASE_URL secret do not.                                  |

**Total measured command time: roughly 47 seconds** across 23 exercises. That number is worth stating
plainly: establishing this project's entire operational ground truth costs under a minute of API
calls. The reason it had not been written down before is not cost.

### What was NOT exercised, and the precise blocker for each

Grouped by blocker, because the blockers — not the scenarios — are what an owner decides about.

**Blocker A — mutating action requiring owner authorization.** The commands are written, verified
for syntax and flag existence, and deliberately not run.

| Unexercised step                                           | Runbook |
| ---------------------------------------------------------- | ------- |
| `gcloud run services update-traffic` (revision rollback)   | RB-01   |
| `migrate … down` via `jobs execute --args`                 | RB-01   |
| `gcloud sql instances clone` / `backups restore`           | RB-02   |
| Queue resume / re-provision                                | RB-03   |
| AI kill-switch flip (creates a revision, restarts service) | RB-04   |
| Break-glass password rotation                              | RB-05   |
| CI trust revocation; service-account disable               | RB-05   |
| Membership and session revocation                          | RB-06   |
| Identity-provider deletion completion                      | RB-07   |
| `--max-instances` change; invoker-binding removal          | RB-08   |
| Budget creation (requires enabling an API)                 | RB-08   |

**Blocker B — the system does not exist yet.** No authorization would help; there is nothing to run
the procedure against.

| Unexercised step                                               | Missing system                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Every worker log query (`relay.*`, `retention.*`, `weather.*`) | `verdery-workers-dev` is undeployed                                                 |
| Cloud Tasks retry-exhaustion behavior; queue depth             | Cloud Tasks API disabled; `media-processing-dev` queue never created                |
| Dead-letter / re-drive exercise                                | Same, plus no relay to pick up a re-driven event                                    |
| Deletion sweep restore                                         | `deploy-workers.sh` has three unmet prerequisites (worker SA, DB secret, IAM grant) |
| Cross-region provision and restore                             | No second project; `P8-DB-01` and `P8-NET-01` unbuilt                               |
| Routing shift during regional recovery                         | No DNS and no load balancer exist                                                   |
| Alert-driven detection for every scenario                      | Zero alert policies, channels, and log metrics exist                                |

**Blocker C — no operator database path.** Cloud SQL is private-IP only (`ipv4Enabled: false`), so
every SQL query in this document is unexecutable from a workstation without the attended break-glass
procedure, which itself briefly exposes a public IP. This blocks the outbox stock query, the job
stock query, the audit-event investigation, the stuck-purge query, and the whole post-restore
verification checklist.

This is worth naming as its own blocker rather than folding it into A or B, because it is the one
that will bite hardest during a real incident: **the most diagnostic queries in this document are
currently the hardest ones to run.**

**Blocker D — needs a second person or a real subject.** The tabletop regional exercise (§19) needs
the owner in the room. Account-deletion verification (§19) needs a real deletion subject.

### Required exercises from reliability-and-disaster-recovery.md §19

| Required exercise                | Status                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Application rollback per release | **Partially exercised.** Assessment and target selection fully exercised (log rows 2–6); the traffic switch is Blocker A. |
| Database restore, quarterly      | **Not exercised.** Blocker A. This is the largest unvalidated assumption in the project.                                  |
| Queue replay and dead-letter     | **Not exercised.** Blocker B. Also: there is no dead letter to exercise — see RB-03.                                      |
| Credential revocation            | **Not exercised.** Blocker A. The _audit_ half was exercised (log row 13).                                                |
| Tabletop regional disaster       | **Not exercised.** Blocker D. RB-09's procedure is the agenda.                                                            |
| Account deletion verification    | **Not exercised.** Blockers B, C, and D together.                                                                         |

---

## Gaps needing an owner decision

Each item below was found by running a command, not by reading a document. They are ordered by the
ratio of risk removed to effort spent.

1. **No budget, and no way to create one.** `billingbudgets.googleapis.com` is disabled. With both
   Cloud Run services open to `allUsers`, the only spend control is `--max-instances=2`. Enabling the
   API and setting one budget with a notification channel is the cheapest risk reduction available in
   this entire document. **Decision: enable the API and set a threshold.**

2. **Cloud SQL is `ZONAL` with deletion protection off.** Reliability-and-disaster-recovery.md §6
   requires regional HA and deletion protection; neither is configured. Deletion protection is a
   one-flag change with no downside. Regional HA roughly doubles instance cost and is a genuine
   trade-off at `db-f1-micro`. **Decision: enable deletion protection now; decide regional HA as part
   of `P8-DB-01`.**

3. **Backups have never been restored.** By §7's own standard ("Backups are not considered valid
   until restoration is tested") the backups are unvalidated. A clone-to-new-instance drill is
   non-destructive and would produce the first real RTO number this project has. **Decision:
   authorize one timed restore drill.**

4. **`--allow-unauthenticated` with a stale justification.** `deploy-api.sh` still logs that the
   service "currently exposes nothing but health checks." It exposes real endpoints now. The comment
   is misleading to the next operator who reads it. **Decision: `P8-SEC-02` scope, but the comment
   should be corrected regardless.** (Reported here rather than edited — another agent may hold that
   script.)

5. **No operator database path.** Blocker C above. Every high-value diagnostic query in this document
   requires either the attended break-glass procedure or a bastion that does not exist. **Decision: is
   a read-only VPC-side query path worth building before production?**

6. **`storageAutoResize` with no limit.** §6 asks for "storage auto-growth with alerting and
   maximum-cost review"; growth is on, cap and alerting are absent. **Decision: set
   `storageAutoResizeLimit`.**

7. **No alternate region chosen.** RB-09 step 2 is a prerequisite decision, and its absence is what
   makes the 4-hour regional RTO not credible. **Decision: name an approved alternate US region in
   ADR-0007 or a successor.**

8. **Cloud Tasks retry exhaustion has no re-drive.** Already recorded as a deferred capability by
   P6-OBS-01. Restated here because RB-03 and RB-07 both depend on it, and because it is the one
   design gap in the async layer where the manual remediation is a hand-written row in a production
   table.

9. **The compute default service account holds `roles/editor`.** Nothing runs as it today. It is a
   broad standing grant with no current purpose. **Decision: remove the binding, or document why it
   stays.**

10. **Data-access audit logging status is unknown.** RB-05's "who read the break-glass secret?" query
    depends on Secret Manager data-access logs, which are off by default in Google Cloud. Whether
    they are on here was not verified. **Decision: verify, and enable for Secret Manager at
    minimum.**
