#!/usr/bin/env bash
# Creates the Cloud SQL for PostgreSQL instance on a private IP, plus the
# application database.
#
# Database roles (verdery_application, verdery_migration) are NOT created
# here — they are created by the reviewed SQL migration
# services/api/migrations/1784710800000_platform-baseline.sql, which is the
# single source of truth for schema ownership. This script only creates the
# instance those migrations run against.
#
# Source: implementation-plan.md work package P1-PLAT-01;
# architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md (version);
# architecture/data-and-geospatial-design.md, section "3. Schema Ownership".

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 03-cloud-sql.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

if resource_exists gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" --project="${VERDERY_PROJECT_ID}"; then
  log "Cloud SQL instance already exists: ${VERDERY_SQL_INSTANCE_NAME}"
else
  log "Creating Cloud SQL instance: ${VERDERY_SQL_INSTANCE_NAME} (${VERDERY_SQL_DATABASE_VERSION}, ${VERDERY_SQL_TIER})"
  log "This takes several minutes."
  # Cloud SQL for PostgreSQL now defaults to the Enterprise_Plus edition,
  # which rejects shared-core tiers like db-f1-micro ("Invalid Tier for
  # ENTERPRISE_PLUS Edition"). The Enterprise edition still accepts them, so it
  # is requested explicitly rather than switching to a larger, more expensive
  # tier the dev environment does not need.
  gcloud sql instances create "${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --edition=ENTERPRISE \
    --database-version="${VERDERY_SQL_DATABASE_VERSION}" \
    --tier="${VERDERY_SQL_TIER}" \
    --region="${VERDERY_REGION}" \
    --network="projects/${VERDERY_PROJECT_ID}/global/networks/${VERDERY_NETWORK_NAME}" \
    --no-assign-ip \
    --storage-auto-increase \
    --storage-size=10GB \
    --storage-type=SSD \
    --availability-type=zonal \
    --backup-start-time=09:00 \
    --enable-point-in-time-recovery
fi

if resource_exists gcloud sql databases describe "${VERDERY_SQL_DATABASE_NAME}" \
  --instance="${VERDERY_SQL_INSTANCE_NAME}" --project="${VERDERY_PROJECT_ID}"; then
  log "Database already exists: ${VERDERY_SQL_DATABASE_NAME}"
else
  log "Creating database: ${VERDERY_SQL_DATABASE_NAME}"
  gcloud sql databases create "${VERDERY_SQL_DATABASE_NAME}" \
    --instance="${VERDERY_SQL_INSTANCE_NAME}" \
    --project="${VERDERY_PROJECT_ID}"
fi

private_ip="$(gcloud sql instances describe "${VERDERY_SQL_INSTANCE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --format="value(ipAddresses[0].ipAddress)")"

log "Cloud SQL instance ${VERDERY_SQL_INSTANCE_NAME} ready at private IP ${private_ip}."
log "No public IP is assigned; reachable only from ${VERDERY_NETWORK_NAME} and Cloud Run Direct VPC egress."
