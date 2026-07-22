#!/usr/bin/env bash
# Bootstraps Cloud SQL IAM database authentication: enables the IAM auth flag,
# creates an IAM database user for each service account that needs to connect,
# and grants those users membership in the NOLOGIN group roles the migration
# creates (verdery_application, verdery_migration).
#
# WHY THIS SCRIPT EXISTS, AND WHY IT IS UNLIKE THE OTHERS
#
# services/api/migrations/1784710800000_platform-baseline.sql creates
# verdery_application and verdery_migration as NOLOGIN roles on purpose: no
# password for either role is ever meant to exist. The running service and the
# migration step are meant to authenticate as their own Cloud SQL IAM database
# user (named after their service account) and reach the schema only through
# membership in these roles.
#
# Granting that membership requires an authenticated SQL session — a control
# plane call cannot do it — and this Cloud SQL instance intentionally has no
# public IP, so the only network path from this workstation is a *temporary*
# public IP restricted to the caller's own address for the few seconds this
# script needs. The instance is returned to private-IP-only in every exit path,
# including failure, via the trap below.
#
# This script therefore does something the others do not: it briefly changes
# the instance's public exposure. Read it before running it.
#
# Source: implementation-plan.md work packages P1-PLAT-02, P1-DATA-01;
# services/api/migrations/1784710800000_platform-baseline.sql.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 07-iam-database-bootstrap.sh <environment> <service-account-email>...}"
shift
SERVICE_ACCOUNT_EMAILS=("$@")
[[ ${#SERVICE_ACCOUNT_EMAILS[@]} -gt 0 ]] || fail "Provide at least one service account email to grant database access to"

load_environment_config "${ENVIRONMENT}"
require_active_project

BREAK_GLASS_SECRET_NAME="${VERDERY_SQL_INSTANCE_NAME}-postgres-superuser-password"
PUBLIC_ACCESS_OPENED=0

# Runs on any exit — success, error, or Ctrl-C — so a failure partway through
# the bootstrap can never leave the database reachable from the public
# internet.
close_public_access() {
  if [[ "${PUBLIC_ACCESS_OPENED}" -eq 1 ]]; then
    log "Reverting ${VERDERY_SQL_INSTANCE_NAME} to private-IP-only"
    gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" --no-assign-ip --quiet >/dev/null
  fi
}
trap close_public_access EXIT

iam_db_username_for() {
  # Cloud SQL requires IAM service-account database usernames without the
  # ".gserviceaccount.com" suffix.
  echo "${1%.gserviceaccount.com}"
}

log "Enabling Cloud SQL IAM database authentication"
gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --database-flags=cloudsql.iam_authentication=on \
  --quiet >/dev/null

missing_grants=()
for email in "${SERVICE_ACCOUNT_EMAILS[@]}"; do
  db_username="$(iam_db_username_for "${email}")"

  if resource_exists gcloud sql users describe "${db_username}" \
    --instance="${VERDERY_SQL_INSTANCE_NAME}" --project="${VERDERY_PROJECT_ID}"; then
    log "IAM database user already exists: ${db_username}"
  else
    log "Creating IAM database user: ${db_username}"
    gcloud sql users create "${db_username}" \
      --instance="${VERDERY_SQL_INSTANCE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" \
      --type=cloud_iam_service_account
  fi

  missing_grants+=("${db_username}")
done

if [[ ${#missing_grants[@]} -eq 0 ]]; then
  log "Nothing to grant."
  exit 0
fi

if ! resource_exists gcloud secrets describe "${BREAK_GLASS_SECRET_NAME}" --project="${VERDERY_PROJECT_ID}"; then
  log "Creating break-glass postgres superuser secret: ${BREAK_GLASS_SECRET_NAME}"
  gcloud secrets create "${BREAK_GLASS_SECRET_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --replication-policy=automatic \
    --labels="purpose=break-glass,used-by=none" >/dev/null
fi

superuser_password="$(openssl rand -base64 24)"
printf '%s' "${superuser_password}" | gcloud secrets versions add "${BREAK_GLASS_SECRET_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --data-file=- >/dev/null

log "Rotating the postgres superuser password (stored only in Secret Manager, never in this script's output)"
gcloud sql users set-password postgres \
  --instance="${VERDERY_SQL_INSTANCE_NAME}" --project="${VERDERY_PROJECT_ID}" \
  --password="${superuser_password}" >/dev/null

caller_ip="$(curl -s https://api.ipify.org)"
[[ "${caller_ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not determine this machine's public IP"

log "Temporarily allowing ${caller_ip}/32 to reach ${VERDERY_SQL_INSTANCE_NAME} for the grant below"
gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --assign-ip \
  --authorized-networks="${caller_ip}/32" \
  --quiet >/dev/null
PUBLIC_ACCESS_OPENED=1

public_ip="$(gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --format="value(ipAddresses[0].ipAddress)")"

grant_statements=""
for db_username in "${missing_grants[@]}"; do
  grant_statements+="GRANT verdery_application TO \"${db_username}\";"$'\n'
  grant_statements+="GRANT verdery_migration TO \"${db_username}\";"$'\n'
done

log "Granting verdery_application and verdery_migration membership to: ${missing_grants[*]}"
PGPASSWORD="${superuser_password}" psql \
  "host=${public_ip} sslmode=require user=postgres dbname=${VERDERY_SQL_DATABASE_NAME}" \
  -v ON_ERROR_STOP=1 <<SQL
${grant_statements}

-- node-pg-migrate creates its own tracking table the first time any
-- migration runs, owned by whichever identity ran that first migration
-- (this superuser, on a fresh environment). The migration file grants
-- verdery_migration CREATE on schema public for the table's initial
-- creation, but ownership of an already-existing table is separate from
-- schema-level CREATE, so every subsequent least-privilege migration run
-- also needs explicit row access to the table the first run already made.
--
-- Row privileges on the table are not enough: `id` is a serial column, so
-- every INSERT into pgmigrations calls nextval() on the sequence Postgres
-- generated for it, and a sequence is its own relation with its own ACL —
-- GRANT INSERT on the table never implies USAGE on the sequence behind one
-- of its columns. Discovered when a real migration run against verdery-dev
-- applied its DDL successfully and then failed with "permission denied for
-- sequence pgmigrations_id_seq" on node-pg-migrate's own bookkeeping insert.
--
-- Harmless to run before the table exists: GRANT on a name with no matching
-- relation is simply a no-op in Postgres, not an error, so this script stays
-- correct whether it runs before or after the very first migration.
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pgmigrations') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pgmigrations TO verdery_migration;
    GRANT USAGE, SELECT ON public.pgmigrations_id_seq TO verdery_migration;
  END IF;
END
\$\$;
SQL

log "Grants applied. Public access will be removed now (see trap)."
