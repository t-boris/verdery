#!/usr/bin/env bash
# Gives services/workers its database identity: a password-authenticated
# Postgres login user that is a member of the `verdery_worker` group role,
# and the Secret Manager secret holding its connection string.
#
# SEPARATE FROM 07-iam-database-bootstrap.sh ON PURPOSE. That script exists
# for Cloud SQL IAM database authentication, which is how services/api
# connects. services/workers deliberately does not use it —
# `services/workers/src/configuration.ts` takes a plain `DATABASE_URL` and
# nothing else, and its own header explains why. Two different authentication
# mechanisms belong in two scripts; folding password auth into a file named
# "iam-database-bootstrap" would make both harder to reason about.
#
# `verdery_worker` itself is created NOLOGIN by 07 and by the platform
# baseline migration, and carries the privileges. This script creates the
# LOGIN user that holds membership in it, the same group-role-plus-member
# shape 07 already uses for `verdery_application`/`verdery_migration`. The
# group keeps owning the grants, so a future privilege change lands in one
# place rather than on a user.
#
# THE PASSWORD IS NEVER PRINTED and never leaves Secret Manager plus the one
# `gcloud sql users` call that sets it. Re-running this script rotates it: the
# secret gets a new version and the SQL user gets the matching password in the
# same run, so the two cannot drift. A rotation does require redeploying (or
# restarting) the workers service, because Cloud Run resolves `:latest` at
# instance start, not per query.
#
# OPENS THE DATABASE TO THIS MACHINE'S IP FOR THE DURATION OF ONE psql
# SESSION, exactly as 07 does, and closes it again from an EXIT trap so that a
# failure cannot leave it open. Cloud SQL offers no way to run arbitrary SQL
# through the API, and the GRANT below has to be SQL.
#
# Source: implementation-plan.md work package P6-WORKER-01;
# architecture/asynchronous-processing.md, section "5. Cloud Tasks";
# infrastructure/gcloud/scripts/07-iam-database-bootstrap.sh, whose
# open/grant/close shape this mirrors.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 18-worker-database-access.sh <environment>}"

load_environment_config "${ENVIRONMENT}"
require_active_project

WORKER_DB_USER="verdery_worker_app"
BREAK_GLASS_SECRET_NAME="${VERDERY_SQL_INSTANCE_NAME}-postgres-superuser-password"
worker_email="${VERDERY_WORKER_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

# One address of a given type, as a bare string.
#
# `.flatten()` is load-bearing: without it the projection yields the Python
# list literal `['10.0.0.1']`, which psql then tries to resolve as a hostname.
# `gcloud sql instances describe` accepts no `--filter`, so the selection has
# to happen inside the format expression.
sql_address() {
  gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --format="value(ipAddresses.filter(\"type:$1\").extract(\"ipAddress\").flatten())" |
    head -n 1
}

PUBLIC_ACCESS_OPENED=0
close_public_access() {
  if [[ "${PUBLIC_ACCESS_OPENED}" -eq 1 ]]; then
    log "Removing public access from ${VERDERY_SQL_INSTANCE_NAME}"
    gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
      --project="${VERDERY_PROJECT_ID}" \
      --no-assign-ip \
      --clear-authorized-networks \
      --quiet >/dev/null || true
  fi
}
trap close_public_access EXIT

if ! resource_exists gcloud iam service-accounts describe "${worker_email}" \
  --project="${VERDERY_PROJECT_ID}"; then
  fail "Worker service account ${worker_email} does not exist — run 10-media-processing-queue.sh first."
fi

superuser_password="$(gcloud secrets versions access latest \
  --secret="${BREAK_GLASS_SECRET_NAME}" --project="${VERDERY_PROJECT_ID}")"
[[ -n "${superuser_password}" ]] || fail "Could not read ${BREAK_GLASS_SECRET_NAME}"

worker_password="$(openssl rand -base64 24)"

