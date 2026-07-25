#!/usr/bin/env bash
# Restricts both Cloud Run services to load-balancer and internal traffic, and
# verifies that the load balancer path still works before and after.
#
# SCOPE BOUNDARY: DRAFTED AND SYNTAX-CHECKED (`bash -n`), NOT executed against
# any project.
#
# ---------------------------------------------------------------------------
# THIS IS THE STEP THAT ACTUALLY REMOVES PUBLIC REACHABILITY
#
# Both services currently run `--ingress=all` with an `allUsers` invoker
# binding — verified live on 2026-07-25 against verdery-dev, which is what the
# runbooks' section 1 records. The load balancer and Cloud Armor added by the
# two previous scripts protect a NEW path; until this one runs, the old path is
# still open and every rule in 12-cloud-armor.sh is one `curl` at a
# `*.run.app` URL away from being irrelevant.
#
# `internal-and-cloud-load-balancing` admits:
#   - requests forwarded by an external Application Load Balancer in this
#     project (the whole point), and
#   - internal traffic: this project's VPC network, and the Google Cloud
#     services that call Cloud Run in-project.
# It rejects everything else at the network layer, BEFORE IAM, so a direct
# request to the generated service URL fails without ever reaching the
# container. That, and not the IAM binding, is what closes `T-COST-01` and the
# `*.run.app` half of `T-SSRF-06`.
#
# ---------------------------------------------------------------------------
# WHY `allUsers` STAYS, WHICH LOOKS WRONG AND IS NOT
#
# The threat model lists "allUsers on both services" as a gap, and the obvious
# reading is "remove the binding". Doing that here would break the site.
#
# A serverless NEG backend forwards requests to Cloud Run WITHOUT minting an
# identity token. There is no service account behind the load balancer to grant
# `roles/run.invoker` to. Remove `allUsers` and every request through the load
# balancer gets a 403 — the only supported way to require authentication in
# front of a serverless NEG is Identity-Aware Proxy, which is an interactive
# Google sign-in gate and cannot front a consumer product with its own identity
# system.
#
# So the honest statement of the control is: reachability is enforced at the
# network layer by ingress, and the `allUsers` binding becomes inert because
# the only network path that can exercise it is the load balancer, which sits
# behind Cloud Armor. This script prints exactly that, so the next person to
# read `gcloud run services get-iam-policy` and find `allUsers` does not
# "fix" it.
#
# ---------------------------------------------------------------------------
# THE ONE THING TO VERIFY BEFORE THE WORKERS SERVICE EXISTS
#
# `services/workers` calls nine `/v1/internal/*` endpoints on the API, using
# the API's `*.run.app` URL as both destination and OIDC audience
# (`MEDIA_PROCESSING_CALLBACK_AUDIENCE` in deploy-api.sh, and the four
# startup-validated URLs in services/workers/src/configuration.ts). After this
# script runs, that URL is only reachable from inside — which is the intent,
# but "inside" has a precise meaning worth confirming rather than assuming.
#
# Cloud Run's `internal` ingress admits same-project traffic that arrives
# through the VPC network, and in-project Google Cloud callers such as Cloud
# Tasks. `deploy-workers.sh` deploys with `--vpc-egress=private-ranges-only`,
# which sends RFC1918 destinations through the VPC and everything else,
# including a `*.run.app` hostname, straight out. So the worker's direct HTTP
# calls to the API are the one path that could break here.
#
# This has not been observed either way: `verdery-workers` has never been
# deployed to any environment (runbooks.md section 1.1), so there is no live
# behaviour to report and this script does not pretend otherwise. Before the
# workers service is first deployed to production, confirm the path with one
# request and, if it is refused, pick one of two documented fixes:
#
#   a. Deploy the workers service with `--vpc-egress=all-traffic`, which routes
#      its `*.run.app` calls through the VPC. This is the direct fix and its
#      cost is that all other outbound traffic then needs Cloud NAT —
#      networking.md section 13 requires a "cost, cold-start, capacity, and
#      availability review" before adding one. Today that cost is theoretical:
#      the provider registry has zero registrations, so the workers make no
#      third-party calls at all.
#   b. Route the affected calls through Cloud Tasks, which `internal` ingress
#      admits in-project without any VPC change. The media-processing path
#      already works this way; the four interval sweeps do not.
#
# Neither is chosen here, because choosing between them without a deployed
# workers service to measure would be a guess written down as a decision.
#
# ---------------------------------------------------------------------------
# WHAT BREAKS IF THIS IS RUN AT THE WRONG TIME
#
# Everything. Until DNS resolves and the managed certificate is ACTIVE, the
# load balancer is not a working path, and this script removes the only other
# one. The preflight below refuses to proceed unless the certificate is ACTIVE
# and both hostnames answer. Reversal is a one-line `gcloud run services
# update --ingress=all` per service and takes about thirty seconds.
#
# DOWNTIME: none if the preflight passes, because the load balancer path is
# already serving before ingress changes. Any client still hardcoding a
# `*.run.app` URL loses access immediately and permanently — that is the
# intent, and `apps/web` in production must therefore be built without
# `API_PROXY_ORIGIN` (see 11-load-balancer.sh's header) and `apps/ios` must
# point at `https://api.<domain>`.
#
# COST: none.
#
# Idempotent: reads the current ingress setting and only updates a service
# whose value differs, so a re-run creates no revision and causes no churn.
#
# Source: implementation-plan.md work package P8-NET-01;
# architecture/networking.md section 7 ("Cloud Run Ingress" — "Default service
# URLs are disabled or restricted when the load-balancer-only path is
# enforced"); development/threat-model.md sections 13, 15.5, 15.9.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 13-cloud-run-ingress.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config VERDERY_WEB_DOMAIN VERDERY_API_DOMAIN VERDERY_CLOUD_RUN_INGRESS
require_explicit_apply \
  "removes public access to the *.run.app service URLs, leaving the load balancer as the only way in."

