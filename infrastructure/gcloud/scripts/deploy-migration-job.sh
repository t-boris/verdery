#!/usr/bin/env bash
# Deploys the database migration Cloud Run Job.
#
# The job itself predates this script: it was created ad hoc while bringing
# up verdery-dev in Phase 1 and, since then, deploy-dev.yml only ever updated
# its image, never its environment variables — an unscripted job that no
# environment variable this service later starts requiring (FIREBASE_
# PROJECT_ID, added in Phase 2) would ever reach. `gcloud run jobs deploy` is
# idempotent create-or-update, exactly like `gcloud run deploy` for the main
# service in deploy-api.sh, so running this brings the job's full
# configuration to the desired state regardless of whether it already exists
# and regardless of what it currently holds.
#
# Like deploy-api.sh, this is a release action, not idempotent infrastructure
# creation, so it is not part of provision.sh.
#
# Source: implementation-plan.md work package P2-DATA-01;
# architecture/environments-and-delivery.md.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: deploy-migration-job.sh <environment> <image>}"
IMAGE="${2:?usage: deploy-migration-job.sh <environment> <image>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

job_name="${VERDERY_CLOUD_RUN_SERVICE_NAME}-migrate"

env_vars="VERDERY_ENVIRONMENT=${VERDERY_ENVIRONMENT}"
env_vars+=",DATABASE_CONNECTION_MODE=cloudSqlIam"
env_vars+=",DATABASE_INSTANCE_CONNECTION_NAME=${VERDERY_PROJECT_ID}:${VERDERY_REGION}:${VERDERY_SQL_INSTANCE_NAME}"
env_vars+=",DATABASE_IAM_USER=${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam"
env_vars+=",DATABASE_NAME=${VERDERY_SQL_DATABASE_NAME}"
env_vars+=",FIREBASE_PROJECT_ID=${VERDERY_PROJECT_ID}"
# This job shares configuration-schema.ts's single, whole-process startup
# validation with the main API service — this is the exact bug class this
# script's own header comment already names for `FIREBASE_PROJECT_ID`,
# recurred for six more required variables P6-API-01/P6-ASYNC-01 added and
# only `deploy-api.sh` was updated to supply. `gcloud run jobs execute`
# fails the job at `loadConfiguration()`, before a single migration file
# runs, without every one of these present — confirmed by a real failed
# execution, not assumed.
env_vars+=",MEDIA_USER_MEDIA_BUCKET=${VERDERY_USER_MEDIA_BUCKET}"
env_vars+=",MEDIA_RAW_CAPTURE_BUCKET=${VERDERY_RAW_CAPTURE_BUCKET}"
env_vars+=",MEDIA_DERIVED_BUCKET=${VERDERY_DERIVED_BUCKET}"
env_vars+=",MEDIA_EXPORTS_BUCKET=${VERDERY_EXPORTS_BUCKET}"
env_vars+=",MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL=${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"
# Unlike deploy-api.sh, this job has no service URL of its own to build a
# real callback audience from — it runs migrations and exits, and never
# serves the media-processing callback route or verifies an inbound OIDC
# token against this value. `configuration-schema.ts` only requires the
# variable be a non-empty string (`z.string().min(1)`, not a URL format), so
# a clearly-labeled, non-functional placeholder satisfies startup validation
# without implying this job does something it does not.
env_vars+=",MEDIA_PROCESSING_CALLBACK_AUDIENCE=unused-by-migration-job"

log "Deploying ${IMAGE} to ${job_name}"
gcloud run jobs deploy "${job_name}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --image="${IMAGE}" \
  --network="${VERDERY_NETWORK_NAME}" \
  --subnet="${VERDERY_SUBNET_NAME}" \
  --vpc-egress=private-ranges-only \
  --service-account="${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="${env_vars}" \
  --tasks=1 \
  --max-retries=0 \
  --quiet

log "Deployed. Run with: gcloud run jobs execute ${job_name} --project=${VERDERY_PROJECT_ID} --region=${VERDERY_REGION} --wait"
