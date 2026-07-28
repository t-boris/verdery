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

if resource_exists gcloud run services describe "${VERDERY_WEB_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  check "every web hostname is authorized for Firebase Auth and App Check" \
    bash sync-web-auth-domains.sh "${ENVIRONMENT}" --check
fi

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

# P6-ASYNC-01: the relay's own service account and Cloud Tasks queue.
check "worker service account exists" gcloud iam service-accounts describe \
  "${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" --project="${VERDERY_PROJECT_ID}"

check "media-processing Cloud Tasks queue exists" gcloud tasks queues describe \
  "${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}" --project="${VERDERY_PROJECT_ID}" --location="${VERDERY_REGION}"

# P8-DB-01: the database posture reliability-and-disaster-recovery.md section 6
# requires. These run in EVERY environment, including development, because the
# point of this file is to report what is actually true rather than what the
# environment is entitled to. Development is expected to FAIL the first two —
# it is a zonal db-f1-micro instance with deletion protection off — and that
# visible failure is more useful than a check that quietly skips itself.
check "Cloud SQL availability type is ${VERDERY_SQL_AVAILABILITY_TYPE:-ZONAL}" bash -c \
  "[[ \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(settings.availabilityType)') == '${VERDERY_SQL_AVAILABILITY_TYPE:-ZONAL}' ]]"

check "Cloud SQL deletion protection is on" bash -c \
  "[[ \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(settings.deletionProtectionEnabled)') == True ]]"

check "Cloud SQL automated backups are enabled" bash -c \
  "[[ \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(settings.backupConfiguration.enabled)') == True ]]"

check "Cloud SQL point-in-time recovery is enabled" bash -c \
  "[[ \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(settings.backupConfiguration.pointInTimeRecoveryEnabled)') == True ]]"

# `storageAutoResizeLimit: 0` means UNCAPPED, which is the one value
# reliability-and-disaster-recovery.md section 6 ("maximum-cost review") rules
# out. A non-zero value is the whole assertion.
check "Cloud SQL storage auto-increase has a ceiling" bash -c \
  "[[ \$(gcloud sql instances describe '${VERDERY_SQL_INSTANCE_NAME}' --project='${VERDERY_PROJECT_ID}' --format='value(settings.storageAutoResizeLimit)') != 0 ]]"

# P8-NET-01: the edge. Each check is skipped, loudly, in an environment that
# has not chosen a domain — dev has no load balancer to verify and reporting
# eight FAILs there would train the reader to ignore this file.
if [[ -n "${VERDERY_WEB_DOMAIN:-}" ]]; then
  echo
  echo "Edge (P8-NET-01):"

  check "managed certificate is ACTIVE" bash -c \
    "[[ \$(gcloud compute ssl-certificates describe '${VERDERY_LB_CERTIFICATE_NAME}' --project='${VERDERY_PROJECT_ID}' --global --format='value(managed.status)') == ACTIVE ]]"

  check "URL map exists" gcloud compute url-maps describe "${VERDERY_LB_URL_MAP_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --global

  check "Cloud Armor policy exists" gcloud compute security-policies describe \
    "${VERDERY_ARMOR_POLICY_NAME}" --project="${VERDERY_PROJECT_ID}"

  check "Cloud Armor is attached to the API backend" bash -c \
    "gcloud compute backend-services describe '${VERDERY_LB_API_BACKEND_NAME}' --project='${VERDERY_PROJECT_ID}' --global --format='value(securityPolicy)' | grep -q '${VERDERY_ARMOR_POLICY_NAME}'"

  check "Cloud Armor is attached to the web backend" bash -c \
    "gcloud compute backend-services describe '${VERDERY_LB_WEB_BACKEND_NAME}' --project='${VERDERY_PROJECT_ID}' --global --format='value(securityPolicy)' | grep -q '${VERDERY_ARMOR_POLICY_NAME}'"

  for service in "${VERDERY_CLOUD_RUN_SERVICE_NAME}" "${VERDERY_WEB_SERVICE_NAME}"; do
    check "Cloud Run ingress is restricted: ${service}" bash -c \
      "[[ \$(gcloud run services describe '${service}' --project='${VERDERY_PROJECT_ID}' --region='${VERDERY_REGION}' --format='value(metadata.annotations[\"run.googleapis.com/ingress\"])') == '${VERDERY_CLOUD_RUN_INGRESS}' ]]"
  done

  # networking.md section 21 lists "Production ingress bypass attempts" and
  # "Direct Cloud Run URL restrictions" as things to TEST, not merely to
  # configure. Any answer other than 200 means the bypass is closed.
  check "direct *.run.app URL is not publicly reachable" bash -c \
    "[[ \$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \"\$(gcloud run services describe '${VERDERY_CLOUD_RUN_SERVICE_NAME}' --project='${VERDERY_PROJECT_ID}' --region='${VERDERY_REGION}' --format='value(status.url)')/\") != 200 ]]"

  # `/v1/internal/*` must be refused at the edge on BOTH hostnames. A 404 from
  # rule 1000 is indistinguishable from a missing route, which is the point.
  for host in "${VERDERY_API_DOMAIN}" "${VERDERY_WEB_DOMAIN}"; do
    check "/v1/internal/* is refused at ${host}" bash -c \
      "[[ \$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST 'https://${host}/v1/internal/deletion/sweep') != 200 ]]"
  done
else
  echo
  echo "  SKIP  edge checks (VERDERY_WEB_DOMAIN is unset: this environment has no load balancer)"
fi

echo
if [[ "${FAILURES}" -eq 0 ]]; then
  echo "All checks passed."
else
  echo "${FAILURES} check(s) failed."
  exit 1
fi
