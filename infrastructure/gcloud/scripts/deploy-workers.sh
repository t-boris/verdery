#!/usr/bin/env bash
# Deploys the workers service (transactional-outbox relay + media-validation
# HTTP target) to Cloud Run.
#
# Mirrors deploy-api.sh's OWN CURRENT, already-fixed structure exactly —
# specifically its "look up an already-existing service's real URL BEFORE the
# first --set-env-vars call" shape, not the REPLACE-not-merge two-step bug
# that script's own comment records having to fix. `gcloud run deploy
# --set-env-vars` REPLACES the complete env var set on every call; only a
# genuinely first-ever deploy (no URL exists yet at all) needs the
# placeholder-then-correct two-step shape below.
#
# SCOPE BOUNDARY: written and syntax-checked (`bash -n deploy-workers.sh`),
# NOT executed against `verdery-dev` or any other real environment — matching
# every other unexecuted script in this directory (09-media-storage.sh,
# 10-media-processing-queue.sh before their own live runs).
#
# THIS SCRIPT DOES NOT, BY ITSELF, MAKE A LIVE DEPLOY SUCCEED — three real
# prerequisites this repository does not yet provide, all already flagged by
# 10-media-processing-queue.sh's own "NOT YET DONE" log output:
#
#   1. `verdery_worker` Cloud SQL IAM database membership for
#      ${VERDERY_WORKER_SERVICE_ACCOUNT_ID} — 07-iam-database-bootstrap.sh
#      does not yet grant it (see that script's own header comment).
#   2. A REAL value behind the DATABASE_URL secret this script references via
#      `--set-secrets` (see below) — services/workers/src/configuration.ts
#      deliberately uses a plain connection string, not Cloud SQL IAM mode,
#      and dev.env's own comment already states "there is deliberately no
#      DATABASE_URL secret name here" today. Creating that secret (a
#      `gcloud secrets create` plus a version holding a real, working
#      connection string for ${VERDERY_WORKER_SERVICE_ACCOUNT_ID}, and
#      granting that service account `roles/secretmanager.secretAccessor` on
#      it, the same shape 07-iam-database-bootstrap.sh already uses for the
#      break-glass superuser secret) is a real, separate, not-yet-built step.
#   3. services/api's own service must already be deployed and reachable —
#      this script reads its live URL to build the hop-2 result-callback
#      target; it does not deploy or wait for services/api itself.
#
# Source: implementation-plan.md work package P6-WORKER-01;
# architecture/asynchronous-processing.md, section "5. Cloud Tasks";
# architecture/media-storage-and-processing.md, section "18. Security".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: deploy-workers.sh <environment> <image>}"
IMAGE="${2:?usage: deploy-workers.sh <environment> <image>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

worker_email="${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

# `services/api` must already be deployed — its live URL is the hop-2
# result-callback target this worker calls after real validation. Failing
# loudly here beats deploying a worker that can never complete its own
# callback.
if ! resource_exists gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  fail "${VERDERY_CLOUD_RUN_SERVICE_NAME} does not exist yet — deploy services/api (deploy-api.sh) first."
fi
api_service_url="$(gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"
# Must match services/api's OWN MEDIA_PROCESSING_CALLBACK_AUDIENCE exactly
# (deploy-api.sh sets it to this identical string) — GoogleOidcInvocationVerifier
# on the API side checks the inbound hop-2 token's `aud` claim against it.
result_callback_base="${api_service_url}/v1/internal/media-processing-jobs"

