#!/usr/bin/env bash
# Answers "what is this environment costing me" and lets you stop, start, or
# destroy the whole thing.
#
#   ./env-control.sh dev status     what exists and what is billing right now
#   ./env-control.sh dev cost       the money question, answered honestly
#   ./env-control.sh dev stop       suspend everything that bills while idle
#   ./env-control.sh dev start      bring it back
#   ./env-control.sh dev destroy    delete it, with data loss spelled out first
#
# TWO DIFFERENT ANSWERS TO "HOW MUCH", AND THE SCRIPT ALWAYS SAYS WHICH ONE IT
# IS GIVING YOU. Google exposes actual spend only through a BigQuery billing
# export, which is off by default and cannot be switched on from the command
# line — `gcloud billing` manages account linkage and nothing else. So:
#
#   * If a billing export dataset exists, `cost` queries it and reports REAL
#     charges. That is the number on your invoice.
#   * Otherwise it reports an ESTIMATE, computed from the resources that
#     actually exist right now multiplied by the published rates below. It is
#     labelled as an estimate every time, because rates change, free tiers
#     apply unevenly, and an estimate presented as a fact is worse than no
#     number at all.
#
# The estimate deliberately covers only the resources that bill for EXISTING.
# Per-request charges on services that scale to zero are real but tiny and
# unpredictable at this size, and padding the estimate with guesses about them
# would make the whole figure less trustworthy, not more.
#
# Source: architecture/cost-and-scaling.md.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: env-control.sh <environment> <status|cost|stop|start|destroy>}"
COMMAND="${2:?usage: env-control.sh <environment> <status|cost|stop|start|destroy>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

# ---------------------------------------------------------------------------
# Published us-central1 rates, USD. VERIFY THESE against
# https://cloud.google.com/pricing before trusting a number they produced —
# they are transcribed constants, not a live feed, and this script has no way
# to know when they went stale.
# ---------------------------------------------------------------------------
RATE_SQL_F1_MICRO_HOUR="0.0150"     # db-f1-micro shared-core instance
RATE_SQL_SSD_GB_MONTH="0.170"       # PD_SSD storage
RATE_RUN_VCPU_HOUR="0.0648"         # always-allocated CPU (--no-cpu-throttling)
RATE_RUN_GIB_HOUR="0.0072"          # always-allocated memory
RATE_GCS_STANDARD_GB_MONTH="0.020"
RATE_AR_GB_MONTH="0.100"            # Artifact Registry storage

HOURS_PER_MONTH=730

money() { printf '%.2f' "$1"; }

# --- inventory helpers -----------------------------------------------------

sql_state() {
  gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --format='value(state)' 2>/dev/null || echo "ABSENT"
}

sql_activation() {
  gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --format='value(settings.activationPolicy)' 2>/dev/null || echo "ABSENT"
}

sql_disk_gb() {
  gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --format='value(settings.dataDiskSizeGb)' 2>/dev/null || echo 0
}

run_services() {
  gcloud run services list --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" --format='value(metadata.name)' 2>/dev/null
}

run_min_instances() {
  gcloud run services describe "$1" --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --format='value(spec.template.metadata.annotations["autoscaling.knative.dev/minScale"])' \
    2>/dev/null
}

run_always_on_cpu() {
  local value
  value="$(gcloud run services describe "$1" --project="${VERDERY_PROJECT_ID}" \
    --region="${VERDERY_REGION}" \
    --format='value(spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"])' 2>/dev/null)"
  # The annotation is absent when throttling is on (the default); "false" means
  # CPU is allocated outside requests, which is what actually bills while idle.
  [[ "${value}" == "false" ]]
}

bucket_total_gb() {
  local total=0 size
  for bucket in $(gcloud storage ls --project="${VERDERY_PROJECT_ID}" 2>/dev/null); do
    size="$(gcloud storage du --summarize --readable-sizes "${bucket}" 2>/dev/null | awk '{print $1}')" || true
    [[ -n "${size:-}" ]] || continue
    total="$(node -e "
      const raw = process.argv[1];
      const n = parseFloat(raw) || 0;
      const unit = raw.replace(/[0-9.]/g, '').toUpperCase();
      const gib = unit.startsWith('T') ? n * 1024 : unit.startsWith('M') ? n / 1024
        : unit.startsWith('K') ? n / 1048576 : unit.startsWith('B') ? n / 1073741824 : n;
      console.log(${total} + gib);
    " "${size}")"
  done
  printf '%s' "${total}"
}

