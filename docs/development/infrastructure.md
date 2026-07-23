# Infrastructure and deployment

How `verdery-dev` came to exist, how to deploy to it, and how it was verified. The scripts
themselves are documented in
[../../infrastructure/gcloud/README.md](../../infrastructure/gcloud/README.md); this document is
the narrative — what exists, why, and what it proves.

## What exists

One Google Cloud project, `verdery-dev`, in `us-central1`, provisioned by the idempotent scripts in
`infrastructure/gcloud/scripts/` rather than Terraform — see
[ADR-0011](../architecture/decisions/ADR-0011-gcloud-scripts-instead-of-terraform.md) for why.

- A VPC network with Cloud SQL for PostgreSQL 17 reachable only on its private IP.
- Cloud SQL IAM database authentication: the running service and the migration job authenticate as
  their own Google identity, never a password. See
  [database-migrations.md](database-migrations.md), "Roles".
- A deploy service account (push images, update the Cloud Run service) and a separate runtime
  service account (read no secret, since there is none; write logs, metrics, and traces) — distinct
  identities so a compromised CI credential cannot read what the running service can, and a
  compromised running service cannot redeploy itself.
- Workload identity federation trusting `t-boris/verdery`, additionally scoped to the `development`
  GitHub Environment. A workflow job without `environment: development` gets a valid GitHub OIDC
  token and no usable Google credential.
- Artifact Registry, and `verdery-api-dev` on Cloud Run. The service permits public network ingress
  with `--allow-unauthenticated` as a deliberate development configuration; public health endpoints
  remain open, while product endpoints enforce Firebase/session authentication and server-side
  authorization. Production edge hardening remains P8 work.
- OpenTelemetry traces exported to Cloud Trace.
- Four private Cloud Storage buckets for Phase 6 media (`verdery-dev-{user-media,raw-capture,derived,
exports}`), each with uniform bucket-level access and public access prevention enforced, and the
  runtime service account granted `roles/storage.objectAdmin` per bucket (not a project-wide role).
  See `infrastructure/gcloud/scripts/09-media-storage.sh` for the per-bucket lifecycle policy and its
  reasoning.

## Deploying

```bash
docker buildx build --platform linux/amd64 -f services/api/Dockerfile \
  -t us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag> --push .

infrastructure/gcloud/scripts/deploy-migration-job.sh dev \
  us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag>
gcloud run jobs execute verdery-api-dev-migrate --project=verdery-dev --region=us-central1 --wait

infrastructure/gcloud/scripts/deploy-api.sh dev us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag>
```

`.github/workflows/deploy-dev.yml` runs the same sequence through workload identity federation,
triggered after `CI` succeeds on `master` or by `workflow_dispatch`. No step exists in that workflow
that a person cannot also run from a laptop with `gcloud` access — the architecture's requirement
that "development deployment is reproducible from an empty workstation with approved access."

Migrations run as a Cloud Run Job rather than directly from the invoking machine, whether that
machine is a laptop or a GitHub-hosted runner: Cloud SQL has no public IP, so only Direct VPC egress
— which only a Cloud Run workload can use — can reach it.

Build once with `--platform linux/amd64` explicitly. The pinned base images are amd64-only; a plain
`docker build` on Apple silicon produces a multi-platform manifest Cloud Run rejects with "must
support amd64/linux" — found directly while building this environment for the first time.

## What was verified, not assumed

- **The migration runs through the real least-privilege identity, not only a superuser.** Two real
  permission gaps surfaced only when migrations ran through the actual Cloud SQL IAM identity for
  the first time, invisible to a test suite that only ever connected as a superuser:
  `cloudsql.instances.login` (a Cloud SQL IAM permission distinct from `cloudsql.client`) and a
  schema-level `CREATE` grant `node-pg-migrate`'s own tracking table needs. Both are fixed and now
  covered by a dedicated regression test — see [database-migrations.md](database-migrations.md).
