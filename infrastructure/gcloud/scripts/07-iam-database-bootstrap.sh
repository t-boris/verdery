#!/usr/bin/env bash
# Bootstraps Cloud SQL IAM database authentication: enables the IAM auth flag,
# creates an IAM database user for each service account that needs to connect,
# grants those users membership in the NOLOGIN group roles the migration
# creates (verdery_application, verdery_migration), and grants
# verdery_migration database-level CREATE so migrations can install Postgres
# "trusted" extensions (see the grant below for what that means and why).
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

-- A Postgres "trusted" extension (one whose control file sets
-- \`trusted = true\`, e.g. pg_trgm) can be installed by any role holding
-- CREATE on the current database — it does not need superuser or Cloud
-- SQL's cloudsqlsuperuser. But CREATE EXTENSION runs as the *connecting*
-- identity, before a migration's own \`SET ROLE verdery_migration\`, so that
-- privilege has to already be held (inherited via role membership, which
-- Postgres roles do by default) at connection time — granting it to
-- verdery_migration itself, the same group role every migration-running IAM
-- user above was just granted membership in, rather than to each
-- per-service-account user individually, keeps this consistent with that
-- pattern and covers every future migration identity automatically.
--
-- Confirmed necessary by a real failure deploying
-- 1784950000000_search-indexes.sql's \`CREATE EXTENSION IF NOT EXISTS
-- pg_trgm\` through the automated migration job against verdery-dev: \`ERROR:
-- permission denied to create extension "pg_trgm" — Must have CREATE
-- privilege on current database\`. Confirmed sufficient (superuser is not
-- required) with a local, non-superuser reproduction before writing this
-- grant.
--
-- This does not help postgis: postgis is not a trusted extension and needs
-- real elevated privilege regardless of database-level CREATE. Only already
-- installed on verdery-dev's already-provisioned database today — a fresh
-- environment's first \`CREATE EXTENSION postgis\` (in
-- 1784710800000_platform-baseline.sql) would hit the same class of failure
-- this grant fixes for pg_trgm, and would need a privileged, superuser-run
-- statement of its own, not this grant. Tracked in
-- docs/implementation-plan.md's Phase 4 review as a known limitation, not
-- fixed here — out of scope for unblocking today's already-provisioned
-- verdery-dev deploy.
GRANT CREATE ON DATABASE "${VERDERY_SQL_DATABASE_NAME}" TO verdery_migration;

-- \`CREATE ROLE\` requires the connecting role to hold \`CREATEROLE\` or be
-- superuser — a least-privilege migration identity has neither, confirmed by
-- a real failure deploying 1785200000000_media-processing-jobs.sql through
-- the automated migration job against verdery-dev: \`ERROR: permission
-- denied to create role\`, even with the statement correctly placed before
-- that migration's own \`SET ROLE verdery_migration\` (the same fix that
-- already worked for \`CREATE EXTENSION pg_trgm\` above does not generalize
-- to \`CREATE ROLE\` — a stronger privilege \`GRANT CREATE ON DATABASE\` does
-- not confer). \`verdery_migration\`/\`verdery_application\` themselves
-- (1784710800000_platform-baseline.sql) only ever succeeded being created by
-- a migration because that migration's very first real run used a more
-- privileged connecting identity than the automated pipeline's ordinary IAM
-- identity uses today — that migration's own comment two sections up
-- ("A superuser has it implicitly; a least-privilege deployment identity
-- does not") already says as much for the ALTER DEFAULT PRIVILEGES grant
-- alongside it. \`verdery_worker\` (1785200000000_media-processing-jobs.sql,
-- P6-ASYNC-01) is the first NEW role any migration has tried to create
-- since that original bootstrap — pre-creating it here, once, with this
-- script's own superuser session, is what lets that migration's identical
-- \`IF NOT EXISTS\` guard skip its own \`CREATE ROLE\` attempt and proceed to
-- its \`GRANT\`s, which verdery_migration's already-held schema-level
-- privileges are sufficient for.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_worker') THEN
    CREATE ROLE verdery_worker NOLOGIN;
  END IF;
END
\$\$;

-- \`postgis\` is not a Postgres "trusted" extension (unlike \`pg_trgm\` above),
-- so \`GRANT CREATE ON DATABASE\` does not help it — it needs this same
-- superuser session, the identical reasoning \`CREATE ROLE verdery_worker\`
-- above already documents for its own privilege class. Currently a no-op on
-- \`verdery-dev\` (already installed there since 1784710800000_platform-
-- baseline.sql's own first run, confirmed by inspection before writing
-- this) — this exists so a genuinely fresh environment's first-ever
-- \`verdery-dev\`-pipeline deploy does not hit the identical class of
-- failure the pg_trgm/verdery_worker incidents already did, discovered and
-- documented (not fixed) as a known limitation in the Phase 4 review and
-- P6-ASYNC-01's own deploy-incident writeup. Version-pinned to match
-- \`platform-baseline.sql\`'s own \`VERSION '3.5.2'\` exactly — installing a
-- different default version here would make that migration's own
-- version-assertion block fail instead of silently succeeding on a
-- version-mismatched extension.
CREATE EXTENSION IF NOT EXISTS postgis VERSION '3.5.2';

-- node-pg-migrate creates its own tracking table the first time any
-- migration runs, owned by whichever identity ran that first migration
-- (this superuser, on a fresh environment). The migration file grants
-- verdery_migration CREATE on schema public for the table's initial
-- creation, but ownership of an already-existing table is separate from
-- schema-level CREATE, so every subsequent least-privilege migration run
-- also needs explicit row access to the table the first run already made.
--
-- Row privileges on the table are not enough: \`id\` is a serial column, so
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
