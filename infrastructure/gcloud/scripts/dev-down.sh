#!/usr/bin/env bash
# Puts a non-production environment to sleep between working sessions.
#
# WHAT ACTUALLY COSTS MONEY WHILE IDLE is the point of this script. The API
# and web services already scale to zero and cost essentially nothing between
# requests, so they are left alone. The two resources that bill for existing
# rather than for being used are:
#
#   1. Cloud SQL, which runs continuously under `activationPolicy=ALWAYS`.
#   2. The workers service, which holds one always-warm instance with
#      always-allocated CPU because its outbox relay is an internal timer
#      rather than an HTTP entry point.
#
# SAFE TO DO, because the outbox is transactional. `outbox-relay.ts` marks an
# event published only AFTER its task is successfully enqueued, so a stopped
# relay does not lose work — the rows simply wait, and the next tick after
# `dev-up.sh` drains them. Photos uploaded while asleep become viewable once
# the environment is back, without a reload: the clients poll media status.
#
# ONE THING IS NOT SAFE, and it is narrow. The media-processing queue is
# created with `--max-attempts=10 --max-retry-duration=3600s`. A task enqueued
# in the moments before this script runs, with the worker then down for over an
# hour, exhausts its retries; its outbox row is already marked published, so
# nothing re-creates it, and that one media record stays `processing` forever.
# Give the relay a moment to settle before sleeping if an upload just finished.
#
# REFUSES TO RUN AGAINST PRODUCTION. Sleeping prod is not a thing this script
# exists to make easy, and an environment argument is easy to mistype.
#
# Source: architecture/cost-and-scaling.md, section "15. Environment Cost";
# architecture/asynchronous-processing.md, section "4. Transactional Outbox".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: dev-down.sh <environment>}"

if [[ "${ENVIRONMENT}" == "prod" ]]; then
  echo "dev-down.sh refuses to run against prod." >&2
  exit 1
fi

load_environment_config "${ENVIRONMENT}"
require_active_project

if resource_exists gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  log "Scaling ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME} to zero instances"
  gcloud run services update "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --min-instances=0 \
    --quiet >/dev/null
else
  log "Workers service does not exist yet — nothing to scale down."
fi

log "Stopping Cloud SQL instance ${VERDERY_SQL_INSTANCE_NAME}"
log "Storage is still billed while stopped; only compute stops."
gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --activation-policy=NEVER \
  --quiet >/dev/null

log ""
log "${ENVIRONMENT} is asleep."
log "Set VERDERY_WORKER_MIN_INSTANCES=0 in config/${ENVIRONMENT}.env if you want a"
log "deploy to leave it that way — deploy-workers.sh defaults to 1 otherwise."
log "Wake it with: ./dev-up.sh ${ENVIRONMENT}"
