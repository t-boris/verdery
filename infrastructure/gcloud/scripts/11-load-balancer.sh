#!/usr/bin/env bash
# Creates the global external HTTPS load balancer that fronts both Cloud Run
# services: a static global IP, two serverless network endpoint groups, two
# backend services, one Google-managed TLS certificate covering both hostnames,
# a host- and path-routing URL map, and an HTTP listener that does nothing but
# redirect to HTTPS.
#
# SCOPE BOUNDARY: this script is DRAFTED AND SYNTAX-CHECKED (`bash -n`) and has
# NOT been executed against any project. No production project exists. It is
# also the first script in this directory that starts a recurring bill on its
# own (see "Cost" below), which is why it calls `require_explicit_apply`.
#
# ---------------------------------------------------------------------------
# WHY A LOAD BALANCER AT ALL
#
# Today both Cloud Run services answer the whole internet on their generated
# `*.run.app` URLs with `--ingress=all` and an `allUsers` invoker binding. The
# threat model registers the consequences: `T-COST-01` (an unauthenticated
# flood; `--max-instances` caps the bill and IS the outage), `T-COST-02`
# (`POST /v1/auth/session` costs a Firebase `verifyIdToken` plus a
# `createSessionCookie` per unauthenticated call, with no throttle), and
# `T-SSRF-06` (`/v1/internal/*` publicly routable). All three name P8-NET-01,
# and all three need one thing first: a chokepoint that is not the Cloud Run
# service itself. This script is that chokepoint; 12-cloud-armor.sh puts rules
# on it and 13-cloud-run-ingress.sh closes the bypass around it.
#
# ---------------------------------------------------------------------------
# THE ROUTING DECISION, WHICH IS THE INTERESTING PART
#
# networking.md section 14 asks for `app.<domain>` and `api.<domain>`. Taken
# naively that is two independent front doors, and it would quietly break two
# things.
#
# 1. The session cookie. `services/api/src/platform/authentication/transport/
#    session-routes.ts` sets it `SameSite=strict` and host-only. That is why
#    Stage 30 had to make the web server proxy `/v1/*` (apps/web/next.config.ts)
#    — on `run.app` the two services are different SITES and the browser
#    neither stored nor sent the cookie. The fix must keep the browser
#    first-party.
# 2. Per-IP rate limiting. If the browser keeps talking to the web service and
#    the web service proxies to the API, then every API request Cloud Armor
#    sees arrives from the web service's single egress address. Every per-IP
#    limit in 12-cloud-armor.sh would share one bucket across all users and be
#    worthless — and an `XFF-IP` key would be trivially spoofable by anyone
#    calling `api.<domain>` directly.
#
# So the URL map routes `app.<domain>/v1/*` to the API backend:
#
#   api.<domain>/*      -> API backend   (the native iOS client; no CORS)
#   app.<domain>/v1/*   -> API backend   (the browser, still first-party)
#   app.<domain>/*      -> web backend
#
# The browser keeps one origin, the cookie design is untouched, Cloud Armor
# sees the real client IP on every API request, and the web server's `/v1/*`
# rewrite is not needed in production at all. That last consequence closes the
# second half of `T-SSRF-06` by construction rather than by a regex the threat
# model itself declined to write blind (section 16.4): the production web image
# is built WITHOUT `API_PROXY_ORIGIN`, so no rewrite is emitted, so there is no
# second route to `/v1/internal/*`. `NEXT_PUBLIC_API_ORIGIN=same-origin` still
# applies — `apps/web/core/api/config.ts` turns that sentinel into a relative
# URL, and the load balancer is what makes the relative URL land on the API.
#
# ---------------------------------------------------------------------------
# COST (us-central1, list price, order of magnitude — confirm before running)
#
#   Global external Application Load Balancer forwarding rule   ~18 USD/month
#   Reserved global IP while attached to a forwarding rule       0 USD
#   Google-managed certificate                                   0 USD
#   Data processing                                             ~0.008-0.012 USD/GB
#
# The forwarding rule charge starts the moment this script finishes, whether or
# not DNS points at it.
#
# DOWNTIME: none. This script only adds a second, parallel path to services
# that keep serving on their existing URLs throughout. The cutover that can
# cause an outage is 13-cloud-run-ingress.sh, deliberately a separate step.
#
# Idempotent: every resource is checked for existence first. Re-running after a
# partial failure resumes where it stopped.
#
# Source: implementation-plan.md work package P8-NET-01;
# architecture/networking.md sections 5, 7, 14, 15;
# architecture/decisions/ADR-0007-us-central1-production-baseline.md;
# development/threat-model.md sections 13 and 15.9 (`T-COST-01`, `T-COST-02`)
# and 15.5 (`T-SSRF-06`).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 11-load-balancer.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config VERDERY_WEB_DOMAIN VERDERY_API_DOMAIN
require_explicit_apply \
  "creates a global HTTPS load balancer, which starts a recurring charge of roughly 18 USD/month."

