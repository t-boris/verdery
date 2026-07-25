#!/usr/bin/env bash
#
# Runs one load scenario against a configurable target.
#
# Usage:
#   tests/load/run.sh <scenario> [k6 arguments...]
#
# Example:
#   VERDERY_BASE_URL=https://verdery-api-dev-t6amsr5o6a-uc.a.run.app \
#     tests/load/run.sh smoke
#
# k6 is a single Go binary, not an npm dependency — see
# docs/development/load-testing.md section 2 for why, and section 3 for how to
# install it. This wrapper exists only to fail early and legibly when it is
# missing, when the scenario name is wrong, or when a non-smoke profile is
# pointed at the one environment that actually exists.
set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIO_DIRECTORY="${SCRIPT_DIRECTORY}/scenarios"

if [[ $# -lt 1 ]]; then
  echo "Usage: tests/load/run.sh <scenario> [k6 arguments...]" >&2
  echo "Scenarios:" >&2
  for path in "${SCENARIO_DIRECTORY}"/*.mjs; do
    echo "  $(basename "${path}" .mjs)" >&2
  done
  exit 2
fi

SCENARIO="$1"
shift

SCENARIO_PATH="${SCENARIO_DIRECTORY}/${SCENARIO}.mjs"
if [[ ! -f "${SCENARIO_PATH}" ]]; then
  echo "No such scenario: ${SCENARIO} (${SCENARIO_PATH} does not exist)" >&2
  exit 2
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is not on PATH. Install it, then re-run:" >&2
  echo "  macOS:  brew install k6" >&2
  echo "  Linux:  see https://grafana.com/docs/k6/latest/set-up/install-k6/" >&2
  echo "k6 is deliberately NOT an npm dependency — docs/development/load-testing.md section 2." >&2
  exit 127
fi

BASE_URL="${VERDERY_BASE_URL:-http://localhost:8080}"
PROFILE="${VERDERY_LOAD_PROFILE:-smoke}"

# Anything beyond a smoke profile must be confirmed explicitly, for ANY remote
# target.
#
# The guard is deliberately not a hostname match. The first version of this
# script matched `*verdery-dev*` and silently failed open against the real
# service, whose host is `verdery-api-dev-...` — an allowlist of environment
# names that do not exist yet is a guard that protects nothing. Since the only
# deployed environment today is a development one running with
# --max-instances=2, where a real load profile IS an outage rather than a
# measurement, the safe default is to confirm every non-smoke run and let
# localhost through.
if [[ "${PROFILE}" != "smoke" && "${VERDERY_CONFIRM_NON_SMOKE:-}" != "yes" ]]; then
  case "${BASE_URL}" in
    http://localhost* | http://127.0.0.1* | http://[::1]*) ;;
    *)
      echo "Refusing to run profile '${PROFILE}' against ${BASE_URL}." >&2
      echo "No production-like staging exists; the only deployed environment runs with" >&2
      echo "--max-instances=2, where a real load profile is a self-inflicted outage rather" >&2
      echo "than a measurement. See docs/development/load-testing.md section 1." >&2
      echo "Set VERDERY_CONFIRM_NON_SMOKE=yes to override deliberately." >&2
      exit 3
      ;;
  esac
fi

echo "scenario : ${SCENARIO}"
echo "target   : ${BASE_URL}"
echo "profile  : ${PROFILE}"
echo

exec k6 run "${SCENARIO_PATH}" "$@"
