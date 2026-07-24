#!/usr/bin/env bash
# Runs every idempotent provisioning script in order for one environment.
#
# Deliberately stops short of 07-iam-database-bootstrap.sh: that script
# briefly assigns Cloud SQL a public IP to perform a one-time grant, and an
# operator should run it attended, with its output visible, rather than have
# it fire unattended as step 8 of an "provision everything" script.
#
# Source: implementation-plan.md work package P1-PLAT-01
# ("reviewed development plan" completion evidence).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ENVIRONMENT="${1:?usage: provision.sh <environment>}"

for step in \
  00-create-project.sh \
  01-enable-apis.sh \
  02-network.sh \
  03-cloud-sql.sh \
  04-artifact-registry.sh \
  05-service-accounts.sh \
  06-workload-identity-federation.sh \
  08-app-check-recaptcha.sh \
  09-media-storage.sh \
  10-media-processing-queue.sh; do
  echo "=== ${step} ==="
  bash "${step}" "${ENVIRONMENT}"
  echo
done

echo "Provisioning complete. Run 07-iam-database-bootstrap.sh next, attended,"
echo "naming the service account(s) that need database access — including the"
echo "worker service account 10-media-processing-queue.sh just created, which"
echo "additionally needs verdery_worker membership (see that script's own"
echo "header comment for the follow-up 07-iam-database-bootstrap.sh does not"
echo "yet automate):"
echo
echo "  bash 07-iam-database-bootstrap.sh ${ENVIRONMENT} <service-account-email>..."