# Only compute. `gcloud compute ssl-certificates` issues a classic global
# managed certificate through the Compute Engine API; Certificate Manager is a
# different, newer product this does not use, and 01-enable-apis.sh's rule is
# that no API gets enabled without a reason somebody can state later.
enable_api_if_needed compute.googleapis.com

# --- static global address --------------------------------------------------
# Reserved rather than ephemeral because it is the value the owner puts in DNS.
# An ephemeral address is released when the forwarding rule is deleted, and
# every A record in the world would then point at somebody else's load
# balancer.
if resource_exists gcloud compute addresses describe "${VERDERY_LB_ADDRESS_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "Global address already reserved: ${VERDERY_LB_ADDRESS_NAME}"
else
  log "Reserving global address: ${VERDERY_LB_ADDRESS_NAME}"
  gcloud compute addresses create "${VERDERY_LB_ADDRESS_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --ip-version=IPV4
fi

lb_ip="$(gcloud compute addresses describe "${VERDERY_LB_ADDRESS_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global --format="value(address)")"

# --- serverless network endpoint groups -------------------------------------
# A serverless NEG is the only supported way to put Cloud Run behind a global
# load balancer (networking.md section 5, "Serverless network endpoint group
# targeting Cloud Run"). It is regional and free, and it addresses the SERVICE,
# not a revision, so revisions roll underneath it without touching the edge.
create_serverless_neg() {
  local neg_name="${1}" service_name="${2}"

  if resource_exists gcloud compute network-endpoint-groups describe "${neg_name}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
    log "Serverless NEG already exists: ${neg_name}"
    return
  fi

  log "Creating serverless NEG ${neg_name} -> Cloud Run service ${service_name}"
  gcloud compute network-endpoint-groups create "${neg_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --network-endpoint-type=serverless \
    --cloud-run-service="${service_name}"
}

create_serverless_neg "${VERDERY_LB_API_NEG_NAME}" "${VERDERY_CLOUD_RUN_SERVICE_NAME}"
create_serverless_neg "${VERDERY_LB_WEB_NEG_NAME}" "${VERDERY_WEB_SERVICE_NAME}"

# --- backend services -------------------------------------------------------
# `EXTERNAL_MANAGED` is the global external Application Load Balancer scheme
# (the classic `EXTERNAL` scheme is the previous generation and does not
# support the Cloud Armor rule features 12-cloud-armor.sh uses).
#
# Logging is enabled at a 100% sample rate on purpose. Cloud Armor's decisions
# — which rule matched, whether it was a preview rule, which client IP — are
# recorded in the load balancer's request logs and NOWHERE ELSE. Running the
# managed WAF rules in preview mode (12-cloud-armor.sh) is only meaningful if
# somebody can read what they would have blocked. At production traffic
# volumes this is a Cloud Logging cost worth revisiting; at launch volumes it
# is negligible and the visibility is the entire point.
#
# No health check is attached: serverless NEG backends do not take one, because
# Cloud Run reports its own readiness.
create_backend_service() {
  local backend_name="${1}" neg_name="${2}"

  if resource_exists gcloud compute backend-services describe "${backend_name}" \
    --project="${VERDERY_PROJECT_ID}" --global; then
    log "Backend service already exists: ${backend_name}"
  else
    log "Creating backend service: ${backend_name}"
    gcloud compute backend-services create "${backend_name}" \
      --project="${VERDERY_PROJECT_ID}" \
      --global \
      --load-balancing-scheme=EXTERNAL_MANAGED \
      --protocol=HTTPS \
      --enable-logging \
      --logging-sample-rate=1.0
  fi

  if gcloud compute backend-services describe "${backend_name}" \
    --project="${VERDERY_PROJECT_ID}" --global \
    --format="value(backends[].group)" | grep -q "${neg_name}"; then
    log "Backend ${neg_name} already attached to ${backend_name}"
  else
    log "Attaching ${neg_name} to ${backend_name}"
    gcloud compute backend-services add-backend "${backend_name}" \
      --project="${VERDERY_PROJECT_ID}" \
      --global \
      --network-endpoint-group="${neg_name}" \
      --network-endpoint-group-region="${VERDERY_REGION}"
  fi
}