billing_export_dataset() {
  command -v bq >/dev/null 2>&1 || return 1
  bq --project_id="${VERDERY_PROJECT_ID}" ls --format=json 2>/dev/null |
    node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        let sets = [];
        try { sets = JSON.parse(s || "[]"); } catch { /* no datasets */ }
        const hit = sets.find((d) => /billing/i.test(d.id || ""));
        if (hit) { console.log(hit.id); process.exit(0); }
        process.exit(1);
      });
    '
}

# --- commands --------------------------------------------------------------

cmd_status() {
  log "Environment: ${ENVIRONMENT}  (project ${VERDERY_PROJECT_ID}, ${VERDERY_REGION})"
  log ""
  log "Cloud SQL ${VERDERY_SQL_INSTANCE_NAME}: $(sql_state) / activation=$(sql_activation)"
  log ""
  log "Cloud Run services:"
  local svc min
  for svc in $(run_services); do
    min="$(run_min_instances "${svc}")"
    min="${min:-0}"
    if run_always_on_cpu "${svc}"; then
      log "  ${svc}  minScale=${min}  CPU always allocated  <- bills while idle when minScale>0"
    else
      log "  ${svc}  minScale=${min}  CPU on request only"
    fi
  done
  log ""
  log "Buckets:"
  gcloud storage ls --project="${VERDERY_PROJECT_ID}" 2>/dev/null | sed 's/^/  /' || log "  (none)"
}

