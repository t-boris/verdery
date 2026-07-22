#!/usr/bin/env bash
# Enables every API the remaining scripts and the deployed service depend on.
#
# Source: implementation-plan.md work package P1-PLAT-01.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 01-enable-apis.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

# One entry per API, with the reason it is needed rather than a bare list —
# an API enabled without a documented reason is a future "can this be turned
# off" question nobody can answer.
declare -A APIS=(
  [compute.googleapis.com]="VPC network and subnet for Direct VPC egress"
  [servicenetworking.googleapis.com]="Private services access peering for Cloud SQL private IP"
  [sqladmin.googleapis.com]="Cloud SQL instance management"
  [run.googleapis.com]="Cloud Run deployment"
  [artifactregistry.googleapis.com]="Container image storage"
  [iam.googleapis.com]="Service account management"
  [iamcredentials.googleapis.com]="Workload identity federation token exchange"
  [sts.googleapis.com]="Workload identity federation token exchange"
  [secretmanager.googleapis.com]="Database URL and other runtime secrets"
  [cloudtrace.googleapis.com]="OpenTelemetry trace export, P1-OBS-01"
  [logging.googleapis.com]="Structured application logs"
  [monitoring.googleapis.com]="Dashboards and alerting"
  [cloudresourcemanager.googleapis.com]="IAM policy binding on the project"
)

for api in "${!APIS[@]}"; do
  log "${api}: ${APIS[${api}]}"
  enable_api_if_needed "${api}"
done

log "All required APIs are enabled."
