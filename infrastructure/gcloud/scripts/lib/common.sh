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
