#!/usr/bin/env bash
# Creates the log-based metrics, dashboard, and alert policies for the
# application-level Phase 11 plant-intelligence signals (P11-OBS-01) —
# the "Plant intelligence dashboard, alert candidates, and runbook"
# subsection of observability-and-analytics.md, deployed for real.
#
# SCOPE BOUNDARY: this is the APPLICATION-level signal set
# (`plants.*`/`observations.*`/`taxon_enrichment.*` structured log events
# services/api and services/workers already emit) — a DIFFERENT scope from
# 15-monitoring-alerts.sh's infrastructure-level signals (Cloud SQL, Cloud
# Run capacity, the load balancer). Both scripts share the SAME notification
# channel (one operator, one destination per environment) but create
# entirely separate metrics/policies; running this script never touches
# 15-monitoring-alerts.sh's own policies, and vice versa.
#
# WHY LOG-BASED METRICS, NOT BUILT-IN ONES: every signal here originates as
# a structured `jsonPayload.event=...` log line
# (observability-and-analytics.md section 5), not a Google-owned built-in
# metric — a log-based metric is the only way to turn "this string appeared
# in a log line" into something an alert policy's `conditionThreshold` can
# read, matching how the existing (unrelated) load-balancer/Cloud SQL
# policies read a BUILT-IN metric directly with no such step.
#
# THIS IS A REAL DEPLOYMENT, NOT A DESIGN. observability-and-analytics.md's
# own P5/P6/P7/P9C/P11-OBS-01 subsections all say "no live dashboard,
# log-based metric, or alert policy has been created against any
# environment" — this script is the first exception, scoped deliberately to
# ONE dashboard (Plant intelligence) rather than closing that gap for every
# earlier subsection at once.
#
# NOT EVERY DOCUMENTED METRIC IS BUILT HERE. observability-and-analytics.md
# names roughly a dozen log-based metrics for this dashboard; this script
# creates five (the ones with FLAT, always-present JSON fields a label
# extractor or value extractor can read unconditionally) plus the two
# documented alert candidates they back. Metrics keyed on a nested,
# variable-key map (e.g. `degradationReasons`, which only carries keys for
# reasons that actually occurred on a given line) are NOT log-based-metric
# extractable without a further code change making every key always
# present — `findingCounts`/`safetyClassCounts` already got that fix this
# same pass; `degradationReasons` did not, since it predates this pass
# (P11-ASYNC-01) and widening its own counting logic is out of this
# script's own scope. Query it ad hoc via Log Analytics/Logs Explorer
# instead.
#
# Idempotent: metrics, the dashboard, and policies are all matched by
# name/display name before creation, the identical posture
# 15-monitoring-alerts.sh already establishes. Editing a committed JSON
# file after this script has run once does NOT update the live resource —
# delete it by name and re-run, so an edit is always a deliberate act.
#
# COST: log-based metrics, dashboards, and alert policies are all free.
# DOWNTIME: none.
#
# Source: implementation-plan.md work package P11-OBS-01;
# architecture/observability-and-analytics.md, "Plant intelligence
# dashboard, alert candidates, and runbook (P11-OBS-01)".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 17-plant-intelligence-monitoring.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config \
  VERDERY_ALERT_EMAIL \
  VERDERY_ALERT_CHANNEL_DISPLAY_NAME \
  VERDERY_ZERO_RESULT_SEARCH_THRESHOLD \
  VERDERY_ENRICHMENT_DURATION_THRESHOLD_MS \
  VERDERY_CLOUD_RUN_SERVICE_NAME \
  VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME
require_explicit_apply "creates log-based metrics, a dashboard, and two alert policies for the plant-intelligence signals, sending mail to ${VERDERY_ALERT_EMAIL} on alert."

enable_api_if_needed logging.googleapis.com
enable_api_if_needed monitoring.googleapis.com

MONITORING_DIR="${GCLOUD_ROOT}/config/monitoring"
METRICS_DIR="${MONITORING_DIR}/plant-intelligence-metrics"

# --- notification channel ---------------------------------------------------
# Shared with 15-monitoring-alerts.sh's own policies — one operator, one
# destination per environment. Looked up, never assumed created by that
# other script, since this one may run first.
channel_name="$(gcloud alpha monitoring channels list \
  --project="${VERDERY_PROJECT_ID}" \
  --filter="displayName=\"${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}\"" \
  --format="value(name)" | head -n 1)"

if [[ -n "${channel_name}" ]]; then
  log "Notification channel already exists: ${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}"
else
  log "Creating notification channel: ${VERDERY_ALERT_CHANNEL_DISPLAY_NAME} -> ${VERDERY_ALERT_EMAIL}"
  gcloud alpha monitoring channels create \
    --project="${VERDERY_PROJECT_ID}" \
    --display-name="${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}" \
    --type=email \
    --channel-labels="email_address=${VERDERY_ALERT_EMAIL}" \
    >/dev/null

  channel_name="$(gcloud alpha monitoring channels list \
    --project="${VERDERY_PROJECT_ID}" \
    --filter="displayName=\"${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}\"" \
    --format="value(name)" | head -n 1)"
