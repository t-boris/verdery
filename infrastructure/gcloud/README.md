# gcloud provisioning scripts

Idempotent shell scripts that provision Google Cloud infrastructure, used instead of Terraform.
See [ADR-0011](../../docs/architecture/decisions/ADR-0011-gcloud-scripts-instead-of-terraform.md)
for why, and [../../docs/development/infrastructure.md](../../docs/development/infrastructure.md)
for the developer-facing narrative (what exists, how to deploy, how it was verified).

## Layout

```text
config/
  dev.env          Environment-specific values. staging.env / prod.env follow the same shape.

scripts/
  lib/common.sh                        Shared helpers every script sources.
  00-create-project.sh                 Project + billing.
  01-enable-apis.sh                    Required Google Cloud APIs.
  02-network.sh                        VPC, subnet, private services access peering.
  03-cloud-sql.sh                      Cloud SQL for PostgreSQL, private IP only.
  04-artifact-registry.sh              Docker repository.
  05-service-accounts.sh               Deploy and runtime service accounts, least privilege.
  06-workload-identity-federation.sh   Keyless GitHub Actions trust.
  07-iam-database-bootstrap.sh         One-time: grants a service account database access.
  08-app-check-recaptcha.sh            reCAPTCHA Enterprise key for web App Check.
  provision.sh                         Runs 00–06 and 08 in order (07 stays manual, see below).
  verify.sh                            Read-only check of what actually exists.
  deploy-migration-job.sh              Creates or updates the migration Cloud Run Job.
  deploy-api.sh                        Builds nothing; deploys an already-pushed image.
```

## Running against a new environment

```bash
bash scripts/provision.sh dev
bash scripts/07-iam-database-bootstrap.sh dev verdery-dev-api-runtime@verdery-dev.iam.gserviceaccount.com
bash scripts/verify.sh dev
```

`07-iam-database-bootstrap.sh` is deliberately not part of `provision.sh`: it briefly assigns Cloud
SQL a public IP, restricted to the caller's own address, to grant a role membership no other API
call can perform. Run it attended, watch its output, and confirm `verify.sh` still reports the
instance has no public IP afterward.

## Deploying the API

```bash
docker buildx build --platform linux/amd64 -f services/api/Dockerfile \
  -t us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag> --push .

bash scripts/deploy-migration-job.sh dev us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag>
gcloud run jobs execute verdery-api-dev-migrate --project=verdery-dev --region=us-central1 --wait

bash scripts/deploy-api.sh dev us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag>
```

`.github/workflows/deploy-dev.yml` runs exactly these steps through workload identity federation —
no step exists in CI that a human cannot also run locally.

Migrations run as a Cloud Run Job with Direct VPC egress rather than directly from a workstation or
a GitHub Actions runner: Cloud SQL has no public IP, so nothing outside the VPC can reach it except
through that egress path.