create_backend_service "${VERDERY_LB_API_BACKEND_NAME}" "${VERDERY_LB_API_NEG_NAME}"
create_backend_service "${VERDERY_LB_WEB_BACKEND_NAME}" "${VERDERY_LB_WEB_NEG_NAME}"

# --- managed TLS certificate ------------------------------------------------
# One certificate, both names. networking.md section 5 requires a
# "Google-managed TLS certificate"; section 14 requires the domains to "enforce
# HTTPS and HSTS after validation" — the redirect below is the HTTPS half, and
# both services already send HSTS (`@fastify/helmet` in the API,
# `apps/web/next.config.ts` since the threat model's section 16 fix).
#
# Provisioning does NOT complete until each domain's A record resolves to the
# load balancer's address, and it can take up to an hour after that. The script
# reports PROVISIONING and moves on rather than blocking; verify.sh and the
# README's step list are where the wait is handled.
if resource_exists gcloud compute ssl-certificates describe "${VERDERY_LB_CERTIFICATE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "Managed certificate already exists: ${VERDERY_LB_CERTIFICATE_NAME}"
else
  log "Creating managed certificate for ${VERDERY_WEB_DOMAIN}, ${VERDERY_API_DOMAIN}"
  gcloud compute ssl-certificates create "${VERDERY_LB_CERTIFICATE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --domains="${VERDERY_WEB_DOMAIN},${VERDERY_API_DOMAIN}"
fi

# --- URL map ----------------------------------------------------------------
# The default service is the WEB backend: anything arriving on an unrecognized
# Host header gets the marketing/app surface, never the API.
if resource_exists gcloud compute url-maps describe "${VERDERY_LB_URL_MAP_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "URL map already exists: ${VERDERY_LB_URL_MAP_NAME}"
else
  log "Creating URL map: ${VERDERY_LB_URL_MAP_NAME}"
  gcloud compute url-maps create "${VERDERY_LB_URL_MAP_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --default-service="${VERDERY_LB_WEB_BACKEND_NAME}"
fi

# `add-path-matcher` refuses to replace an existing matcher of the same name,
# so each is created only when absent. Editing a route later is therefore a
# deliberate delete-then-recreate, not something a re-run does silently.
path_matcher_exists() {
  gcloud compute url-maps describe "${VERDERY_LB_URL_MAP_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --global \
    --format="value(pathMatchers[].name)" | tr ';' '\n' | grep -qx "${1}"
}

# app.<domain>: everything to the web backend EXCEPT /v1/*, which is the API.
# See this script's header for why the browser's API traffic must arrive on the
# web hostname rather than on api.<domain>.
if path_matcher_exists web-paths; then
  log "Path matcher already exists: web-paths"
