#!/usr/bin/env bash
# Creates the Artifact Registry Docker repository CI pushes deploy images to.
#
# Source: implementation-plan.md work package P1-PLAT-03 ("Artifact Registry").

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 04-artifact-registry.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

if resource_exists gcloud artifacts repositories describe "${VERDERY_ARTIFACT_REPOSITORY}" \
  --project="${VERDERY_PROJECT_ID}" --location="${VERDERY_REGION}"; then
  log "Artifact Registry repository already exists: ${VERDERY_ARTIFACT_REPOSITORY}"
else
  log "Creating Artifact Registry repository: ${VERDERY_ARTIFACT_REPOSITORY}"
  gcloud artifacts repositories create "${VERDERY_ARTIFACT_REPOSITORY}" \
    --project="${VERDERY_PROJECT_ID}" \
    --location="${VERDERY_REGION}" \
    --repository-format=docker \
    --description="Verdery container images"
fi

log "Artifact Registry repository ${VERDERY_ARTIFACT_REPOSITORY} ready at ${VERDERY_REGION}-docker.pkg.dev/${VERDERY_PROJECT_ID}/${VERDERY_ARTIFACT_REPOSITORY}."