fi

[[ -n "${channel_name}" ]] || fail "Could not resolve the notification channel after creating it."

# --- log-based metrics -------------------------------------------------------
rendered_dir="$(mktemp -d)"
trap 'rm -rf "${rendered_dir}"' EXIT

create_metric() {
  local metric_name="${1}"
  local file_name="${2}"
  local source_file="${METRICS_DIR}/${file_name}"
  local rendered_file="${rendered_dir}/${file_name}"

  [[ -f "${source_file}" ]] || fail "Missing metric definition: ${source_file}"

  if gcloud logging metrics describe "${metric_name}" --project="${VERDERY_PROJECT_ID}" >/dev/null 2>&1; then
    log "Log-based metric already exists: ${metric_name}"
    return
  fi

  sed \
    -e "s|__API_SERVICE_NAME__|${VERDERY_CLOUD_RUN_SERVICE_NAME}|g" \
    -e "s|__WORKERS_SERVICE_NAME__|${VERDERY_WORKERS_CLOUD_RUN_SERVICE_NAME}|g" \
    "${source_file}" >"${rendered_file}"

  log "Creating log-based metric: ${metric_name}"
  gcloud logging metrics create "${metric_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --config-from-file="${rendered_file}" \
    >/dev/null
}

create_metric plants_actual_created plants-actual-created.json
create_metric plants_candidate_added plants-candidate-added.json
create_metric plants_candidate_converted plants-candidate-converted.json
create_metric plants_search_completed plants-search-completed.json
create_metric taxon_enrichment_sweep_duration_ms taxon-enrichment-sweep-duration-ms.json

# --- dashboard ----------------------------------------------------------------
dashboard_display_name="Plant intelligence"
existing_dashboard="$(gcloud monitoring dashboards list \
  --project="${VERDERY_PROJECT_ID}" \
  --filter="displayName=\"${dashboard_display_name}\"" \
  --format="value(name)" | head -n 1)"

if [[ -n "${existing_dashboard}" ]]; then
  log "Dashboard already exists: ${dashboard_display_name}"
else
  log "Creating dashboard: ${dashboard_display_name}"
  gcloud monitoring dashboards create \
    --project="${VERDERY_PROJECT_ID}" \
    --config-from-file="${MONITORING_DIR}/plant-intelligence-dashboard.json" \
    >/dev/null
fi

# --- alert policies -------------------------------------------------------
create_policy() {
  local file_name="${1}"
  local source_file="${MONITORING_DIR}/${file_name}"
  local rendered_file="${rendered_dir}/${file_name}"
  local display_name existing

  [[ -f "${source_file}" ]] || fail "Missing policy definition: ${source_file}"

  sed \
    -e "s|\"__ZERO_RESULT_SEARCH_THRESHOLD__\"|${VERDERY_ZERO_RESULT_SEARCH_THRESHOLD}|g" \
    -e "s|\"__ENRICHMENT_DURATION_THRESHOLD_MS__\"|${VERDERY_ENRICHMENT_DURATION_THRESHOLD_MS}|g" \
    "${source_file}" >"${rendered_file}"

  # `\?` is a GNU sed extension, not portable to BSD sed (macOS) in basic
  # regex mode — two plain substitutions instead of one GNU-only pattern,
  # so this works identically for a CI runner (GNU) and an operator's own
  # Mac (BSD). Found live: this exact pattern, copied from
  # 15-monitoring-alerts.sh, had never actually been exercised there either
  # (that script's own header states its policies have never been created
  # against verdery-dev) — fixed in both files, not just this new one.
  display_name="$(grep -m 1 '"displayName"' "${rendered_file}" |
    sed -e 's/.*"displayName": "//' -e 's/",$//' -e 's/"$//')"

  existing="$(gcloud alpha monitoring policies list \
    --project="${VERDERY_PROJECT_ID}" \
    --filter="displayName=\"${display_name}\"" \
    --format="value(name)" | head -n 1)"

  if [[ -n "${existing}" ]]; then
    log "Policy already exists: ${display_name}"
    return
  fi

  log "Creating policy: ${display_name}"
  gcloud alpha monitoring policies create \
    --project="${VERDERY_PROJECT_ID}" \
    --policy-from-file="${rendered_file}" \
    --notification-channels="${channel_name}" \
    >/dev/null
}

create_policy plant-intelligence-search-zero-result-count.json
create_policy plant-intelligence-enrichment-sweep-duration-regression.json

log ""
log "Plant-intelligence alert policies in ${VERDERY_PROJECT_ID}:"
gcloud alpha monitoring policies list --project="${VERDERY_PROJECT_ID}" \
  --filter="displayName:(\"Plant search\" OR \"Taxon enrichment\")" \
  --format="table(displayName,enabled)"

log ""
log "Editing a threshold: change the JSON in config/monitoring/, delete that one"
log "policy by display name, and re-run. This script never updates a live policy,"
log "so a routine re-run cannot silently change what pages you."
