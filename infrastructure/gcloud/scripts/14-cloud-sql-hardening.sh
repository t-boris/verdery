#!/usr/bin/env bash
# Brings a Cloud SQL instance up to the production posture
# reliability-and-disaster-recovery.md section 6 requires: regional high
# availability, deletion protection, explicit backup and PITR settings, a
# capped storage auto-increase, a maintenance window, and a `max_connections`
# value sized against the connection pools that actually connect to it.
#
# SCOPE BOUNDARY: DRAFTED AND SYNTAX-CHECKED (`bash -n`), NOT executed against
# any project. It restarts a database and roughly doubles its bill, so it calls
# `require_explicit_apply`.
#
# ---------------------------------------------------------------------------
# WHAT IS AND IS NOT ALREADY TRUE
#
# Read live from `verdery-dev` on 2026-07-25 (`gcloud sql instances describe
# verdery-dev-pg`), and unchanged since:
#
#   availabilityType             ZONAL, gceZone us-central1-a, no standby
#   deletionProtectionEnabled    false
#   backupConfiguration.enabled  true, daily 09:00 UTC, retainedBackups 7
#   pointInTimeRecoveryEnabled   true, transactionLogRetentionDays 7
#   storageAutoResize            true, storageAutoResizeLimit 0 (uncapped)
#   tier                         db-f1-micro
#
# So backups and PITR are real and healthy — that was worth checking rather
# than assuming, and the runbooks say so. What is missing is availability,
# protection, and a ceiling on anything.
#
# ---------------------------------------------------------------------------
# THE ONE THING THAT MAKES THIS BIGGER THAN A FLAG FLIP
#
# Cloud SQL does not offer high availability on shared-core machine types.
# `--availability-type=REGIONAL` on a `db-f1-micro` instance is rejected. So
# "enable regional HA" is unavoidably also "leave the shared-core tier", and
# the cost statement below is for both changes together, not for HA alone.
# config/prod.env therefore sets `db-custom-1-3840` — the smallest
# dedicated-core tier, chosen because it is the cheapest configuration that can
# satisfy section 6 at all.
#
# ---------------------------------------------------------------------------
# COST (us-central1, Enterprise edition, list price, approximate)
#
#   db-custom-1-3840 zonal                       ~49 USD/month
#   db-custom-1-3840 REGIONAL                    ~99 USD/month  (HA doubles
#                                                 both compute and storage)
#   20 GB SSD, regional                          ~7 USD/month
#   Backups beyond the free allowance             a few USD/month at this size
#
# Against today's `db-f1-micro` zonal instance at roughly 8 USD/month, this is
# an increase of about 100 USD/month. That is the price of section 6, and it is
# an owner decision, not an engineering one.
#
# ---------------------------------------------------------------------------
# DOWNTIME
#
# Three of these changes restart the instance:
#   - the tier change,
#   - the availability-type change to REGIONAL,
#   - `max_connections`, which is a STATIC PostgreSQL parameter.
#
# This script batches all three into ONE `gcloud sql instances patch` call so
# there is one restart, not three. Expect a few minutes of unavailability;
# Cloud SQL does not publish a bound, and this project has never measured one.
# Run it in the maintenance window, not at 14:00 on a Tuesday.
#
# The remaining changes (deletion protection, backup retention, PITR log
# retention, storage cap, maintenance window, Query Insights) restart nothing
# and are applied in a second, always-safe patch.
#
# Idempotent, and that matters more here than anywhere else in this directory:
# the script reads the instance's current settings and includes a field in a
# patch ONLY if it differs. A re-run when everything already matches issues no
# patch at all and therefore causes no restart. Blindly re-patching with
# identical values would risk a gratuitous production outage.
#
# Source: implementation-plan.md work package P8-DB-01;
# architecture/reliability-and-disaster-recovery.md sections 3, 6, 7, 15, 17;
# architecture/networking.md section 11 ("Connection Pooling");
# development/runbooks.md section 1.2 and its gap list items 2 and 6.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 14-cloud-sql-hardening.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config \
  VERDERY_SQL_AVAILABILITY_TYPE \
  VERDERY_SQL_TIER \
  VERDERY_SQL_MAX_CONNECTIONS \
  VERDERY_SQL_STORAGE_AUTO_RESIZE_LIMIT_GB \
  VERDERY_SQL_BACKUP_START_TIME \
  VERDERY_SQL_RETAINED_BACKUPS \
  VERDERY_SQL_RETAINED_TRANSACTION_LOG_DAYS \
  VERDERY_SQL_MAINTENANCE_WINDOW_DAY \
  VERDERY_SQL_MAINTENANCE_WINDOW_HOUR \
  VERDERY_SQL_MAINTENANCE_RELEASE_CHANNEL
require_explicit_apply \
  "restarts ${VERDERY_SQL_INSTANCE_NAME} and raises its bill by roughly 100 USD/month."

resource_exists gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  || fail "Cloud SQL instance ${VERDERY_SQL_INSTANCE_NAME} does not exist. Run 03-cloud-sql.sh first."

read_setting() {
  gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --format="value(${1})"
}

current_tier="$(read_setting settings.tier)"
current_availability="$(read_setting settings.availabilityType)"
current_flags="$(read_setting settings.databaseFlags)"

# --- pass 1: everything that requires a restart, in one patch ---------------
restart_flags=()

if [[ "${current_tier}" != "${VERDERY_SQL_TIER}" ]]; then
  log "Tier ${current_tier} -> ${VERDERY_SQL_TIER} (restart)"
  restart_flags+=("--tier=${VERDERY_SQL_TIER}")
else
  log "Tier already ${VERDERY_SQL_TIER}"
fi

