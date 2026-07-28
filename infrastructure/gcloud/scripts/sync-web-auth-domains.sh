#!/usr/bin/env bash
# Synchronizes every public web hostname with the two domain allowlists used
# during browser sign-in:
#
# 1. Firebase Authentication authorized domains, required by OAuth popups.
# 2. The reCAPTCHA Enterprise key used by Firebase App Check.
# 3. The Firebase web app's App Check provider registration.
#
# Cloud Run exposes two official URLs for one service. `status.url` reports
# only one of them, while `run.googleapis.com/urls` reports both. Configuring
# only `status.url` leaves the other valid URL serving a sign-in page whose
# Google/Apple popup fails with `auth/unauthorized-domain`.
#
# Run this after the first web deployment and whenever a custom web domain is
# added or changed. Existing domains in both allowlists are preserved.
#
# Source: architecture/identity-and-authorization.md, section "12. App Check";
# docs/development/infrastructure.md, section "Web authentication domains".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: sync-web-auth-domains.sh <environment> [--check]}"
MODE="${2:-sync}"
[[ "${MODE}" == "sync" || "${MODE}" == "--check" ]] ||
  fail "Unknown mode '${MODE}'. Use no second argument to synchronize, or --check."
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config VERDERY_FIREBASE_WEB_APP_ID

for command in curl jq; do
  command -v "${command}" >/dev/null || fail "Required command is not installed: ${command}"
done

resource_exists gcloud run services describe "${VERDERY_WEB_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" ||
  fail "Cloud Run service does not exist: ${VERDERY_WEB_SERVICE_NAME}"

service_urls_json="$(cloud_run_service_urls_json "${VERDERY_WEB_SERVICE_NAME}")"

web_domains_json="$(
  jq --arg custom_domain "${VERDERY_WEB_DOMAIN:-}" '
    map(
      sub("^https://"; "")
      | sub("/$"; "")
    )
    + ["localhost"]
    + (if $custom_domain == "" then [] else [$custom_domain] end)
    | unique
  ' <<<"${service_urls_json}"
)"

key_display_name="${VERDERY_PROJECT_ID}-web-app-check"
key_name="$(gcloud recaptcha keys list \
  --project="${VERDERY_PROJECT_ID}" \
  --filter="displayName=${key_display_name}" \
  --format="value(name)")"
[[ -n "${key_name}" ]] || fail "No reCAPTCHA Enterprise key named ${key_display_name}"

access_token="$(gcloud auth print-access-token)"
project_number="$(gcloud projects describe "${VERDERY_PROJECT_ID}" --format='value(projectNumber)')"
app_check_config_name="projects/${project_number}/apps/${VERDERY_FIREBASE_WEB_APP_ID}/recaptchaEnterpriseConfig"
identity_config="$(
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-user-project: ${VERDERY_PROJECT_ID}" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/${VERDERY_PROJECT_ID}/config"
)"
app_check_config="$(
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-user-project: ${VERDERY_PROJECT_ID}" \
    "https://firebaseappcheck.googleapis.com/v1/${app_check_config_name}"
)"

recaptcha_config="$(
  gcloud recaptcha keys describe "$(basename "${key_name}")" \
    --project="${VERDERY_PROJECT_ID}" \
    --format=json
)"

recaptcha_domains_json="$(
  jq --argjson web_domains "${web_domains_json}" '
    (.webSettings.allowedDomains // []) + $web_domains | unique
  ' <<<"${recaptcha_config}"
)"
recaptcha_domains="$(jq -r 'join(",")' <<<"${recaptcha_domains_json}")"

missing_recaptcha_domains="$(
  jq --argjson expected "${web_domains_json}" '
    $expected - (.webSettings.allowedDomains // [])
  ' <<<"${recaptcha_config}"
)"
missing_authorized_domains="$(
  jq --argjson expected "${web_domains_json}" '
    $expected - (.authorizedDomains // [])
  ' <<<"${identity_config}"
)"

if [[ "${MODE}" == "--check" ]]; then
  [[ "$(jq 'length' <<<"${missing_recaptcha_domains}")" == "0" ]] ||
    fail "reCAPTCHA is missing web domains: ${missing_recaptcha_domains}"
  [[ "$(jq 'length' <<<"${missing_authorized_domains}")" == "0" ]] ||
    fail "Firebase Authentication is missing web domains: ${missing_authorized_domains}"
  [[ "$(jq -r '.siteKey // ""' <<<"${app_check_config}")" == "$(basename "${key_name}")" ]] ||
    fail "Firebase App Check is not registered with the expected reCAPTCHA site key"
  log "Web authentication domains and App Check provider are synchronized"
  exit 0
fi

log "Synchronizing reCAPTCHA domains: ${recaptcha_domains}"
gcloud recaptcha keys update "$(basename "${key_name}")" \
  --project="${VERDERY_PROJECT_ID}" \
  --web \
  --domains="${recaptcha_domains}" \
  >/dev/null

authorized_domains_json="$(
  jq --argjson web_domains "${web_domains_json}" '
    (.authorizedDomains // []) + $web_domains | unique
  ' <<<"${identity_config}"
)"
patch_body="$(jq -n --argjson domains "${authorized_domains_json}" '{authorizedDomains: $domains}')"

log "Synchronizing Firebase Authentication authorized domains"
updated_config="$(
  curl --fail-with-body --silent --show-error \
    --request PATCH \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-user-project: ${VERDERY_PROJECT_ID}" \
    -H "content-type: application/json" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/${VERDERY_PROJECT_ID}/config?updateMask=authorizedDomains" \
    --data-binary "${patch_body}"
)"

app_check_patch_body="$(
  jq -n \
    --arg name "${app_check_config_name}" \
    --arg site_key "$(basename "${key_name}")" \
    '{name: $name, siteKey: $site_key}'
)"
log "Synchronizing the Firebase App Check web provider"
updated_app_check_config="$(
  curl --fail-with-body --silent --show-error \
    --request PATCH \
    -H "Authorization: Bearer ${access_token}" \
    -H "x-goog-user-project: ${VERDERY_PROJECT_ID}" \
    -H "content-type: application/json" \
    "https://firebaseappcheck.googleapis.com/v1/${app_check_config_name}?updateMask=siteKey" \
    --data-binary "${app_check_patch_body}"
)"

missing_domains="$(
  jq --argjson expected "${web_domains_json}" '
    $expected - (.authorizedDomains // [])
  ' <<<"${updated_config}"
)"
if [[ "$(jq 'length' <<<"${missing_domains}")" != "0" ]]; then
  fail "Identity Platform did not retain every web domain: ${missing_domains}"
fi

verified_recaptcha_config="$(
  gcloud recaptcha keys describe "$(basename "${key_name}")" \
    --project="${VERDERY_PROJECT_ID}" \
    --format=json
)"
missing_recaptcha_domains="$(
  jq --argjson expected "${web_domains_json}" '
    $expected - (.webSettings.allowedDomains // [])
  ' <<<"${verified_recaptcha_config}"
)"
if [[ "$(jq 'length' <<<"${missing_recaptcha_domains}")" != "0" ]]; then
  fail "reCAPTCHA did not retain every web domain: ${missing_recaptcha_domains}"
fi
[[ "$(jq -r '.siteKey // ""' <<<"${updated_app_check_config}")" == "$(basename "${key_name}")" ]] ||
  fail "Firebase App Check did not retain the reCAPTCHA site key"

log "Web authentication domains and App Check provider are synchronized:"
jq -r '.[] | " - " + .' <<<"${web_domains_json}"
