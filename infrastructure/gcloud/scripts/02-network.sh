#!/usr/bin/env bash
# Creates the VPC network, a subnet in the target region, and the private
# services access peering that Cloud SQL's private IP depends on.
#
# ADR-0007 requires the primary data plane to stay off the public internet
# where practical; Cloud SQL private IP plus Cloud Run Direct VPC egress keeps
# database traffic on Google's private network without a NAT gateway or a
# Serverless VPC Access connector.
#
# Source: implementation-plan.md work package P1-PLAT-01;
# architecture/decisions/ADR-0007-us-central1-production-baseline.md.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 02-network.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

if resource_exists gcloud compute networks describe "${VERDERY_NETWORK_NAME}" --project="${VERDERY_PROJECT_ID}"; then
  log "Network already exists: ${VERDERY_NETWORK_NAME}"
else
  log "Creating network: ${VERDERY_NETWORK_NAME}"
  gcloud compute networks create "${VERDERY_NETWORK_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --subnet-mode=custom \
    --bgp-routing-mode=regional
fi

if resource_exists gcloud compute networks subnets describe "${VERDERY_SUBNET_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --region="${VERDERY_REGION}"; then
  log "Subnet already exists: ${VERDERY_SUBNET_NAME}"
else
  log "Creating subnet: ${VERDERY_SUBNET_NAME} (${VERDERY_SUBNET_RANGE})"
  gcloud compute networks subnets create "${VERDERY_SUBNET_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --network="${VERDERY_NETWORK_NAME}" \
    --region="${VERDERY_REGION}" \
    --range="${VERDERY_SUBNET_RANGE}" \
    --enable-private-ip-google-access
fi

if resource_exists gcloud compute addresses describe "${VERDERY_PEERING_RANGE_NAME}" \
  --project="${VERDERY_PROJECT_ID}" --global; then
  log "Peering IP range already allocated: ${VERDERY_PEERING_RANGE_NAME}"
else
  log "Allocating peering IP range: ${VERDERY_PEERING_RANGE_NAME}"
  gcloud compute addresses create "${VERDERY_PEERING_RANGE_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --purpose=VPC_PEERING \
    --prefix-length="${VERDERY_PEERING_PREFIX_LENGTH}" \
    --network="${VERDERY_NETWORK_NAME}"
fi

# `services vpc-peerings connect` is itself idempotent — connecting an
# already-connected range succeeds without changing anything — so no
# existence check is needed here.
#
# Immediately after `servicenetworking.googleapis.com` is first enabled on a
# project, this call can fail once with "invalid authentication credentials"
# while Service Networking's own service identity finishes provisioning.
# Observed directly while writing this script: it failed once, then succeeded
# 30 seconds later with no other change. Retrying is therefore the correct
# response, not a workaround for a real auth problem.
log "Ensuring private services access peering exists"
peering_attempts=0
until gcloud services vpc-peerings connect \
  --project="${VERDERY_PROJECT_ID}" \
  --service=servicenetworking.googleapis.com \
  --ranges="${VERDERY_PEERING_RANGE_NAME}" \
  --network="${VERDERY_NETWORK_NAME}"; do
  peering_attempts=$((peering_attempts + 1))
  [[ ${peering_attempts} -lt 5 ]] || fail "VPC peering connect did not succeed after ${peering_attempts} attempts"
  log "Peering connect failed (attempt ${peering_attempts}/5); Service Networking identity may still be provisioning. Retrying in 30s."
  sleep 30
done

log "Network ${VERDERY_NETWORK_NAME} ready with private services access."
