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
