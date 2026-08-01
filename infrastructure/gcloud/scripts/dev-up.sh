#!/usr/bin/env bash
# Wakes a non-production environment that `dev-down.sh` put to sleep.
#
# The reverse of `dev-down.sh`, in the order that matters: the database first,
# because the workers service connects to it on startup and a worker that
# comes up against a stopped instance spends its first minutes failing rather
# than draining the outbox.
#
# Starting Cloud SQL is not instant — the instance takes a minute or two to
# become `RUNNABLE`, and this script waits for that rather than returning to a
# prompt that looks finished while nothing yet works.
#
# The API and web services need no waking: they scale to zero on their own and
# start on the first request.
#
# Source: architecture/cost-and-scaling.md, section "15. Environment Cost".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: dev-up.sh <environment>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

log "Starting Cloud SQL instance ${VERDERY_SQL_INSTANCE_NAME}"
gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --activation-policy=ALWAYS \
  --quiet >/dev/null

log "Waiting for it to become RUNNABLE"
for _ in $(seq 1 60); do
  state="$(gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --format='value(state)' 2>/dev/null || true)"
  if [[ "${state}" == "RUNNABLE" ]]; then
    break
  fi
  sleep 10
done

if [[ "${state:-}" != "RUNNABLE" ]]; then
  echo "Cloud SQL did not reach RUNNABLE in time (last state: ${state:-unknown})." >&2
  echo "The workers service is deliberately NOT started against a database that is not up." >&2
  exit 1
fi
log "Cloud SQL is RUNNABLE"

if resource_exists gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  log "Restoring ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME} to one warm instance"
  gcloud run services update "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --min-instances="${VERDERY_WORKER_MIN_INSTANCES:-1}" \
    --quiet >/dev/null
else
  log "Workers service does not exist yet — deploy it with deploy-workers.sh."
fi

log ""
log "${ENVIRONMENT} is awake. Anything uploaded while it slept drains on the"
log "relay's next tick; the clients poll media status, so photos fill in"
log "without a reload."