else
  log "Adding path matcher web-paths (${VERDERY_WEB_DOMAIN}: /v1/* -> API, /* -> web)"
  gcloud compute url-maps add-path-matcher "${VERDERY_LB_URL_MAP_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --path-matcher-name=web-paths \
    --default-service="${VERDERY_LB_WEB_BACKEND_NAME}" \
    --backend-service-path-rules="/v1/*=${VERDERY_LB_API_BACKEND_NAME}" \
    --new-hosts="${VERDERY_WEB_DOMAIN}"
fi

# api.<domain>: everything to the API backend. This is the hostname the native
# iOS client uses; it is CORS-irrelevant (a native client sends no Origin) and
# exists so that a non-browser consumer never depends on the web hostname.
if path_matcher_exists api-paths; then
  log "Path matcher already exists: api-paths"
else
  log "Adding path matcher api-paths (${VERDERY_API_DOMAIN}: /* -> API)"
  gcloud compute url-maps add-path-matcher "${VERDERY_LB_URL_MAP_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --path-matcher-name=api-paths \
    --default-service="${VERDERY_LB_API_BACKEND_NAME}" \
    --new-hosts="${VERDERY_API_DOMAIN}"
fi

# --- HTTPS front end --------------------------------------------------------
if resource_exists gcloud compute target-https-proxies describe "${VERDERY_LB_HTTPS_PROXY_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "HTTPS proxy already exists: ${VERDERY_LB_HTTPS_PROXY_NAME}"
else
  log "Creating HTTPS proxy: ${VERDERY_LB_HTTPS_PROXY_NAME}"
  gcloud compute target-https-proxies create "${VERDERY_LB_HTTPS_PROXY_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --url-map="${VERDERY_LB_URL_MAP_NAME}" \
    --ssl-certificates="${VERDERY_LB_CERTIFICATE_NAME}"
fi

if resource_exists gcloud compute forwarding-rules describe "${VERDERY_LB_HTTPS_FORWARDING_RULE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "HTTPS forwarding rule already exists: ${VERDERY_LB_HTTPS_FORWARDING_RULE_NAME}"
else
  log "Creating HTTPS forwarding rule on ${lb_ip}:443"
  gcloud compute forwarding-rules create "${VERDERY_LB_HTTPS_FORWARDING_RULE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --address="${VERDERY_LB_ADDRESS_NAME}" \
    --target-https-proxy="${VERDERY_LB_HTTPS_PROXY_NAME}" \
    --ports=443
fi

# --- HTTP front end: redirect only ------------------------------------------
# Port 80 exists solely so that a plain-HTTP request gets a 301 to HTTPS rather
# than a connection refusal. It never reaches a backend, so it is not a bypass
# of anything — but it is also the request that first teaches a browser the
# HSTS header, which is why closing port 80 entirely would be worse, not
# better.
#
# A redirect needs its own URL map: a single map cannot both route to backends
# and act as a pure redirector.
if resource_exists gcloud compute url-maps describe "${VERDERY_LB_REDIRECT_URL_MAP_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "HTTP redirect URL map already exists: ${VERDERY_LB_REDIRECT_URL_MAP_NAME}"
else
  log "Creating HTTP redirect URL map: ${VERDERY_LB_REDIRECT_URL_MAP_NAME}"
  redirect_spec="$(mktemp)"
  trap 'rm -f "${redirect_spec}"' EXIT
  cat >"${redirect_spec}" <<YAML
name: ${VERDERY_LB_REDIRECT_URL_MAP_NAME}
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
  stripQuery: false
YAML
  gcloud compute url-maps import "${VERDERY_LB_REDIRECT_URL_MAP_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --source="${redirect_spec}" \
    --quiet
fi

if resource_exists gcloud compute target-http-proxies describe "${VERDERY_LB_HTTP_PROXY_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "HTTP proxy already exists: ${VERDERY_LB_HTTP_PROXY_NAME}"
else
  log "Creating HTTP proxy: ${VERDERY_LB_HTTP_PROXY_NAME}"
  gcloud compute target-http-proxies create "${VERDERY_LB_HTTP_PROXY_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --url-map="${VERDERY_LB_REDIRECT_URL_MAP_NAME}"
fi

if resource_exists gcloud compute forwarding-rules describe "${VERDERY_LB_HTTP_FORWARDING_RULE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "HTTP forwarding rule already exists: ${VERDERY_LB_HTTP_FORWARDING_RULE_NAME}"
else
  log "Creating HTTP forwarding rule on ${lb_ip}:80"
  gcloud compute forwarding-rules create "${VERDERY_LB_HTTP_FORWARDING_RULE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --address="${VERDERY_LB_ADDRESS_NAME}" \
    --target-http-proxy="${VERDERY_LB_HTTP_PROXY_NAME}" \
    --ports=80
fi

certificate_status="$(gcloud compute ssl-certificates describe "${VERDERY_LB_CERTIFICATE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global --format="value(managed.status)")"

log "Load balancer ready at ${lb_ip}."
log ""
log "NEXT, IN ORDER — none of these are done by this script:"
log " 1. DNS: create A records pointing both names at ${lb_ip}:"
log "      ${VERDERY_WEB_DOMAIN}  A  ${lb_ip}"
log "      ${VERDERY_API_DOMAIN}  A  ${lb_ip}"
log "    The managed certificate is ${certificate_status} and stays that way until"
log "    both records resolve. Allow up to an hour after they do."
log " 2. Cloud Armor:      VERDERY_APPLY=yes bash 12-cloud-armor.sh ${ENVIRONMENT}"
log " 3. Ingress lockdown: VERDERY_APPLY=yes bash 13-cloud-run-ingress.sh ${ENVIRONMENT}"
log "    Do NOT run step 3 before the certificate is ACTIVE and https://${VERDERY_WEB_DOMAIN}"
log "    serves the application — it removes the *.run.app path that is currently"
log "    the only way in."
