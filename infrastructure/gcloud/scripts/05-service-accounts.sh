#!/usr/bin/env bash
# Creates two service accounts with distinct, least-privilege roles:
#
# - The DEPLOY service account is impersonated by GitHub Actions through
#   workload identity federation (06-workload-identity-federation.sh). It can
#   push images and update the Cloud Run service, and nothing else.
# - The RUNTIME service account is what the Cloud Run service runs as. It can
#   read the one secret it needs and write telemetry, and nothing else.
#
# Separating them means a compromised or over-broad CI credential cannot read
# application secrets, and a compromised application cannot redeploy itself.
#
# Source: implementation-plan.md work package P1-PLAT-03;
# architecture/security-and-privacy.md, section "6. Authorization Controls"
# (least privilege).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 05-service-accounts.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

deploy_email="${VERDERY_DEPLOY_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"
runtime_email="${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

create_service_account_if_needed() {
  local account_id="${1}" display_name="${2}"

  if resource_exists gcloud iam service-accounts describe "${account_id}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" \
    --project="${VERDERY_PROJECT_ID}"; then
    log "Service account already exists: ${account_id}"
  else
    log "Creating service account: ${account_id}"
    gcloud iam service-accounts create "${account_id}" \
      --project="${VERDERY_PROJECT_ID}" \
      --display-name="${display_name}"
  fi
}

# `add-iam-policy-binding` is idempotent: binding an already-bound
# member/role pair succeeds without duplicating the binding.
grant_project_role() {
  local member="${1}" role="${2}"
  local attempts=0

  log "Granting ${role} to ${member}"

  # A service account created moments ago can still be invisible to the IAM
  # policy-binding backend ("does not exist") for a few seconds. Observed
  # directly while writing this script. Retrying is the correct response, not
  # a workaround for a real permissions problem.
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

create_service_account_if_needed "${VERDERY_DEPLOY_SERVICE_ACCOUNT_ID}" "Verdery ${VERDERY_ENVIRONMENT} deployer (GitHub Actions)"
create_service_account_if_needed "${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}" "Verdery ${VERDERY_ENVIRONMENT} API runtime"

grant_project_role "serviceAccount:${deploy_email}" "roles/run.developer"
grant_project_role "serviceAccount:${deploy_email}" "roles/artifactregistry.writer"

# Lets the deploy SA deploy a Cloud Run revision that runs AS the runtime SA,
# without granting the deploy SA any of the runtime SA's own permissions.
log "Granting the deployer permission to act as the runtime service account"
gcloud iam service-accounts add-iam-policy-binding "${runtime_email}" \
  --project="${VERDERY_PROJECT_ID}" \
  --member="serviceAccount:${deploy_email}" \
  --role="roles/iam.serviceAccountUser" \
  >/dev/null

grant_project_role "serviceAccount:${runtime_email}" "roles/cloudtrace.agent"
grant_project_role "serviceAccount:${runtime_email}" "roles/monitoring.metricWriter"
grant_project_role "serviceAccount:${runtime_email}" "roles/logging.logWriter"
# The Cloud SQL connector calls the Cloud SQL Admin API (connectSettings,
# ephemeral certs) before it opens the actual database connection, regardless
# of IAM or password authentication at the database layer. Without this role
# the connector fails with "Not authorized ... cloudsql.instances.get" before
# it ever reaches Postgres. Observed directly running the migration job.
grant_project_role "serviceAccount:${runtime_email}" "roles/cloudsql.client"
# Distinct from roles/cloudsql.client above: cloudsql.client grants the
# control-plane calls the connector makes (connectSettings, ephemeral certs).
# This role grants cloudsql.instances.login, which Cloud SQL separately checks
# at the moment of the actual IAM database login. Without it Postgres itself
# rejects the connection with "Cloud SQL IAM service account authentication
# failed", after the connector has already succeeded. Observed directly
# running the migration job — the two errors look identical from the
# application's side but come from different layers with different fixes.
grant_project_role "serviceAccount:${runtime_email}" "roles/cloudsql.instanceUser"
# Lets the running service verify Firebase ID tokens and check revocation
# state with the Firebase Admin SDK, using this service account's own
# identity rather than a downloaded service account key.
#
# Source: architecture/identity-and-authorization.md, section
# "4. Native Authentication Flow".
grant_project_role "serviceAccount:${runtime_email}" "roles/firebaseauth.admin"
# Secret access is granted per-secret in 07-iam-database-bootstrap.sh, not at project scope,
# so the runtime SA reads exactly the secrets it is given and no others.

log "Deploy service account: ${deploy_email}"
log "Runtime service account: ${runtime_email}"
