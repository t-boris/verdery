#!/usr/bin/env bash
# Creates the Cloud Tasks queue and worker service account P6-ASYNC-01's
# relay (services/workers) needs, and grants the least-privilege roles that
# relay needs to enqueue tasks and (eventually) receive an authenticated
# invocation back from Cloud Run.
#
# SCOPE BOUNDARY: this script is DRAFTED AND SYNTAX-CHECKED
# (`bash -n 10-media-processing-queue.sh`) but has NOT been executed against
# `verdery-dev` or any other real environment this session — the same
# boundary P6-PLAT-01 (the immediately-preceding stage) drew for
# 09-media-storage.sh before its own live run was separately authorized.
# Do not run this against a real project without that same explicit
# confirmation.
#
# WHAT THIS SCRIPT DOES NOT FINISH, BY ITSELF:
#
# The `verdery-dev-worker` service account this script creates still needs
# Cloud SQL IAM database access before `services/workers` can actually
# connect (see `configuration.ts`'s own header comment on why this package
# uses a plain `DATABASE_URL`, not Cloud SQL IAM mode, for now — real IAM
# wiring for the worker's OWN database connection is exactly the follow-up
# this note flags). `07-iam-database-bootstrap.sh` as it stands today grants
# only `verdery_application`/`verdery_migration` membership; granting
# `verdery_worker` membership to this new service account's IAM database
# user is a small, separate SQL statement
# (`GRANT verdery_worker TO "verdery-dev-worker";`) that script does not yet
# know how to issue. Deliberately NOT folded into that already-delivered
# script without being asked — flagged here as the concrete next step
# instead of silently rewritten.
#
# Idempotent: every resource this script creates is checked for existence
# first, matching every other script in this directory.
#
# Source: implementation-plan.md work package P6-ASYNC-01;
# architecture/asynchronous-processing.md, section "5. Cloud Tasks";
# architecture/media-storage-and-processing.md, section "18. Security"
# ("Separate read/write permissions by worker role").

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 10-media-processing-queue.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

enable_api_if_needed cloudtasks.googleapis.com

worker_email="${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

# --- worker service account ------------------------------------------------
# Distinct from VERDERY_RUNTIME_SERVICE_ACCOUNT_ID (the API's own identity):
# architecture/media-storage-and-processing.md section 18 calls for "Separate
# read/write permissions by worker role" explicitly.
if resource_exists gcloud iam service-accounts describe "${worker_email}" \
  --project="${VERDERY_PROJECT_ID}"; then
  log "Service account already exists: ${VERDERY_WORKER_SERVICE_ACCOUNT_ID}"
else
  log "Creating service account: ${VERDERY_WORKER_SERVICE_ACCOUNT_ID}"
  gcloud iam service-accounts create "${VERDERY_WORKER_SERVICE_ACCOUNT_ID}" \
    --project="${VERDERY_PROJECT_ID}" \
    --display-name="Verdery ${VERDERY_ENVIRONMENT} worker (media-processing relay)"
fi

grant_project_role() {
  local member="${1}" role="${2}"
  local attempts=0

  log "Granting ${role} to ${member}"

  # A service account created moments ago can still be invisible to the IAM
  # policy-binding backend for a few seconds — the same retry
  # 05-service-accounts.sh already applies for its own two service accounts.
  until gcloud projects add-iam-policy-binding "${VERDERY_PROJECT_ID}" \
    --member="${member}" \
    --role="${role}" \
    --condition=None \
    >/dev/null; do
    attempts=$((attempts + 1))
    [[ ${attempts} -lt 6 ]] || fail "Could not grant ${role} to ${member} after ${attempts} attempts"
    log "Grant failed (attempt ${attempts}/6); the service account may still be propagating. Retrying in 10s."
    sleep 10
  done
}