cmd_cost() {
  local dataset
  if dataset="$(billing_export_dataset)"; then
    log "Billing export found (${dataset}) — reporting ACTUAL charges."
    log "Month to date, by service:"
    bq --project_id="${VERDERY_PROJECT_ID}" query --use_legacy_sql=false --format=pretty \
      "SELECT service.description AS service,
              ROUND(SUM(cost), 2) AS cost_usd
       FROM \`${VERDERY_PROJECT_ID}.${dataset}.gcp_billing_export_v1_*\`
       WHERE project.id = '${VERDERY_PROJECT_ID}'
         AND DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
       GROUP BY service
       ORDER BY cost_usd DESC"
    return
  fi

  log "NO BILLING EXPORT CONFIGURED, so this is an ESTIMATE, not your invoice."
  log "It multiplies the resources that exist right now by transcribed public"
  log "rates. Free tiers and per-request charges are NOT included."
  log ""

  local total=0 line

  local activation disk_gb sql_compute sql_storage
  activation="$(sql_activation)"
  disk_gb="$(sql_disk_gb)"
  if [[ "${activation}" == "ALWAYS" ]]; then
    sql_compute="$(node -e "console.log(${RATE_SQL_F1_MICRO_HOUR} * ${HOURS_PER_MONTH})")"
  else
    sql_compute=0
  fi
  sql_storage="$(node -e "console.log((${disk_gb:-0}) * ${RATE_SQL_SSD_GB_MONTH})")"
  total="$(node -e "console.log(${total} + ${sql_compute} + ${sql_storage})")"
  log "$(printf '  %-42s $%s' "Cloud SQL compute (activation=${activation})" "$(money "${sql_compute}")")"
  log "$(printf '  %-42s $%s' "Cloud SQL storage (${disk_gb:-0} GB SSD)" "$(money "${sql_storage}")")"

  local svc min cost
  for svc in $(run_services); do
    min="$(run_min_instances "${svc}")"
    min="${min:-0}"
    if [[ "${min}" -gt 0 ]] && run_always_on_cpu "${svc}"; then
      cost="$(node -e "console.log(${min} * (${RATE_RUN_VCPU_HOUR} + 0.5 * ${RATE_RUN_GIB_HOUR}) * ${HOURS_PER_MONTH})")"
      total="$(node -e "console.log(${total} + ${cost})")"
      log "$(printf '  %-42s $%s' "${svc} (${min} warm, always-on CPU)" "$(money "${cost}")")"
    else
      log "$(printf '  %-42s %s' "${svc}" "scales to zero — per-request only")"
    fi
  done

  local gb storage_cost
  gb="$(bucket_total_gb)"
  storage_cost="$(node -e "console.log((${gb:-0}) * ${RATE_GCS_STANDARD_GB_MONTH})")"
  total="$(node -e "console.log(${total} + ${storage_cost})")"
  log "$(printf '  %-42s $%s' "Cloud Storage ($(money "${gb:-0}") GB)" "$(money "${storage_cost}")")"

  log ""
  log "$(printf '  %-42s $%s / month' "ESTIMATED STANDING COST" "$(money "${total}")")"
  log ""
  log "For real numbers, enable a BigQuery billing export once, in the console:"
  log "  Billing -> Billing export -> BigQuery export -> Edit settings."
  log "This script picks it up automatically from then on."
}

cmd_stop() {
  [[ "${ENVIRONMENT}" != "prod" ]] || fail "Refusing to stop prod."
  ./dev-down.sh "${ENVIRONMENT}"
}

cmd_start() {
  ./dev-up.sh "${ENVIRONMENT}"
}

cmd_destroy() {
  [[ "${ENVIRONMENT}" != "prod" ]] || fail "Refusing to destroy prod."

  log "This will DELETE, permanently:"
  log ""
  local svc
  for svc in $(run_services); do log "  Cloud Run service   ${svc}"; done
  log "  Cloud SQL instance  ${VERDERY_SQL_INSTANCE_NAME}  <- ALL DATABASE CONTENT"
  log "  Cloud Tasks queue   ${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}"
  log ""
  log "It will NOT touch, so that nothing irreplaceable goes by accident:"
  log "  Storage buckets (uploaded photos and exports)"
  log "  Secrets, service accounts, the Artifact Registry repository"
  log "  The project itself"
  log ""
  log "Everything deleted here is recreated by the numbered provisioning"
  log "scripts plus a deploy. The database content is not."
  log ""
  printf 'Type the environment name (%s) to confirm: ' "${ENVIRONMENT}"
  local answer
  read -r answer
  [[ "${answer}" == "${ENVIRONMENT}" ]] || fail "Not confirmed — nothing was deleted."

  for svc in $(run_services); do
    log "Deleting Cloud Run service ${svc}"
    gcloud run services delete "${svc}" --project="${VERDERY_PROJECT_ID}" \
      --region="${VERDERY_REGION}" --quiet >/dev/null || true
  done

  if resource_exists gcloud tasks queues describe "${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --location="${VERDERY_REGION}"; then
    log "Deleting Cloud Tasks queue ${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}"
    gcloud tasks queues delete "${VERDERY_MEDIA_PROCESSING_QUEUE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" --location="${VERDERY_REGION}" --quiet >/dev/null || true
  fi

  if [[ "$(sql_state)" != "ABSENT" ]]; then
    # 14-cloud-sql-hardening.sh turns deletion protection on, and the delete
    # below fails outright while it is set. Clearing it is part of destroying,
    # not something to make the caller discover from an error message.
    log "Clearing deletion protection on ${VERDERY_SQL_INSTANCE_NAME}"
    gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" --no-deletion-protection --quiet >/dev/null
    log "Deleting Cloud SQL instance ${VERDERY_SQL_INSTANCE_NAME}"
    gcloud sql instances delete "${VERDERY_SQL_INSTANCE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" --quiet >/dev/null
  fi

  log ""
  log "Destroyed. Buckets and secrets survive — remove them by hand if you"
  log "really want the data gone:"
  gcloud storage ls --project="${VERDERY_PROJECT_ID}" 2>/dev/null | sed 's/^/  gcloud storage rm -r /' || true
}

case "${COMMAND}" in
  status) cmd_status ;;
  cost) cmd_cost ;;
  stop) cmd_stop ;;
  start) cmd_start ;;
  destroy) cmd_destroy ;;
  *) fail "Unknown command '${COMMAND}' — expected status, cost, stop, start, or destroy." ;;
esac
