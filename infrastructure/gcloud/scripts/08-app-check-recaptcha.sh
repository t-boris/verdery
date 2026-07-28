#!/usr/bin/env bash
# Creates the reCAPTCHA Enterprise key the web client uses to obtain Firebase
# App Check tokens (ReCaptchaEnterpriseProvider), then registers that key on
# the Firebase web app. A reCAPTCHA site key is a public per-site identifier,
# not a secret — the same reasoning
# apps/web/core/auth/firebase-app.ts documents for the Firebase apiKey — so
# this script prints it for the developer to place in apps/web/.env.example
# rather than writing it to Secret Manager.
#
# Idempotent: re-running finds the existing key by display name instead of
# creating a duplicate and reapplies the same Firebase provider registration.
#
# Initially scoped to `localhost`. After the first web deployment,
# sync-web-auth-domains.sh replaces that bootstrap allowlist with localhost,
# every official Cloud Run URL alias, and the configured custom domain.
#
# Source: implementation-plan.md work package P2-APPCHK-01;
# architecture/identity-and-authorization.md, section "12. App Check".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 08-app-check-recaptcha.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config VERDERY_FIREBASE_WEB_APP_ID

enable_api_if_needed recaptchaenterprise.googleapis.com
enable_api_if_needed firebaseappcheck.googleapis.com

for command in curl jq; do
  command -v "${command}" >/dev/null || fail "Required command is not installed: ${command}"
done

key_display_name="${VERDERY_PROJECT_ID}-web-app-check"

existing_key_name="$(gcloud recaptcha keys list \
  --project="${VERDERY_PROJECT_ID}" \
  --filter="displayName=${key_display_name}" \
  --format="value(name)")"

if [[ -n "${existing_key_name}" ]]; then
  log "reCAPTCHA Enterprise key already exists: ${key_display_name}"
  site_key="$(basename "${existing_key_name}")"
else
  log "Creating reCAPTCHA Enterprise key: ${key_display_name}"
  site_key="$(gcloud recaptcha keys create \
    --project="${VERDERY_PROJECT_ID}" \
    --display-name="${key_display_name}" \
    --web \
    --domains="localhost" \
    --integration-type=score \
    --format="value(name.basename())")"
fi

project_number="$(gcloud projects describe "${VERDERY_PROJECT_ID}" --format='value(projectNumber)')"
app_check_config_name="projects/${project_number}/apps/${VERDERY_FIREBASE_WEB_APP_ID}/recaptchaEnterpriseConfig"
access_token="$(gcloud auth print-access-token)"
patch_body="$(
  jq -n \
    --arg name "${app_check_config_name}" \
    --arg site_key "${site_key}" \
    '{name: $name, siteKey: $site_key}'
)"

log "Registering the reCAPTCHA key on Firebase web app ${VERDERY_FIREBASE_WEB_APP_ID}"
app_check_config="$(
  curl --fail-with-body --silent --show-error \
    --request PATCH \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-user-project: ${VERDERY_PROJECT_ID}" \
    -H "content-type: application/json" \
    "https://firebaseappcheck.googleapis.com/v1/${app_check_config_name}?updateMask=siteKey" \
    --data-binary "${patch_body}"
)"
[[ "$(jq -r '.siteKey // ""' <<<"${app_check_config}")" == "${site_key}" ]] ||
  fail "Firebase App Check did not retain the reCAPTCHA site key"

log "Site key: ${site_key}"
log ""
log "Not a secret — put it in apps/web/.env.example (and this developer's"
log "apps/web/.env.local) as:"
log ""
log "  NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=${site_key}"
log ""
log "After the first web deployment, run:"
log ""
log "  bash sync-web-auth-domains.sh ${ENVIRONMENT}"