# Lets the worker's own runtime identity call Cloud Tasks' CreateTask API.
grant_project_role "serviceAccount:${worker_email}" "roles/cloudtasks.enqueuer"
# Cloud SQL IAM database access for the relay's own DATABASE_URL connection
# — see this script's own header comment on why this is a documented
# follow-up, not finished here.
grant_project_role "serviceAccount:${worker_email}" "roles/cloudsql.client"
grant_project_role "serviceAccount:${worker_email}" "roles/cloudsql.instanceUser"
grant_project_role "serviceAccount:${worker_email}" "roles/logging.logWriter"
grant_project_role "serviceAccount:${worker_email}" "roles/monitoring.metricWriter"

# Validation reads originals but never writes or deletes them. Keep this at
# bucket scope and below objectAdmin: P6-WORKER-02 will need a separate,
# explicit derived-output write grant.
for bucket_name in \
  "${VERDERY_USER_MEDIA_BUCKET}" \
  "${VERDERY_RAW_CAPTURE_BUCKET}" \
  "${VERDERY_DERIVED_BUCKET}" \
  "${VERDERY_EXPORTS_BUCKET}"; do
  log "Granting roles/storage.objectViewer on ${bucket_name} to ${worker_email}"
  gcloud storage buckets add-iam-policy-binding "gs://${bucket_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --member="serviceAccount:${worker_email}" \
    --role="roles/storage.objectViewer" \
    --quiet >/dev/null
done

# --- Cloud Tasks queue -------------------------------------------------
# Default retry/rate config: architecture/asynchronous-processing.md section
# 5 requires "explicit target, service identity, retry policy, rate,
# concurrency, and dead-letter or terminal-failure process" per queue, but
# names no specific numbers for THIS queue anywhere in this repository's
# docs. The values below are reasoned defaults, documented here the same
# "no number decided yet, pick one and say so" posture 09-media-storage.sh's
# own export-bucket lifecycle rule already sets: bounded retries (10
# attempts) with capped exponential backoff (max 300s) so a permanently
# failing callback does not retry forever, and modest concurrency (10) since
# this stage's own placeholder callback does negligible work per call — a
# real P6-WORKER-02 processor may need to revisit this once real processing
# cost is known.
if resource_exists gcloud tasks queues describe "${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --location="${VERDERY_REGION}"; then
  log "Cloud Tasks queue already exists: ${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}"
else
  log "Creating Cloud Tasks queue: ${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}"
  gcloud tasks queues create "${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --location="${VERDERY_REGION}" \
    --max-attempts=10 \
    --max-retry-duration=3600s \
    --min-backoff=10s \
    --max-backoff=300s \
    --max-concurrent-dispatches=10 \
    --max-dispatches-per-second=10
fi

# The Cloud Tasks P4SA (Google-managed per-project agent) needs permission to
# mint OIDC tokens for the worker service account named in each task's own
# `oidcToken.serviceAccountEmail` (see services/workers/src/relay/cloud-
# tasks-media-processing-queue.ts) — a distinct grant from the worker's own
# roles above, on the SERVICE ACCOUNT itself, not the project.
project_number="$(gcloud projects describe "${VERDERY_PROJECT_ID}" --format="value(projectNumber)")"
cloud_tasks_agent="service-${project_number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"

log "Granting the Cloud Tasks service agent permission to mint OIDC tokens for ${worker_email}"
gcloud iam service-accounts add-iam-policy-binding "${worker_email}" \
  --project="${VERDERY_PROJECT_ID}" \
  --member="serviceAccount:${cloud_tasks_agent}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  >/dev/null

log "Worker service account: ${worker_email}"
log "Cloud Tasks queue: projects/${VERDERY_PROJECT_ID}/locations/${VERDERY_REGION}/queues/${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}"
log ""
log "NOT YET DONE — see this script's own header comment:"
log "  1. Grant verdery_worker Cloud SQL IAM database membership to ${worker_email}"
log "     (07-iam-database-bootstrap.sh does not yet know this role; a manual"
log "     GRANT is needed until that script is extended)."
log "  2. Deploy services/workers with its MEDIA_PROCESSING_* and DATABASE_URL"
log "     environment variables set, always-allocated CPU, and authenticated"
log "     Cloud Run invocation."
log "  3. Set MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL=${worker_email} on"
log "     the API service (deploy-api.sh already does this from"
log "     VERDERY_WORKER_SERVICE_ACCOUNT_ID)."
