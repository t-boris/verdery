#!/usr/bin/env bash
# Orchestrates the full P2-QA-01 browser E2E run: a throwaway Postgres, the
# Firebase Auth emulator, the real API, and the real web app, all pointed at
# each other, followed by `playwright test` against the whole live stack.
#
# WHY A SHELL SCRIPT AND NOT A VITEST/PLAYWRIGHT GLOBAL SETUP
#
# Four independent long-running processes (Postgres, the Auth emulator, the
# API, the web app) need to start in dependency order, be health-checked, and
# be torn down together on success, failure, or Ctrl-C. That is exactly the
# shape of the provisioning scripts in infrastructure/gcloud/scripts/ — a
# trap-based cleanup around ordered steps with clear log() lines — so this
# script follows that same convention rather than inventing a Node-based
# process manager.
#
# WHY THE PORTS BELOW
#
# Every port is deliberately non-default (5432, 8080, 3000) so this script
# never collides with a developer's own `pnpm dev` or local Postgres running
# alongside it.
#
# Source: architecture/testing-strategy.md, section 9 ("Playwright for
# browser end-to-end behavior"), section 20 ("Register and create first
# garden"); docs/implementation-plan.md, work package P2-QA-01.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${REPO_ROOT}"

log() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# --- Fixed, non-default ports for this run ----------------------------------
DB_PORT=55432
DB_NAME=verdery_e2e
DB_USER=verdery
DB_PASSWORD=verdery
API_PORT=8090
WEB_PORT=3100
AUTH_EMULATOR_PORT=9099 # Fixed by firebase.json; not this script's to choose.
FIREBASE_PROJECT_ID=demo-verdery-e2e

DB_CONTAINER_NAME=verdery-e2e-postgres
POSTGIS_IMAGE=postgis/postgis:17-3.5
# The image ships amd64 only; Testcontainers-based integration tests
# (services/api/tests/integration/gardens-mapping.test.ts) hit the same
# constraint and pin the same platform for the same reason.
POSTGIS_PLATFORM=linux/amd64

LOG_DIR="$(mktemp -d)"
FIREBASE_LOG="${LOG_DIR}/firebase-emulator.log"
API_LOG="${LOG_DIR}/api.log"
WEB_LOG="${LOG_DIR}/web.log"

# --- Cleanup, guaranteed on success, failure, or interruption ---------------
FIREBASE_PID=""
API_PID=""
WEB_PID=""

cleanup() {
  local exit_code=$?

  log "Cleaning up (exit code ${exit_code})"

  [[ -n "${WEB_PID}" ]] && kill "${WEB_PID}" 2>/dev/null || true
  [[ -n "${API_PID}" ]] && kill "${API_PID}" 2>/dev/null || true
  [[ -n "${FIREBASE_PID}" ]] && kill "${FIREBASE_PID}" 2>/dev/null || true

  # Give each a moment to release its port before the container goes too;
  # none of this is load-bearing for correctness, only for a clean re-run.
  sleep 1

  if docker ps -aq --filter "name=^${DB_CONTAINER_NAME}\$" | grep -q .; then
    log "Removing Postgres container ${DB_CONTAINER_NAME}"
    docker rm -f "${DB_CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi

  log "Logs for this run are kept at ${LOG_DIR}"
  exit "${exit_code}"
}
trap cleanup EXIT

# --- Waits until a URL returns any HTTP response, or fails ------------------
wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_seconds="$3"
  local waited=0

  until curl --silent --fail --output /dev/null "${url}"; do
    if [[ "${waited}" -ge "${timeout_seconds}" ]]; then
      fail "${name} did not become ready at ${url} within ${timeout_seconds}s. See ${LOG_DIR}."
    fi
    sleep 1
    waited=$((waited + 1))
  done

  log "${name} is ready (${url})"
}

command -v docker >/dev/null || fail "Docker is required to start the throwaway Postgres for this run."
command -v firebase >/dev/null || fail "The Firebase CLI is required (firebase emulators:start --only auth)."

