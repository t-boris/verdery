#!/usr/bin/env bash
# Creates the email notification channel and every alert policy in
# config/monitoring/, substituting this environment's resource names into the
# committed policy definitions.
#
# SCOPE BOUNDARY: DRAFTED AND SYNTAX-CHECKED (`bash -n`), NOT executed against
# any project.
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS AT ALL
#
# `gcloud alpha monitoring policies list` and `channels list` both return
# EMPTY for verdery-dev — verified live on 2026-07-25, and recorded in
# runbooks.md section 1.5. That fact reshapes every runbook in the project:
# "no runbook in this document may open with 'when the alert fires'". Nine
# policies do not fix operations, but they replace "a person happened to run a
# query" with "something told us", which is the difference between a five
# minute incident and a five hour one.
#
# observability-and-analytics.md already designs dashboards and alert
# CANDIDATES in detail and is explicit that they are designs, not deployments.
# This script does not duplicate that work: the policies here are the
# infrastructure-level signals P8-NET-01 and P8-DB-01 own — the edge, the
# database, and the capacity ceilings — not the application-level media, sync,
# and care-loop signals those other packages own.
#
# ---------------------------------------------------------------------------
# WHY THE POLICIES ARE JSON FILES AND NOT gcloud FLAGS
#
# `gcloud alpha monitoring policies create` can build a single-condition policy
# from flags, but not the documentation body. The `documentation.content` field
# is where the responder reads what to do at 03:00, and writing that as a shell
# string would make it unreviewable. Committed JSON is reviewable, diffable,
# and formatted by the repository's own Prettier gate.
#
# Resource names differ per environment, so each file carries `__TOKEN__`
# placeholders substituted here. `__CONNECTION_THRESHOLD__` and
# `__INSTANCE_COUNT_THRESHOLD__` appear QUOTED in the committed files so the
# files stay valid JSON; the substitution replaces the quotes as well, because
# the API requires a number there.
#
# COST: alert policies and email notification channels are free. Verbose load
# balancer logging (enabled by 11-load-balancer.sh) is the only cost in this
# neighbourhood.
#
# DOWNTIME: none.
#
# Idempotent: policies and channels are matched by display name before
# creation. A re-run after editing a JSON file does NOT update the live policy
# — delete that policy by name and re-run, so an edit is always a deliberate
# act rather than something a routine re-run applies silently.
#
# Source: implementation-plan.md work packages P8-NET-01 and P8-DB-01;
# architecture/networking.md section 20; architecture/reliability-and-disaster-
# recovery.md section 17; development/runbooks.md section 1.5 and its gap list.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 15-monitoring-alerts.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config \
  VERDERY_ALERT_EMAIL \
  VERDERY_ALERT_CHANNEL_DISPLAY_NAME \
  VERDERY_SQL_CONNECTION_ALERT_THRESHOLD \
  VERDERY_INSTANCE_COUNT_ALERT_THRESHOLD
require_explicit_apply "creates alert policies that will send mail to ${VERDERY_ALERT_EMAIL}."

enable_api_if_needed monitoring.googleapis.com

MONITORING_DIR="${GCLOUD_ROOT}/config/monitoring"

# --- notification channel ---------------------------------------------------
# Email, because it is the only channel that needs no third-party account and
# works for a single-operator project. A policy with no channel is a dashboard
# nobody looks at, which is exactly the state runbooks.md found.
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

# --- policies ---------------------------------------------------------------
rendered_dir="$(mktemp -d)"
trap 'rm -rf "${rendered_dir}"' EXIT

create_policy() {
  local file_name="${1}"
  local source_file="${MONITORING_DIR}/${file_name}"
  local rendered_file="${rendered_dir}/${file_name}"
  local display_name existing

  [[ -f "${source_file}" ]] || fail "Missing policy definition: ${source_file}"

  # The quoted-placeholder substitutions come first and consume the quotes, so
  # a threshold lands in the JSON as a number rather than a string.
  sed \
    -e "s|\"__CONNECTION_THRESHOLD__\"|${VERDERY_SQL_CONNECTION_ALERT_THRESHOLD}|g" \
    -e "s|\"__INSTANCE_COUNT_THRESHOLD__\"|${VERDERY_INSTANCE_COUNT_ALERT_THRESHOLD}|g" \
    -e "s|__PROJECT_ID__|${VERDERY_PROJECT_ID}|g" \
    -e "s|__SQL_INSTANCE_ID__|${VERDERY_SQL_INSTANCE_NAME}|g" \
    -e "s|__URL_MAP__|${VERDERY_LB_URL_MAP_NAME:-}|g" \
    "${source_file}" >"${rendered_file}"

  # `\?` is a GNU sed extension, not portable to BSD sed (macOS) in basic
  # regex mode — two plain substitutions instead, so this works identically
  # for a CI runner (GNU sed) and an operator's own Mac (BSD sed). Found
  # live while deploying 17-plant-intelligence-monitoring.sh's own copy of
  # this exact pattern for the first time — this script's policies have
  # never actually been created against any project either (see this
  # file's own header, "verified live on 2026-07-25"), so the bug had
  # nothing to surface against until now.
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

# P8-DB-01: capacity and availability of the database.
create_policy cloudsql-cpu-high.json
create_policy cloudsql-memory-high.json
create_policy cloudsql-disk-high.json
create_policy cloudsql-connections-high.json
create_policy cloudsql-instance-down.json
create_policy cloudsql-failover-unavailable.json

# P8-NET-01: the edge, and the capacity ceiling that ties Cloud Run scaling to
# both the subnet and the database connection budget.
create_policy cloudrun-instance-count-high.json

# The two load balancer policies reference a URL map that only exists after
# 11-load-balancer.sh has run. Creating them earlier would produce policies
# that can never fire, which is worse than not having them: a silent alert
# reads as "all clear".
if [[ -n "${VERDERY_LB_URL_MAP_NAME:-}" ]] && resource_exists gcloud compute url-maps describe \
  "${VERDERY_LB_URL_MAP_NAME}" --project="${VERDERY_PROJECT_ID}" --global; then
  create_policy loadbalancer-5xx.json
  create_policy loadbalancer-latency-high.json
  create_policy cloud-armor-blocked-spike.json
else
  log "Skipping the load balancer and Cloud Armor policies: no URL map ${VERDERY_LB_URL_MAP_NAME:-<unset>} exists yet."
  log "Run 11-load-balancer.sh and 12-cloud-armor.sh, then re-run this script."
fi

log ""
log "Alert policies in ${VERDERY_PROJECT_ID}:"
gcloud alpha monitoring policies list --project="${VERDERY_PROJECT_ID}" \
  --format="table(displayName,enabled)"

log ""
log "Editing a threshold: change the JSON in config/monitoring/, delete that one"
log "policy by display name, and re-run. This script never updates a live policy,"
log "so a routine re-run cannot silently change what pages you."
