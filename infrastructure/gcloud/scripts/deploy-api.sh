#!/usr/bin/env bash
# Deploys the API service to Cloud Run.
#
# Used identically by a human and by CI, per the architecture's requirement
# that "development deployment is reproducible from an empty workstation with
# approved access" — there is no separate, undocumented deploy path CI alone
# knows about.
#
# Unlike the numbered provisioning scripts, this is a release action, not
# idempotent infrastructure creation, so it is not part of `provision.sh`.
#
# Source: implementation-plan.md work packages P1-PLAT-03, P1-BE-01.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: deploy-api.sh <environment> <image>}"
IMAGE="${2:?usage: deploy-api.sh <environment> <image>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

# `#` is the gcloud dictionary delimiter for this command (see
# `--set-env-vars` below). HTTP_ALLOWED_ORIGINS is itself comma-separated, so
# the default comma delimiter cannot represent more than one web origin.
env_vars="VERDERY_ENVIRONMENT=${VERDERY_ENVIRONMENT}"
env_vars+="#DATABASE_CONNECTION_MODE=cloudSqlIam"
env_vars+="#DATABASE_INSTANCE_CONNECTION_NAME=${VERDERY_PROJECT_ID}:${VERDERY_REGION}:${VERDERY_SQL_INSTANCE_NAME}"
env_vars+="#DATABASE_IAM_USER=${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam"
env_vars+="#DATABASE_NAME=${VERDERY_SQL_DATABASE_NAME}"
env_vars+="#TRACING_ENABLED=${VERDERY_TRACING_ENABLED:-false}"
# The 5 second default (configuration-schema.ts) times a plain TCP connect
# attempt, sized for a local or Testcontainers Postgres on the same machine.
# The Cloud SQL connector does more before a connection exists at all — an
# API call to fetch an ephemeral certificate, then an mTLS handshake — and a
# cold connector on a brand new revision was observed missing the 5 second
# window here, failing the startup ping and taking the revision down before
# it ever served a request. 15 seconds is generous for that handshake without
# meaningfully delaying a real failure's detection.
env_vars+="#DATABASE_CONNECTION_TIMEOUT_MS=15000"
# P8-DB-01: the per-instance pool size, which is one half of the connection
# budget `max_connections` is set from (14-cloud-sql-hardening.sh). It is
# configuration rather than a literal so the deployed service and the database
# ceiling cannot drift apart — a pool raised here without raising the ceiling
# is a readiness-probe failure on the next scale-out, not a slow degradation.
# The default matches configuration-schema.ts's own default, so an environment
# that does not set it (dev) deploys exactly as before.
# Source: architecture/networking.md section 11 ("Connection Pooling").
env_vars+="#DATABASE_POOL_MAX_CONNECTIONS=${VERDERY_DATABASE_POOL_MAX_CONNECTIONS:-10}"
# Required since Phase 2: the service verifies Firebase ID tokens and session
# cookies against this exact project. Missing this fails startup
# configuration validation immediately (loadConfiguration()), the same
# fail-fast behavior as a missing database variable.
#
# Source: architecture/identity-and-authorization.md, section
# "2. Identity Authority".
env_vars+="#FIREBASE_PROJECT_ID=${VERDERY_PROJECT_ID}"
# The four private media buckets P6-PLAT-01 provisions
# (09-media-storage.sh) and P6-API-01's endpoints require at startup
# (configuration-schema.ts: MEDIA_*_BUCKET are non-optional). Discovered
# missing from this script entirely while wiring P6-ASYNC-01's own two new
# required variables below — a real gap predating this stage, fixed here
# rather than left alongside new variables that would otherwise sit next to
# a startup-config failure this script was never actually completing.
env_vars+="#MEDIA_USER_MEDIA_BUCKET=${VERDERY_USER_MEDIA_BUCKET}"
env_vars+="#MEDIA_RAW_CAPTURE_BUCKET=${VERDERY_RAW_CAPTURE_BUCKET}"
env_vars+="#MEDIA_DERIVED_BUCKET=${VERDERY_DERIVED_BUCKET}"
env_vars+="#MEDIA_EXPORTS_BUCKET=${VERDERY_EXPORTS_BUCKET}"
env_vars+="#MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL=${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