# --- 1. Throwaway Postgres ---------------------------------------------------
log "Starting Postgres (${POSTGIS_IMAGE}) on port ${DB_PORT}"
docker rm -f "${DB_CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${DB_CONTAINER_NAME}" \
  --platform "${POSTGIS_PLATFORM}" \
  -e "POSTGRES_USER=${DB_USER}" \
  -e "POSTGRES_PASSWORD=${DB_PASSWORD}" \
  -e "POSTGRES_DB=${DB_NAME}" \
  -p "${DB_PORT}:5432" \
  "${POSTGIS_IMAGE}" >/dev/null

log "Waiting for Postgres to accept connections"
waited=0
until docker exec "${DB_CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
  if [[ "${waited}" -ge 60 ]]; then
    fail "Postgres did not become ready within 60s."
  fi
  sleep 1
  waited=$((waited + 1))
done
log "Postgres is ready"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

# --- 2. Firebase Auth emulator ----------------------------------------------
log "Starting the Firebase Auth emulator on port ${AUTH_EMULATOR_PORT}"
firebase emulators:start --only auth --project "${FIREBASE_PROJECT_ID}" >"${FIREBASE_LOG}" 2>&1 &
FIREBASE_PID=$!
wait_for_http "Auth emulator" "http://127.0.0.1:${AUTH_EMULATOR_PORT}/emulator/v1/projects/${FIREBASE_PROJECT_ID}/config" 30

# --- 3. Migrations, then the API --------------------------------------------
log "Building the API"
pnpm --filter @verdery/api build

log "Running database migrations"
VERDERY_ENVIRONMENT=development \
  FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID}" \
  DATABASE_CONNECTION_MODE=url \
  DATABASE_URL="${DATABASE_URL}" \
  pnpm --filter @verdery/api migrate

log "Starting the API on port ${API_PORT}"
VERDERY_ENVIRONMENT=development \
  SERVICE_VERSION=e2e \
  HTTP_HOST=0.0.0.0 \
  HTTP_PORT="${API_PORT}" \
  HTTP_ALLOWED_ORIGINS="http://localhost:${WEB_PORT}" \
  LOG_LEVEL=info \
  FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID}" \
  FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_EMULATOR_PORT}" \
  DATABASE_CONNECTION_MODE=url \
  DATABASE_URL="${DATABASE_URL}" \
  TRACING_ENABLED=false \
  node --import "${REPO_ROOT}/services/api/dist/telemetry-bootstrap.js" "${REPO_ROOT}/services/api/dist/main.js" \
  >"${API_LOG}" 2>&1 &
API_PID=$!
wait_for_http "API" "http://localhost:${API_PORT}/v1/health/ready" 30

# --- 4. The web app, pointed at the API and the Auth emulator ---------------
log "Starting the web app (next dev) on port ${WEB_PORT}"
NEXT_PUBLIC_API_ORIGIN="http://localhost:${API_PORT}" \
  NEXT_PUBLIC_FIREBASE_API_KEY=demo-verdery-e2e-api-key \
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${FIREBASE_PROJECT_ID}.firebaseapp.com" \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID}" \
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="${FIREBASE_PROJECT_ID}.firebasestorage.app" \
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000 \
  NEXT_PUBLIC_FIREBASE_APP_ID="1:000000000000:web:e2e" \
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true \
  NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=6LfS618tAAAAAMMgqPSYDBKUEMdZ9xKQJGdv3Ehm \
  pnpm --filter @verdery/web exec next dev --port "${WEB_PORT}" \
  >"${WEB_LOG}" 2>&1 &
WEB_PID=$!
wait_for_http "Web app" "http://localhost:${WEB_PORT}/auth/sign-in" 60

# --- 5. The suite itself -----------------------------------------------------
log "Running Playwright"
set +e
E2E_WEB_BASE_URL="http://localhost:${WEB_PORT}" \
  pnpm --filter @verdery/web test:e2e
PLAYWRIGHT_EXIT_CODE=$?
set -e

if [[ "${PLAYWRIGHT_EXIT_CODE}" -eq 0 ]]; then
  log "Playwright passed."
else
  log "Playwright failed (exit ${PLAYWRIGHT_EXIT_CODE}). API log: ${API_LOG}; web log: ${WEB_LOG}"
fi

exit "${PLAYWRIGHT_EXIT_CODE}"
