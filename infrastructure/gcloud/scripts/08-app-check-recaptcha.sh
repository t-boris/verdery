#!/usr/bin/env bash
# Creates the reCAPTCHA Enterprise key the web client uses to obtain Firebase
# App Check tokens (ReCaptchaEnterpriseProvider). A reCAPTCHA site key is a
# public per-site identifier, not a secret — the same reasoning
# apps/web/core/auth/firebase-app.ts documents for the Firebase apiKey — so
# this script prints it for the developer to place in apps/web/.env.example
# rather than writing it to Secret Manager.
#
# Idempotent: re-running finds the existing key by display name instead of
# creating a duplicate.
#
# Scoped to `localhost` only. The web app has no deployed domain yet — see
# docs/development/deferred-capabilities.md — so a production domain is
# added to this key's allowlist when the web app is actually deployed,
# not invented here.
#
# Source: implementation-plan.md work package P2-APPCHK-01;
# architecture/identity-and-authorization.md, section "12. App Check".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 08-app-check-recaptcha.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

enable_api_if_needed recaptchaenterprise.googleapis.com

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

log "Site key: ${site_key}"
log ""
log "Not a secret — put it in apps/web/.env.example (and this developer's"
log "apps/web/.env.local) as:"
log ""
log "  NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=${site_key}"
