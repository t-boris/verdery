#!/usr/bin/env bash
# Creates the GCP project and links billing.
#
# Idempotent: if the project already exists and billing is already linked,
# this script only verifies and exits.
#
# Source: implementation-plan.md work package P1-PLAT-02.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 00-create-project.sh <environment>}"
load_environment_config "${ENVIRONMENT}"

if gcloud projects describe "${VERDERY_PROJECT_ID}" >/dev/null 2>&1; then
  log "Project already exists: ${VERDERY_PROJECT_ID}"
else
  log "Creating project: ${VERDERY_PROJECT_ID}"
  gcloud projects create "${VERDERY_PROJECT_ID}" --name="${VERDERY_PROJECT_NAME}"
fi

gcloud config set project "${VERDERY_PROJECT_ID}" >/dev/null

current_billing="$(gcloud billing projects describe "${VERDERY_PROJECT_ID}" --format="value(billingAccountName)" 2>/dev/null || true)"
expected_billing="billingAccounts/${VERDERY_BILLING_ACCOUNT_ID}"

if [[ "${current_billing}" == "${expected_billing}" ]]; then
  log "Billing already linked: ${expected_billing}"
else
  log "Linking billing account: ${VERDERY_BILLING_ACCOUNT_ID}"
  gcloud billing projects link "${VERDERY_PROJECT_ID}" --billing-account="${VERDERY_BILLING_ACCOUNT_ID}"
fi

log "Project ${VERDERY_PROJECT_ID} ready with billing ${VERDERY_BILLING_ACCOUNT_ID}."
