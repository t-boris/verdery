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

log "Deployed. Service URL: ${service_url}"
log ""
log "NOTE: --allow-unauthenticated is a deliberate development-only choice —"
log "this service currently exposes nothing but health checks. Revisit before"
log "any endpoint carries real data (P8-SEC-02, moving App Check and access"
log "control from observe to enforce)."