# --- preflight: the replacement path must already work ----------------------
certificate_status="$(gcloud compute ssl-certificates describe "${VERDERY_LB_CERTIFICATE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global --format="value(managed.status)" 2>/dev/null || true)"

[[ "${certificate_status}" == "ACTIVE" ]] || fail \
  "Managed certificate ${VERDERY_LB_CERTIFICATE_NAME} is '${certificate_status:-missing}', not ACTIVE. Point DNS at the load balancer and wait; running now would take the site offline."

check_host_serves() {
  local host="${1}" path="${2}" status

  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${host}${path}" || true)"
  [[ "${status}" =~ ^(2|3)[0-9][0-9]$ ]] || fail \
    "https://${host}${path} returned '${status}'. The load balancer path is not serving yet; running now would take the site offline."
  log "Preflight OK: https://${host}${path} -> ${status}"
}

# The API's readiness probe through BOTH hostnames, because the whole point of
# 11-load-balancer.sh's path matcher is that `app.<domain>/v1/*` reaches the
# API. If only `api.<domain>` works, the browser is about to lose its API.
check_host_serves "${VERDERY_API_DOMAIN}" "/v1/health/ready"
check_host_serves "${VERDERY_WEB_DOMAIN}" "/v1/health/ready"
check_host_serves "${VERDERY_WEB_DOMAIN}" "/"

# --- apply ------------------------------------------------------------------
restrict_ingress() {
  local service_name="${1}"
  local current

  current="$(gcloud run services describe "${service_name}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" \
    --format='value(metadata.annotations["run.googleapis.com/ingress"])')"

  if [[ "${current}" == "${VERDERY_CLOUD_RUN_INGRESS}" ]]; then
    log "Ingress already ${VERDERY_CLOUD_RUN_INGRESS}: ${service_name}"
    return
  fi

  log "Setting ingress ${current} -> ${VERDERY_CLOUD_RUN_INGRESS}: ${service_name}"
  gcloud run services update "${service_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --ingress="${VERDERY_CLOUD_RUN_INGRESS}" \
    --quiet \
    >/dev/null
}

restrict_ingress "${VERDERY_CLOUD_RUN_SERVICE_NAME}"
restrict_ingress "${VERDERY_WEB_SERVICE_NAME}"

# The workers service is included when it exists. It is an internal Cloud Run
# service that no browser and no external client should ever reach; it is
# invoked by Cloud Tasks, which counts as internal in-project traffic. It has
# never been deployed to any environment (runbooks section 1.1), so this is a
# conditional rather than a hard requirement.
if resource_exists gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  # `internal` and not `internal-and-cloud-load-balancing`: no load balancer
  # backend points at the workers service, so admitting load-balancer traffic
  # would widen the surface for nothing.
  current_workers_ingress="$(gcloud run services describe "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" \
    --format='value(metadata.annotations["run.googleapis.com/ingress"])')"
  if [[ "${current_workers_ingress}" == "internal" ]]; then
    log "Ingress already internal: ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}"
  else
    log "Setting ingress ${current_workers_ingress} -> internal: ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}"
    gcloud run services update "${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" \
      --region="${VERDERY_REGION}" \
      --ingress=internal \
      --quiet \
      >/dev/null
  fi
else
  log "Workers service ${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME} does not exist; nothing to restrict."
fi

# --- verify the bypass is actually closed -----------------------------------
# networking.md section 21 requires testing "Production ingress bypass
# attempts" and "Direct Cloud Run URL restrictions". Asserting it here, in the
# script that creates the condition, is the cheapest place for that test to
# live and the only place it cannot be forgotten.
assert_run_url_rejected() {
  local service_name="${1}" url status

  url="$(gcloud run services describe "${service_name}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${url}/" || true)"

  if [[ "${status}" == "200" ]]; then
    fail "${url} still answers 200. Ingress restriction did not take effect for ${service_name}."
  fi
  log "Bypass closed: ${url} -> ${status}"
}

assert_run_url_rejected "${VERDERY_CLOUD_RUN_SERVICE_NAME}"
assert_run_url_rejected "${VERDERY_WEB_SERVICE_NAME}"

log ""
log "Ingress restricted. The load balancer is now the only public path."
log ""
log "The 'allUsers' invoker binding on both services is INTENTIONALLY LEFT IN"
log "PLACE. A serverless NEG forwards requests without an identity token, so"
log "removing it returns 403 for every request through the load balancer. The"
log "control is the ingress setting above, not the IAM policy — see this"
log "script's header before 'fixing' what get-iam-policy reports."
log ""
log "Rollback, if the load balancer path fails after this point:"
log "  gcloud run services update ${VERDERY_CLOUD_RUN_SERVICE_NAME} --project=${VERDERY_PROJECT_ID} --region=${VERDERY_REGION} --ingress=all"
log "  gcloud run services update ${VERDERY_WEB_SERVICE_NAME} --project=${VERDERY_PROJECT_ID} --region=${VERDERY_REGION} --ingress=all"