env_vars="VERDERY_ENVIRONMENT=${VERDERY_ENVIRONMENT}"
env_vars+=",TRACING_ENABLED=${VERDERY_TRACING_ENABLED:-false}"
env_vars+=",MEDIA_PROCESSING_QUEUE_PROJECT_ID=${VERDERY_PROJECT_ID}"
env_vars+=",MEDIA_PROCESSING_QUEUE_LOCATION=${VERDERY_REGION}"
env_vars+=",MEDIA_PROCESSING_QUEUE_NAME=${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}"
# Cloud Tasks mints hop 1's OIDC token as THIS service account (the worker's
# own identity, granted roles/iam.serviceAccountTokenCreator for the Cloud
# Tasks agent by 10-media-processing-queue.sh) — the SAME identity the
# worker's own Application Default Credentials use to mint hop 2's token via
# google-auth-library, so both hops present one consistent identity even
# though two different mechanisms mint their tokens.
env_vars+=",MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL=${worker_email}"
env_vars+=",MEDIA_PROCESSING_RESULT_CALLBACK_URL=${result_callback_base}"
env_vars+=",MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE=${result_callback_base}"

# `MEDIA_PROCESSING_TASK_URL` is self-referential (this service's own
# validation-job route) — the exact same "look up the already-existing
# service's real URL before the first deploy call" shape deploy-api.sh uses
# for its own MEDIA_PROCESSING_CALLBACK_AUDIENCE, for the identical reason:
# --set-env-vars replaces the whole set, so a follow-up call is only needed
# for a genuinely first-ever deploy.
if resource_exists gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  existing_workers_url="$(gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"
  env_vars+=",MEDIA_PROCESSING_TASK_URL=${existing_workers_url}/internal/media-validation-jobs"
else
  log "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME} does not exist yet — deploying once with a placeholder"
  log "MEDIA_PROCESSING_TASK_URL (corrected below once a real URL exists)."
  env_vars+=",MEDIA_PROCESSING_TASK_URL=https://pending-first-deploy.invalid/internal/media-validation-jobs"
fi

log "Deploying ${IMAGE} to ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}"
gcloud run deploy "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --image="${IMAGE}" \
  --network="${VERDERY_NETWORK_NAME}" \
  --subnet="${VERDERY_SUBNET_NAME}" \
  --vpc-egress=private-ranges-only \
  --service-account="${worker_email}" \
  --set-env-vars="${env_vars}" \
  --set-secrets="DATABASE_URL=${VERDERY_WORKER_DATABASE_URL_SECRET_NAME}:latest" \
  --min-instances=1 \
  --max-instances=2 \
  --no-cpu-throttling \
  --cpu=1 \
  --memory=512Mi \
  --port=8080 \
  --no-allow-unauthenticated \
  --quiet

workers_service_url="$(gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"

# Corrects the placeholder from a genuinely first-ever deploy (see above) to
# the real, now-known URL. A true no-op on every other redeploy.
task_url="${workers_service_url}/internal/media-validation-jobs"
log "Setting media-processing task URL: ${task_url}"
gcloud run services update "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --update-env-vars="MEDIA_PROCESSING_TASK_URL=${task_url}" \
  --quiet >/dev/null

# Cloud Tasks (not an end user or another service) is this route's only
# legitimate caller; unlike deploy-api.sh's own current --allow-unauthenticated
# development-only choice, this service carries a real authenticated
# machine-to-machine target from day one, so it is never made public.
log "Granting Cloud Run Invoker on ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME} to the Cloud Tasks agent and to itself"
project_number="$(gcloud projects describe "${VERDERY_PROJECT_ID}" --format="value(projectNumber)")"
cloud_tasks_agent="service-${project_number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
gcloud run services add-iam-policy-binding "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --member="serviceAccount:${cloud_tasks_agent}" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

log "Deployed. Service URL: ${workers_service_url}"
log ""
log "NOTE: this deploy will not actually start serving traffic successfully"
log "until this script's own header comment's three prerequisites (Cloud SQL"
log "IAM membership, a real DATABASE_URL secret, and an already-deployed"
log "services/api) are satisfied. Verify with:"
log "  gcloud run services logs read ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME} --project=${VERDERY_PROJECT_ID} --region=${VERDERY_REGION}"