log "Setting the ${WORKER_DB_USER} password (generated here, stored only in Secret Manager)"
if gcloud sql users list --instance="${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --format='value(name)' | grep -qx "${WORKER_DB_USER}"; then
  gcloud sql users set-password "${WORKER_DB_USER}" \
    --instance="${VERDERY_SQL_INSTANCE_NAME}" --project="${VERDERY_PROJECT_ID}" \
    --password="${worker_password}" >/dev/null
else
  gcloud sql users create "${WORKER_DB_USER}" \
    --instance="${VERDERY_SQL_INSTANCE_NAME}" --project="${VERDERY_PROJECT_ID}" \
    --password="${worker_password}" >/dev/null
fi

caller_ip="$(curl -s https://api.ipify.org)"
[[ "${caller_ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not determine this machine's public IP"

log "Temporarily allowing ${caller_ip}/32 to reach ${VERDERY_SQL_INSTANCE_NAME} for the grant below"
gcloud sql instances patch "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --assign-ip \
  --authorized-networks="${caller_ip}/32" \
  --quiet >/dev/null
PUBLIC_ACCESS_OPENED=1

public_ip="$(sql_address PRIMARY)"
[[ -n "${public_ip}" ]] || fail "Cloud SQL reported no public address after --assign-ip"

log "Granting verdery_worker membership to ${WORKER_DB_USER}"
PGPASSWORD="${superuser_password}" psql \
  "host=${public_ip} sslmode=require user=postgres dbname=${VERDERY_SQL_DATABASE_NAME}" \
  -v ON_ERROR_STOP=1 <<SQL
-- Created NOLOGIN by 07-iam-database-bootstrap.sh and by the platform
-- baseline migration; guarded here so this script also works against an
-- environment where neither has run yet.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_worker') THEN
    CREATE ROLE verdery_worker NOLOGIN;
  END IF;
END
\$\$;

GRANT verdery_worker TO "${WORKER_DB_USER}";

-- The relay reads and marks rows in the outbox and the processing-job store.
-- Those grants belong to the GROUP role, so they are stated here only to the
-- extent the group does not already hold them; everything schema-level came
-- from the migrations that own those tables.
GRANT CONNECT ON DATABASE "${VERDERY_SQL_DATABASE_NAME}" TO verdery_worker;
SQL

private_ip="$(sql_address PRIVATE)"
[[ -n "${private_ip}" ]] || fail "Cloud SQL has no private address — the worker reaches it over the VPC, not the public one"

log "Storing the connection string in ${VERDERY_WORKER_DATABASE_URL_SECRET_NAME}"
if ! resource_exists gcloud secrets describe "${VERDERY_WORKER_DATABASE_URL_SECRET_NAME}" \
  --project="${VERDERY_PROJECT_ID}"; then
  gcloud secrets create "${VERDERY_WORKER_DATABASE_URL_SECRET_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --replication-policy=automatic --quiet >/dev/null
fi

# The PRIVATE address, deliberately: the workers service runs with
# --vpc-egress=private-ranges-only and reaches Cloud SQL across the VPC. The
# public address this script just borrowed is gone by the time the trap above
# returns.
printf 'postgresql://%s:%s@%s:5432/%s' \
  "${WORKER_DB_USER}" "${worker_password}" "${private_ip}" "${VERDERY_SQL_DATABASE_NAME}" |
  gcloud secrets versions add "${VERDERY_WORKER_DATABASE_URL_SECRET_NAME}" \
    --project="${VERDERY_PROJECT_ID}" --data-file=- >/dev/null

log "Granting ${worker_email} read access to that secret"
gcloud secrets add-iam-policy-binding "${VERDERY_WORKER_DATABASE_URL_SECRET_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --member="serviceAccount:${worker_email}" \
  --role=roles/secretmanager.secretAccessor \
  --quiet >/dev/null

log ""
log "Worker database access is ready. Public access will be removed now (see trap)."
log "Redeploy or restart services/workers to pick up a rotated password."