# ADR-0015: plant-species-identification and plant-condition-analysis, off
# unless <environment>.env sets the two ENABLED flags (dev.env's own header
# comment explains why only development does today). Both reuse this
# project as the Vertex project/location — one GCP project across every AI
# capability here (ADR-0008) — never RECOMMENDATION_AI_VERTEX_PROJECT_ID
# itself, since the recommendation-explanation capability's own kill-switch
# can stay independently off while these are on.
#
# The Vertex AI LOCATION is deliberately its own variable, not
# ${VERDERY_REGION}: Cloud Run's own region and the Vertex AI location a
# given Gemini model is actually served from are two independent choices —
# confirmed directly against this project's own Vertex AI endpoint that
# `gemini-3.5-flash`/`gemini-3.6-flash` answer only under location `global`,
# a plain 404 under a regional location like `us-central1`. Defaults to
# ${VERDERY_REGION} (the prior, implicit behavior) when an environment does
# not set VERDERY_AI_VERTEX_LOCATION, so this is additive, not a forced
# change for every environment.
env_vars+="#RECOMMENDATION_AI_VERTEX_PROJECT_ID=${VERDERY_PROJECT_ID}"
env_vars+="#RECOMMENDATION_AI_VERTEX_LOCATION=${VERDERY_AI_VERTEX_LOCATION:-${VERDERY_REGION}}"
env_vars+="#PLANT_SPECIES_AI_ENABLED=${VERDERY_PLANT_SPECIES_AI_ENABLED:-false}"
env_vars+="#PLANT_SPECIES_AI_MODEL=${VERDERY_PLANT_SPECIES_AI_MODEL:-unset}"
env_vars+="#PLANT_CONDITION_AI_ENABLED=${VERDERY_PLANT_CONDITION_AI_ENABLED:-false}"
env_vars+="#PLANT_CONDITION_AI_MODEL=${VERDERY_PLANT_CONDITION_AI_MODEL:-unset}"
env_vars+="#AERIAL_TRACE_AI_ENABLED=${VERDERY_AERIAL_TRACE_AI_ENABLED:-false}"
env_vars+="#AERIAL_TRACE_AI_MODEL=${VERDERY_AERIAL_TRACE_AI_MODEL:-unset}"

# ADR-0018: reading an uploaded plat of survey. Its own kill-switch and its
# own model, on the same shared Vertex project/location above — a
# transcription of dense engineering text is a different task from naming a
# plant, and the two must be able to move models independently.
env_vars+="#PLAT_READING_ENABLED=${VERDERY_PLAT_READING_ENABLED:-false}"
env_vars+="#PLAT_READING_MODEL=${VERDERY_PLAT_READING_MODEL:-unset}"

# Browser CORS for the deployed web client (Phase 8 web deployment stage).
#
# P8-NET-01: an environment with a custom domain states its browser origin
# exactly, in configuration, rather than deriving it from a generated
# `*.run.app` URL that will not be reachable at all once
# 13-cloud-run-ingress.sh has run. networking.md section 15 requires the API to
# "allowlist exact deployed web origins" and prohibits wildcard credentialed
# CORS; one hostname, spelled out in <environment>.env, is the most exact form
# that requirement can take.
#
# Note what this is NOT for: behind the load balancer the browser reaches
# `app.<domain>/v1/*` on its own origin (11-load-balancer.sh's path matcher),
# so ordinary browser traffic is same-origin and never triggers CORS at all.
# This allowlist is the defensive statement of who WOULD be allowed if a
# cross-origin request ever occurred, and it is exactly one host.
#
# Without VERDERY_WEB_DOMAIN (dev), every official Cloud Run alias is read from
# the service annotation. `status.url` exposes only one of the two valid
# browser-visible URLs; using it alone caused Google popup authorization to be
# fixed on one alias while `POST /v1/auth/session` still failed CORS on the
# other. Before the web service's first deployment this stays empty, which the
# API treats as "no cross-origin browser client is allowed" — the safe default.
http_allowed_origins=""
if [[ -n "${VERDERY_WEB_DOMAIN:-}" ]]; then
  http_allowed_origins="https://${VERDERY_WEB_DOMAIN}"
elif resource_exists gcloud run services describe "${VERDERY_WEB_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  http_allowed_origins="$(cloud_run_service_origins_csv "${VERDERY_WEB_SERVICE_NAME}")"
fi
if [[ -n "${http_allowed_origins}" ]]; then
  env_vars+="#HTTP_ALLOWED_ORIGINS=${http_allowed_origins}"
fi

# `MEDIA_PROCESSING_CALLBACK_AUDIENCE` is the callback route's own OIDC
# audience — this exact service's own URL. The ORIGINAL version of this
# script omitted it from the `--set-env-vars` call below entirely, planning
# to set it in a second, self-referential `gcloud run services update` call
# once the URL was known — but `gcloud run deploy --set-env-vars` REPLACES
# the complete env var set, not merges, so that first call always produced a
# revision missing this non-optional variable
# (configuration-schema.ts: `z.string().min(1)`), which crashed on startup
# before that second call ever ran: a real, live deploy failure
# ("MEDIA_PROCESSING_CALLBACK_AUDIENCE: Invalid input: expected string,
# received undefined", `verdery-api-dev-00055-p8g` never starting) — not a
# one-time bootstrap problem, since every later redeploy would have hit the
# identical crash the exact same way.
#
# Cloud Run service URLs are stable across every revision of the same
# service (this script's own prior comment already knew this) — for an
# ALREADY-EXISTING service, the URL is therefore already known before this
# deploy ever runs, so it belongs in this first call, not a follow-up one.
# Only a genuinely first-ever deploy of a brand new service (no URL exists
# yet at all) still needs the placeholder-then-correct two-step shape below.
if resource_exists gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  existing_service_url="$(gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"
  env_vars+="#MEDIA_PROCESSING_CALLBACK_AUDIENCE=${existing_service_url}/v1/internal/media-processing-jobs"
