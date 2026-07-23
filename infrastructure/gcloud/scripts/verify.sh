#!/usr/bin/env bash
# Read-only check of what actually exists for one environment, independent of
# whatever the provisioning scripts most recently claimed to do.
#
# Nothing here mutates state. A failed check names the missing resource rather
# than the script step that should have created it, since drift can happen
# outside these scripts too (a console change, a manual `gcloud` command).

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: verify.sh <environment>}"
load_environment_config "${ENVIRONMENT}"

FAILURES=0

check() {
  local description="${1}"
  shift

  if "$@" >/dev/null 2>&1; then
    printf '  OK    %s\n' "${description}"
  else
    printf '  FAIL  %s\n' "${description}"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "Verifying ${VERDERY_ENVIRONMENT} (${VERDERY_PROJECT_ID})"
echo

check "project exists and billing is linked" bash -c \
  "[[ \$(gcloud billing projects describe '${VERDERY_PROJECT_ID}' --format='value(billingEnabled)') == True ]]"

check "network exists" gcloud compute networks describe "${VERDERY_NETWORK_NAME}" --project="${VERDERY_PROJECT_ID}"

check "Cloud SQL instance is running" bash -c \
  "[[ \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(state)') == RUNNABLE ]]"

check "Cloud SQL has no public IP" bash -c \
  "[[ -z \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(ipAddresses[?type=PRIMARY].ipAddress)') ]]"

check "Cloud SQL IAM authentication is on" bash -c \
  "gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(settings.databaseFlags)' | grep -q \"'name': 'cloudsql.iam_authentication', 'value': 'on'\""

check "Artifact Registry repository exists" gcloud artifacts repositories describe "${VERDERY_ARTIFACT_REPOSITORY}" \
  --project="${VERDERY_PROJECT_ID}" --location="${VERDERY_REGION}"

check "deploy service account exists" gcloud iam service-accounts describe \
  "${VERDERY_DEPLOY_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" --project="${VERDERY_PROJECT_ID}"

check "runtime service account exists" gcloud iam service-accounts describe \
  "${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" --project="${VERDERY_PROJECT_ID}"

check "workload identity provider exists" gcloud iam workload-identity-pools providers describe \
  "${VERDERY_WORKLOAD_IDENTITY_PROVIDER_ID}" --project="${VERDERY_PROJECT_ID}" --location=global \
  --workload-identity-pool="${VERDERY_WORKLOAD_IDENTITY_POOL_ID}"

check "Cloud Run service exists" gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"

check "App Check reCAPTCHA Enterprise key exists" bash -c \
  "[[ -n \$(gcloud recaptcha keys list --project='${VERDERY_PROJECT_ID}' --filter='displayName=${VERDERY_PROJECT_ID}-web-app-check' --format='value(name)') ]]"

# Media buckets: existence, uniform bucket-level access, and public access
# prevention, for all four. Lifecycle configuration is not re-verified here
# by content (bucket-level checks confirm presence, not the exact JSON) —
# `gcloud storage buckets describe --format=json` includes the applied
# `lifecycle` field for anyone who needs to inspect it by hand.
for bucket in \
  "${VERDERY_USER_MEDIA_BUCKET}" \
  "${VERDERY_RAW_CAPTURE_BUCKET}" \
  "${VERDERY_DERIVED_BUCKET}" \
  "${VERDERY_EXPORTS_BUCKET}"; do
  check "bucket exists: ${bucket}" gcloud storage buckets describe "gs://${bucket}" --project="${VERDERY_PROJECT_ID}"
  check "uniform bucket-level access enabled: ${bucket}" bash -c \
    "[[ \$(gcloud storage buckets describe 'gs://${bucket}' --project='${VERDERY_PROJECT_ID}' --format='value(uniform_bucket_level_access)') == True ]]"
  check "public access prevention enforced: ${bucket}" bash -c \
    "[[ \$(gcloud storage buckets describe 'gs://${bucket}' --project='${VERDERY_PROJECT_ID}' --format='value(public_access_prevention)') == enforced ]]"
done

echo
if [[ "${FAILURES}" -eq 0 ]]; then
  echo "All checks passed."
else
  echo "${FAILURES} check(s) failed."
  exit 1
fi