- **A real request produces one connected trace.** `GET /v1/health/ready` against the live service
  produced a single Cloud Trace trace containing the HTTP server span and nested `pg-pool.connect` /
  `pg.connect` client spans, the latter carrying `db.user: verdery-dev-api-runtime@verdery-dev.iam`
  — the real runtime identity, not a placeholder. This is the P1-OBS-01 completion evidence, "one
  request trace crosses ingress and database."
- **Traces need `SimpleSpanProcessor`, not the default batching processor.** Cloud Run allocates CPU
  only while handling a request, then freezes the instance until the next one arrives. The default
  `BatchSpanProcessor` relies on a background timer to flush, which never fires between requests on
  a frozen instance: spans were created and logged (`traceId` present in request logs) but never
  reached Cloud Trace until this was found and fixed. `SimpleSpanProcessor` exports synchronously,
  inside the request that is still keeping the instance thawed.
- **Cloud SQL's default PostGIS version is not the pinned one.** Cloud SQL for PostgreSQL 17
  defaults `CREATE EXTENSION postgis` to 3.6.0, not the 3.5 series ADR-0009 pins and the
  Testcontainers image provides. The migration now requests `VERSION '3.5.2'` explicitly. See
  ADR-0009's consequences section.
- **`db-f1-micro` requires the Enterprise edition explicitly.** Cloud SQL now defaults new instances
  to the Enterprise Plus edition, which rejects shared-core tiers. `--edition=ENTERPRISE` is required
  alongside `--tier=db-f1-micro`.
- **The workload identity binding must key off an attribute, not GitHub's literal `sub` string.**
  The pool's `subject` binding was written for `repo:t-boris/verdery:environment:development`, and
  every deploy failed with "Unable to acquire impersonated credentials —
  iam.serviceAccounts.getAccessToken denied" until a real token was decoded and compared. GitHub's
  actual `sub` claim for this repository is
  `repo:t-boris@508098/verdery@1308715947:environment:development` — it embeds immutable numeric
  owner and repository IDs alongside the names, a documented anti-spoofing format this script did
  not anticipate. The binding now targets `principalSet://.../attribute.environment/development`,
  which depends only on the provider's attribute mapping and cannot be broken by that kind of
  formatting difference again. Two earlier, plausible-looking fixes (removing
  `docker/setup-buildx-action`, minting an access token directly for `docker login`) were real
  improvements but did not address this — the actual failure was identical under all three
  configurations until the binding itself was corrected.
- **A fresh IAM binding does not take effect instantly.** After correcting the binding above, the
  very next deploy attempt failed with the identical permission error; the one after that succeeded
  with no further change. Budget a few minutes after any workload identity change before concluding
  it did not work.
- **The Cloud SQL connector needs longer than a plain TCP connect on a cold Cloud Run revision.**
  Once authentication succeeded, the next deploy failed its Cloud Run startup probe: the readiness
  ping timed out fetching the connector's ephemeral certificate and negotiating mTLS within the
  default 5-second client timeout, so the process exited before it ever listened on its port.
  `deploy-api.sh` now sets `DATABASE_CONNECTION_TIMEOUT_MS=15000` for the deployed environment,
  verified by redeploying the exact image that had just failed and confirming a live `200` from
  `/v1/health/ready`.

- **The four media buckets, their access controls, and their lifecycle rules are real, not just
  scripted.** `gcloud storage buckets describe` against all four confirms
  `uniformBucketLevelAccess.enabled: true` and `publicAccessPrevention: enforced`;
  `gcloud storage buckets get-iam-policy` on `verdery-dev-user-media` confirms the runtime service
  account holds exactly `roles/storage.objectAdmin` and nothing broader; the `derived`/`exports`
  buckets' lifecycle configuration was read back and matches the committed JSON exactly (Nearline
  transition at 30 days; deletion at 7 days, respectively).

## What is deliberately not here

Staging, production, Terraform, container image scanning, and the staged cross-environment migration
rollout procedure. See [deferred-capabilities.md](deferred-capabilities.md).