if [[ "${current_availability}" != "${VERDERY_SQL_AVAILABILITY_TYPE}" ]]; then
  log "Availability ${current_availability} -> ${VERDERY_SQL_AVAILABILITY_TYPE} (restart)"
  restart_flags+=("--availability-type=${VERDERY_SQL_AVAILABILITY_TYPE}")
else
  log "Availability already ${VERDERY_SQL_AVAILABILITY_TYPE}"
fi

# `--database-flags` REPLACES the entire flag set rather than merging into it.
# `cloudsql.iam_authentication=on` is what every Cloud Run service and the
# migration job authenticate with (07-iam-database-bootstrap.sh, deploy-api.sh
# `DATABASE_CONNECTION_MODE=cloudSqlIam`), so it is restated here explicitly.
# Omitting it would not "leave it alone" — it would turn it off and lock every
# workload out of the database.
desired_flags="cloudsql.iam_authentication=on,max_connections=${VERDERY_SQL_MAX_CONNECTIONS}"

if [[ "${current_flags}" == *"'max_connections', 'value': '${VERDERY_SQL_MAX_CONNECTIONS}'"* ]]; then
  log "max_connections already ${VERDERY_SQL_MAX_CONNECTIONS}"
else
  log "max_connections -> ${VERDERY_SQL_MAX_CONNECTIONS} (restart; static PostgreSQL parameter)"
  log "  Connection budget: API ${VERDERY_API_MAX_INSTANCES:-?} instances x ${VERDERY_DATABASE_POOL_MAX_CONNECTIONS:-?} pooled,"
  log "  workers 2 x 5, migration job 1 x 2, plus Cloud SQL's own reserved connections."
  log "  See config/${ENVIRONMENT}.env for the full arithmetic."
  restart_flags+=("--database-flags=${desired_flags}")
fi

if [[ ${#restart_flags[@]} -eq 0 ]]; then
  log "No restart-requiring change needed."
else
  log ""
  log "APPLYING ${#restart_flags[@]} RESTART-REQUIRING CHANGE(S) IN ONE PATCH."
  log "${VERDERY_SQL_INSTANCE_NAME} will be unavailable for several minutes."
  log ""
  gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    "${restart_flags[@]}" \
    --quiet
fi

# --- pass 2: everything that restarts nothing -------------------------------
# Applied unconditionally. Each of these is a metadata change Cloud SQL accepts
# without interrupting connections, so there is no restart to avoid and no
# reason to make the script guess whether it is needed.
#
# `--enable-point-in-time-recovery` is stated even though it is already on:
# section 7 asks for a PITR window "sufficient for the RPO target" (section 3:
# five minutes), and a setting that is only correct because nobody changed the
# default is not a configuration — it is a coincidence. Restating it is what
# makes this script, rather than the console, the authority.
log "Applying backup, retention, storage-cap, and maintenance settings (no restart)"
gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --backup-start-time="${VERDERY_SQL_BACKUP_START_TIME}" \
  --retained-backups-count="${VERDERY_SQL_RETAINED_BACKUPS}" \
  --retained-transaction-log-days="${VERDERY_SQL_RETAINED_TRANSACTION_LOG_DAYS}" \
  --enable-point-in-time-recovery \
  --storage-auto-increase \
  --storage-auto-increase-limit="${VERDERY_SQL_STORAGE_AUTO_RESIZE_LIMIT_GB}" \
  --maintenance-window-day="${VERDERY_SQL_MAINTENANCE_WINDOW_DAY}" \
  --maintenance-window-hour="${VERDERY_SQL_MAINTENANCE_WINDOW_HOUR}" \
  --maintenance-release-channel="${VERDERY_SQL_MAINTENANCE_RELEASE_CHANNEL}" \
  --insights-config-query-insights-enabled \
  --quiet

# --- deletion protection, last ----------------------------------------------
# Last on purpose: every `gcloud sql instances patch` above still succeeds with
# it on, but doing it first would mean a failed run leaves an instance that is
# harder to tear down and rebuild. It is also the single highest-value line in
# this file — the runbooks record that a mistaken `gcloud sql instances delete`
# succeeds today — and it costs nothing and restarts nothing.
if [[ "$(read_setting settings.deletionProtectionEnabled)" == "True" ]]; then
  log "Deletion protection already enabled"
else
  log "Enabling deletion protection"
  gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --deletion-protection \
    --quiet
fi

log ""
log "Final state:"
gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --format='yaml(settings.tier,settings.availabilityType,settings.deletionProtectionEnabled,settings.databaseFlags,settings.storageAutoResizeLimit,settings.backupConfiguration,settings.maintenanceWindow,gceZone,secondaryGceZone)'

log ""
log "STILL OWED, and not automatable here:"
log " - A timed restore drill. reliability-and-disaster-recovery.md section 7:"
log "   'Backups are not considered valid until restoration is tested.' No restore"
log "   has ever been performed against any instance in this project. Regional HA"
log "   protects against a zone failure; it does NOT protect against a destructive"
log "   command, and only a restore does."
log " - A failover drill: gcloud sql instances failover ${VERDERY_SQL_INSTANCE_NAME}"
log "   This is the evidence P8-DB-01 is judged on and it causes a real, brief outage."
log " - Confirming the deployed API actually carries the pool size this ceiling"
log "   assumes: DATABASE_POOL_MAX_CONNECTIONS on ${VERDERY_CLOUD_RUN_SERVICE_NAME}"
log "   must be ${VERDERY_DATABASE_POOL_MAX_CONNECTIONS:-unset} and --max-instances"
log "   must be ${VERDERY_API_MAX_INSTANCES:-unset}. deploy-api.sh reads both from"
log "   config/${ENVIRONMENT}.env; verify.sh checks neither."
