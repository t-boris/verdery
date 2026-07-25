#!/usr/bin/env bash
# Shared helpers for the provisioning scripts.
#
# Every script sources this file and then `load_environment_config`, which
# reads infrastructure/gcloud/config/<environment>.env. Nothing environment-
# specific is hardcoded past that point, so the same script provisions
# verdery-dev today and verdery-staging or verdery-prod later.
#
# Source: ADR-0011.

set -euo pipefail

SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GCLOUD_ROOT="$(cd "${SCRIPT_LIB_DIR}/../.." && pwd)"

log() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# Reads infrastructure/gcloud/config/<environment>.env and exports every
# VERDERY_* variable it defines.
load_environment_config() {
  local environment="${1:?usage: load_environment_config <environment>}"
  local config_file="${GCLOUD_ROOT}/config/${environment}.env"

  [[ -f "${config_file}" ]] || fail "No configuration file at ${config_file}"

  set -a
  # shellcheck disable=SC1090
  source "${config_file}"
  set +a

  [[ "${VERDERY_ENVIRONMENT:-}" != "" ]] || fail "${config_file} did not set VERDERY_ENVIRONMENT"
}

# True (exit 0) when the currently active gcloud project matches the
# configured one. Every script checks this before mutating anything, so a
# stale `gcloud config set project` elsewhere in the shell cannot cause a
# script to provision the wrong project.
require_active_project() {
  local active
  active="$(gcloud config get-value project 2>/dev/null)"

  if [[ "${active}" != "${VERDERY_PROJECT_ID}" ]]; then
    fail "Active gcloud project is '${active}', expected '${VERDERY_PROJECT_ID}'. Run: gcloud config set project ${VERDERY_PROJECT_ID}"
  fi
}

# Enables an API only if it is not already enabled. `gcloud services enable`
# is itself idempotent, but checking first avoids an unnecessary API call and
# makes the "already enabled" case visibly distinct from "just enabled" in the
# log.
enable_api_if_needed() {
  local api="${1:?usage: enable_api_if_needed <api>}"

  if gcloud services list --enabled --filter="config.name:${api}" --format="value(config.name)" | grep -q "^${api}$"; then
    log "API already enabled: ${api}"
  else
    log "Enabling API: ${api}"
    gcloud services enable "${api}" --project="${VERDERY_PROJECT_ID}"
  fi
}

resource_exists() {
  # usage: resource_exists <gcloud describe/list command...>
  # Returns success if the command exits 0, i.e. the resource was found.
  "$@" >/dev/null 2>&1
}

# Fails, naming the variable, unless every argument is a set and non-empty
# variable name.
#
# config/prod.env deliberately leaves owner-decision values (domain names, the
# alert address, the budget amount) EMPTY rather than filling in a plausible
# placeholder, because a script cannot tell a placeholder from a real value and
# would happily request a managed certificate for it. This helper is the other
# half of that decision: the script stops before it acts.
#
# Source: P8-NET-01 / P8-DB-01.
require_config() {
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || fail \
      "${name} is empty. Set it in infrastructure/gcloud/config/<environment>.env (see its OWNER DECISION markers)."
  done
}

# Guard for the scripts that create billable, owner-gated production
# infrastructure: the load balancer, the Cloud Armor policy, regional Cloud SQL
# (which restarts the instance), the alert policies, and the budget.
#
# The numbered 00-10 scripts are safe to run casually — they create free or
# near-free resources in a development project. These are not: they start a
# monthly bill, or take a production database down for the length of a restart.
# Requiring an explicit VERDERY_APPLY=yes means no such script can run because
# a command was pasted into the wrong terminal or because provision.sh grew a
# line, and it keeps the cost statement in front of the operator at the moment
# they decide.
#
# Source: P8-NET-01 / P8-DB-01; environments-and-delivery.md section 5
# ("Destructive changes require a dedicated reviewed command").
require_explicit_apply() {
  local what="${1:?usage: require_explicit_apply <what this script does>}"

  log "This script ${what}"
  if [[ "${VERDERY_APPLY:-}" != "yes" ]]; then
    fail "Refusing to run without an explicit opt-in. Re-run as: VERDERY_APPLY=yes bash <script> <environment>"
  fi
}
