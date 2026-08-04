#!/usr/bin/env bash
# Deploys the web client to Cloud Run.
#
# Mirrors deploy-api.sh's shape (a release action, used identically by a human
# and by CI). The web container is stateless and needs NO runtime environment:
# every NEXT_PUBLIC_* value is baked into the bundle at image build time — the
# build happens in CI (or locally) via apps/web/Dockerfile build args; this
# script only deploys an already-built image.
#
# Source: implementation-plan.md Phase 8 (web deployment stage); the owner's
# explicit requirement that Phase 8 ends with a clickable web URL.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: deploy-web.sh <environment> <image>}"
IMAGE="${2:?usage: deploy-web.sh <environment> <image>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

log "Deploying ${IMAGE} to ${VERDERY_WEB_SERVICE_NAME}"
# P8-NET-01: `--ingress` and `--max-instances` come from <environment>.env and
# default to exactly what this script did before (`all`, 2 instances), so dev
# is unchanged. Production sets `internal-and-cloud-load-balancing`; passing
# the flag on every deploy is what stops a later deploy from silently
# reopening the public `*.run.app` path that 13-cloud-run-ingress.sh closed.
#
# A production web IMAGE additionally differs from the development one in a way
# no script here controls: it must be built WITHOUT `API_PROXY_ORIGIN`. Behind
# the load balancer the URL map routes `app.<domain>/v1/*` straight to the API
# backend, so the Next.js rewrite is both unnecessary and the second of the two
# public routes to `/v1/internal/*` that threat-model.md's T-SSRF-06 counts.
# `NEXT_PUBLIC_API_ORIGIN=same-origin` still applies — the browser keeps
# calling relative `/v1/...` URLs, and the load balancer, not the web server,
# is what delivers them to the API.
# A dedicated ZERO-permission identity (05-service-accounts.sh): omitting
# --service-account made Cloud Run default to the compute default SA, which
# the deployer deliberately cannot actAs — the first deploy failed on exactly
# that, live. The web server calls no Google API, so an empty identity is
# both the fix and the least-privilege answer in one.
gcloud run deploy "${VERDERY_WEB_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --image="${IMAGE}" \
  --service-account="${VERDERY_WEB_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" \
  --min-instances=0 \
  --max-instances="${VERDERY_WEB_MAX_INSTANCES:-2}" \
  --cpu=1 \
  --memory=512Mi \
  --port=8080 \
  --allow-unauthenticated \
  --ingress="${VERDERY_CLOUD_RUN_INGRESS:-all}" \
  --quiet

service_url="$(gcloud run services describe "${VERDERY_WEB_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"

# The API deploy normally discovers the web origins itself. On the first-ever
# environment deployment, however, the API necessarily deploys before the web
# service exists, so there are no origins to discover yet. Close that bootstrap
# gap here, and repair later drift, without creating an API revision when the
# value is already correct.
if resource_exists gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  command -v jq >/dev/null || fail "Required command is not installed: jq"
  # EVERY origin the browser can reach, not just the preferred one.
  #
  # This used to send the custom domain ALONE whenever one was configured,
  # which quietly half-broke the Cloud Run aliases: they stay reachable and
  # are what a developer actually opens, but the API refused them. The visible
  # damage was not CORS on the API — the web proxies `/v1` same-origin, so
  # nothing there noticed — it was MEDIA UPLOAD. `GcsMediaStorageGateway` binds
  # a resumable session to the browser origin only when that origin is already
  # trusted, so an unlisted alias produced sessions with no
  # `Access-Control-Allow-Origin`, and every upload from it died as an
  # unexplained "network problem".
  #
  # The same rule `sync-web-auth-domains.sh` already applies to Firebase and
  # reCAPTCHA domains: discover every alias, and add the custom domain to them.
  desired_api_origins="$(cloud_run_service_origins_csv "${VERDERY_WEB_SERVICE_NAME}")"
  if [[ -n "${VERDERY_WEB_DOMAIN:-}" ]]; then
    desired_api_origins="https://${VERDERY_WEB_DOMAIN},${desired_api_origins}"
  fi

  api_description="$(gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --format=json)"
  current_api_origins="$(jq -r '
    .spec.template.spec.containers[0].env
    | map(select(.name == "HTTP_ALLOWED_ORIGINS"))
    | first
    | .value // ""
  ' <<<"${api_description}")"

  if [[ "${current_api_origins}" == "${desired_api_origins}" ]]; then
    log "API browser origins already match every deployed web origin"
  else
    log "Synchronizing API browser origins: ${desired_api_origins}"
    gcloud run services update "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" \
      --region="${VERDERY_REGION}" \
      --update-env-vars="^#^HTTP_ALLOWED_ORIGINS=${desired_api_origins}" \
      --quiet \
      >/dev/null
  fi
fi

log "Deployed. Web URL: ${service_url}"
log ""
log "Reminders for a FIRST deployment (each is a separate, deliberate action):"
log " - API CORS is synchronized automatically above and on every API deploy."
log " - The user-media bucket CORS must include every web origin for browser uploads"
log "   (infrastructure/gcloud/config/cors/user-media-cors.json + 09-media-storage.sh)."
log " - Synchronize BOTH official Cloud Run aliases with Firebase Auth and"
log "   reCAPTCHA App Check, or OAuth sign-in works on one alias and fails on"
log "   the other:"
log "   bash sync-web-auth-domains.sh ${ENVIRONMENT}"
