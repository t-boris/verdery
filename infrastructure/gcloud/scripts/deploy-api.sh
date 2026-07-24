#!/usr/bin/env bash
# Deploys the API service to Cloud Run.
#
# Used identically by a human and by CI, per the architecture's requirement
# that "development deployment is reproducible from an empty workstation with
# approved access" — there is no separate, undocumented deploy path CI alone
# knows about.
#
# Unlike the numbered provisioning scripts, this is a release action, not
# idempotent infrastructure creation, so it is not part of `provision.sh`.
#
# Source: implementation-plan.md work packages P1-PLAT-03, P1-BE-01.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: deploy-api.sh <environment> <image>}"
IMAGE="${2:?usage: deploy-api.sh <environment> <image>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

env_vars="VERDERY_ENVIRONMENT=${VERDERY_ENVIRONMENT}"
env_vars+=",DATABASE_CONNECTION_MODE=cloudSqlIam"
env_vars+=",DATABASE_INSTANCE_CONNECTION_NAME=${VERDERY_PROJECT_ID}:${VERDERY_REGION}:${VERDERY_SQL_INSTANCE_NAME}"
env_vars+=",DATABASE_IAM_USER=${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam"
env_vars+=",DATABASE_NAME=${VERDERY_SQL_DATABASE_NAME}"
env_vars+=",TRACING_ENABLED=${VERDERY_TRACING_ENABLED:-false}"
# The 5 second default (configuration-schema.ts) times a plain TCP connect
# attempt, sized for a local or Testcontainers Postgres on the same machine.
# The Cloud SQL connector does more before a connection exists at all — an
# API call to fetch an ephemeral certificate, then an mTLS handshake — and a
# cold connector on a brand new revision was observed missing the 5 second
# window here, failing the startup ping and taking the revision down before
# it ever served a request. 15 seconds is generous for that handshake without
# meaningfully delaying a real failure's detection.
env_vars+=",DATABASE_CONNECTION_TIMEOUT_MS=15000"
# Required since Phase 2: the service verifies Firebase ID tokens and session
# cookies against this exact project. Missing this fails startup
# configuration validation immediately (loadConfiguration()), the same
# fail-fast behavior as a missing database variable.
#
# Source: architecture/identity-and-authorization.md, section
# "2. Identity Authority".
env_vars+=",FIREBASE_PROJECT_ID=${VERDERY_PROJECT_ID}"
# The four private media buckets P6-PLAT-01 provisions
# (09-media-storage.sh) and P6-API-01's endpoints require at startup
# (configuration-schema.ts: MEDIA_*_BUCKET are non-optional). Discovered
# missing from this script entirely while wiring P6-ASYNC-01's own two new
# required variables below — a real gap predating this stage, fixed here
# rather than left alongside new variables that would otherwise sit next to
# a startup-config failure this script was never actually completing.
env_vars+=",MEDIA_USER_MEDIA_BUCKET=${VERDERY_USER_MEDIA_BUCKET}"
env_vars+=",MEDIA_RAW_CAPTURE_BUCKET=${VERDERY_RAW_CAPTURE_BUCKET}"
env_vars+=",MEDIA_DERIVED_BUCKET=${VERDERY_DERIVED_BUCKET}"
env_vars+=",MEDIA_EXPORTS_BUCKET=${VERDERY_EXPORTS_BUCKET}"
env_vars+=",MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL=${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

# `MEDIA_PROCESSING_CALLBACK_AUDIENCE` is the callback route's own OIDC
# audience — this exact service's own URL. The ORIGINAL version of this
# script omitted it from the `--set-env-vars` call below entirely, planning
# to set it in a second, self-referential `gcloud run services update` call
# once the URL was known — but `gcloud run deploy --set-env-vars` REPLACES
# the complete env var set, not merges, so that first call always produced a
# revision missing this non-optional variable
# (configuration-schema.ts: `z.string().min(1)`), which crashed on startup
# before that second call ever ran: a real, live deploy failure
# ("MEDIA_PROCESSING_CALLBACK_AUDIENCE: Invalid input: expected string,
# received undefined", `verdery-api-dev-00055-p8g` never starting) — not a
# one-time bootstrap problem, since every later redeploy would have hit the
# identical crash the exact same way.
#
# Cloud Run service URLs are stable across every revision of the same
# service (this script's own prior comment already knew this) — for an
# ALREADY-EXISTING service, the URL is therefore already known before this
# deploy ever runs, so it belongs in this first call, not a follow-up one.
# Only a genuinely first-ever deploy of a brand new service (no URL exists
# yet at all) still needs the placeholder-then-correct two-step shape below.
if resource_exists gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  existing_service_url="$(gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"
  env_vars+=",MEDIA_PROCESSING_CALLBACK_AUDIENCE=${existing_service_url}/v1/internal/media-processing-jobs"
else
  log "${VERDERY_CLOUD_RUN_SERVICE_NAME} does not exist yet — deploying once with a placeholder"
  log "MEDIA_PROCESSING_CALLBACK_AUDIENCE (corrected below once a real URL exists)."
  env_vars+=",MEDIA_PROCESSING_CALLBACK_AUDIENCE=pending-first-deploy"
fi

log "Deploying ${IMAGE} to ${VERDERY_CLOUD_RUN_SERVICE_NAME}"
gcloud run deploy "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --image="${IMAGE}" \
  --network="${VERDERY_NETWORK_NAME}" \
  --subnet="${VERDERY_SUBNET_NAME}" \
  --vpc-egress=private-ranges-only \
  --service-account="${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="${env_vars}" \
  --min-instances=0 \
  --max-instances=2 \
  --cpu=1 \
  --memory=512Mi \
  --port=8080 \
  --allow-unauthenticated \
  --quiet

service_url="$(gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"

# Corrects the placeholder from a genuinely first-ever deploy (see above) to
# the real, now-known URL. A true no-op on every other redeploy — the
# service already existed, so the first `--set-env-vars` call above already
# set the real, correct value, and this second call updates it to the exact
# same string.
callback_audience="${service_url}/v1/internal/media-processing-jobs"
log "Setting media-processing callback audience: ${callback_audience}"
gcloud run services update "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --update-env-vars="MEDIA_PROCESSING_CALLBACK_AUDIENCE=${callback_audience}" \
  --quiet >/dev/null

log "Deployed. Service URL: ${service_url}"
log ""
log "NOTE: --allow-unauthenticated is a deliberate development-only choice —"
log "this service currently exposes nothing but health checks. Revisit before"
log "any endpoint carries real data (P8-SEC-02, moving App Check and access"
log "control from observe to enforce)."