else
  log "${VERDERY_CLOUD_RUN_SERVICE_NAME} does not exist yet — deploying once with a placeholder"
  log "MEDIA_PROCESSING_CALLBACK_AUDIENCE (corrected below once a real URL exists)."
  env_vars+="#MEDIA_PROCESSING_CALLBACK_AUDIENCE=pending-first-deploy"
fi

log "Deploying ${IMAGE} to ${VERDERY_CLOUD_RUN_SERVICE_NAME}"
# P8-NET-01 / P8-DB-01 made three of the flags below configuration:
#
#   --min-instances
#     Zero, and raising it REQUIRES --no-cpu-throttling in the same change.
#     Cloud Run allocates CPU only while a request is in flight unless told
#     otherwise, so a warm minimum instance is a frozen one between requests.
#     `@fastify/under-pressure` samples event-loop delay on a timer, that timer
#     does not run while the process is throttled, and the delay it reads on
#     the next request is the whole idle period — so the guard rejected EVERY
#     authenticated request with 503 until the instance was replaced. Setting
#     this to one without always-on CPU is strictly worse than scaling to
#     zero: it converts an occasional cold start into a permanent outage.
#     Verified on dev, 2026-08-01.
#
#   --max-instances / --concurrency / DATABASE_POOL_MAX_CONNECTIONS
#     networking.md section 11 names exactly these as the levers that keep
#     Cloud Run scaling inside database connection capacity. Their defaults
#     here reproduce the current dev deployment (2 instances, Cloud Run's own
#     concurrency default of 80, the schema's pool default of 10) byte for
#     byte, so dev.env needs no change.
#
#   --ingress
#     Defaults to `all`, which is what both services run today. Production sets
#     `internal-and-cloud-load-balancing` in prod.env; the cutover itself is
#     13-cloud-run-ingress.sh, which will not run until the load balancer path
#     is verified working. Passing it on every deploy matters because a deploy
#     that omitted it would be an unnoticed reopening of the public path.
#
# `--allow-unauthenticated` stays unconditional, and that is deliberate: a
# serverless NEG forwards requests to Cloud Run WITHOUT an identity token, so
# removing the `allUsers` invoker binding returns 403 for every request through
# the load balancer. Reachability is controlled by --ingress, not by IAM — the
# reasoning is in 13-cloud-run-ingress.sh's header.
gcloud run deploy "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --image="${IMAGE}" \
  --network="${VERDERY_NETWORK_NAME}" \
  --subnet="${VERDERY_SUBNET_NAME}" \
  --vpc-egress=private-ranges-only \
  --service-account="${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="^#^${env_vars}" \
  --min-instances="${VERDERY_API_MIN_INSTANCES:-0}" \
  --max-instances="${VERDERY_API_MAX_INSTANCES:-2}" \
  --concurrency="${VERDERY_API_CONCURRENCY:-80}" \
  --cpu=1 \
  --memory=512Mi \
  --port=8080 \
  --allow-unauthenticated \
  --ingress="${VERDERY_CLOUD_RUN_INGRESS:-all}" \
  --quiet

service_url="$(gcloud run services describe "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}" --format="value(status.url)")"

# Corrects the placeholder from a genuinely first-ever deploy (see above) to
# the real, now-known URL. A true no-op on every other redeploy — the
# service already existed, so the first `--set-env-vars` call above already
# set the real, correct value, and this second call updates it to the exact
# same string.
callback_audience="${service_url}/v1/internal/media-processing-jobs"
log "Setting media-processing callback audience: ${callback_audience}"
gcloud run services update "${VERDERY_CLOUD_RUN_SERVICE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --region="${VERDERY_REGION}" \
  --update-env-vars="MEDIA_PROCESSING_CALLBACK_AUDIENCE=${callback_audience}" \
  --quiet >/dev/null

log "Deployed. Service URL: ${service_url}"
log ""
log "Ingress: ${VERDERY_CLOUD_RUN_INGRESS:-all}"
if [[ "${VERDERY_CLOUD_RUN_INGRESS:-all}" == "all" ]]; then
  # Corrected in P8-NET-01. The previous version of this note claimed the
  # service "currently exposes nothing but health checks", which stopped being
  # true several phases ago and was flagged as misleading by runbooks.md's gap
  # list (item 4). The accurate statement is below.
  log ""
  log "NOTE: this service answers the whole internet on the URL above, and it"
  log "serves the full domain API. The controls that exist today are"
  log "authentication and authorization in the application itself; there is no"
  log "edge, no rate limit, and no ingress restriction. The threat model"
  log "registers the consequences as T-COST-01, T-COST-02, and T-SSRF-06."
  log "P8-NET-01 closes them: 11-load-balancer.sh, 12-cloud-armor.sh, and"
  log "13-cloud-run-ingress.sh, in that order. Until then this is an"
  log "unadvertised development environment and should stay one."
fi
