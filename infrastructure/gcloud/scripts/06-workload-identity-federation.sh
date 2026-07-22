#!/usr/bin/env bash
# Configures workload identity federation so GitHub Actions can deploy without
# a downloaded or committed service account key.
#
# The trust is scoped twice: the WIF provider only accepts tokens whose
# `repository` claim is exactly this GitHub repository, and the IAM binding
# additionally requires the `environment` claim to be the GitHub Environment
# configured below. A workflow run outside that environment gets a valid
# GitHub OIDC token but no principal this binding recognizes.
#
# Source: implementation-plan.md work package P1-PLAT-03
# ("Keyless development deployment" completion evidence);
# architecture/environments-and-delivery.md, section "6. CI/CD Identity".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 06-workload-identity-federation.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

deploy_email="${VERDERY_DEPLOY_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"
project_number="$(gcloud projects describe "${VERDERY_PROJECT_ID}" --format="value(projectNumber)")"

if resource_exists gcloud iam workload-identity-pools describe "${VERDERY_WORKLOAD_IDENTITY_POOL_ID}" \
  --project="${VERDERY_PROJECT_ID}" --location=global; then
  log "Workload identity pool already exists: ${VERDERY_WORKLOAD_IDENTITY_POOL_ID}"
else
  log "Creating workload identity pool: ${VERDERY_WORKLOAD_IDENTITY_POOL_ID}"
  gcloud iam workload-identity-pools create "${VERDERY_WORKLOAD_IDENTITY_POOL_ID}" \
    --project="${VERDERY_PROJECT_ID}" \
    --location=global \
    --display-name="GitHub Actions"
fi

if resource_exists gcloud iam workload-identity-pools providers describe "${VERDERY_WORKLOAD_IDENTITY_PROVIDER_ID}" \
  --project="${VERDERY_PROJECT_ID}" --location=global --workload-identity-pool="${VERDERY_WORKLOAD_IDENTITY_POOL_ID}"; then
  log "Workload identity provider already exists: ${VERDERY_WORKLOAD_IDENTITY_PROVIDER_ID}"
else
  log "Creating workload identity provider: ${VERDERY_WORKLOAD_IDENTITY_PROVIDER_ID}"
  gcloud iam workload-identity-pools providers create-oidc "${VERDERY_WORKLOAD_IDENTITY_PROVIDER_ID}" \
    --project="${VERDERY_PROJECT_ID}" \
    --location=global \
    --workload-identity-pool="${VERDERY_WORKLOAD_IDENTITY_POOL_ID}" \
    --display-name="GitHub Actions OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${VERDERY_GITHUB_REPOSITORY}'"
fi

principal="principal://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${VERDERY_WORKLOAD_IDENTITY_POOL_ID}/subject/repo:${VERDERY_GITHUB_REPOSITORY}:environment:${VERDERY_GITHUB_ENVIRONMENT}"

log "Binding deploy service account to GitHub Environment '${VERDERY_GITHUB_ENVIRONMENT}' in ${VERDERY_GITHUB_REPOSITORY}"
gcloud iam service-accounts add-iam-policy-binding "${deploy_email}" \
  --project="${VERDERY_PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${principal}" \
  >/dev/null

provider_resource="projects/${project_number}/locations/global/workloadIdentityPools/${VERDERY_WORKLOAD_IDENTITY_POOL_ID}/providers/${VERDERY_WORKLOAD_IDENTITY_PROVIDER_ID}"

log "Workload identity federation ready."
log "Provider resource name (put this in the deploy workflow): ${provider_resource}"
log "Deploy service account (put this in the deploy workflow): ${deploy_email}"
log ""
log "REMINDER: create a GitHub Environment named '${VERDERY_GITHUB_ENVIRONMENT}' in ${VERDERY_GITHUB_REPOSITORY}"
log "and reference it with 'environment: ${VERDERY_GITHUB_ENVIRONMENT}' in the deploy job — without it, no token"
log "GitHub issues will carry the 'environment' claim this binding requires, and every deploy will be denied."
