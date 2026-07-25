#!/usr/bin/env bash
# Enables the Cloud Billing Budget API and creates one monthly budget scoped to
# this project, with threshold notifications at 50%, 90%, and 100% of the
# owner-chosen amount.
#
# SCOPE BOUNDARY: DRAFTED AND SYNTAX-CHECKED (`bash -n`), NOT executed against
# any project.
#
# ---------------------------------------------------------------------------
# WHY THIS IS THE FIRST THING TO RUN, NOT THE LAST
#
# runbooks.md's gap list, ordered by "the ratio of risk removed to effort
# spent", puts this at number one: "No budget, and no way to create one.
# `billingbudgets.googleapis.com` is disabled. With both Cloud Run services
# open to allUsers, the only spend control is `--max-instances=2`. Enabling the
# API and setting one budget with a notification channel is the cheapest risk
# reduction available in this entire document."
#
# Verified again while writing this script: `billingbudgets.googleapis.com` is
# available to the project and not enabled.
#
# A budget does not cap spend — nothing in Google Cloud does, and any document
# that says otherwise is wrong. It sends mail. That is still the difference
# between noticing a runaway bill on the second day and noticing it on the
# invoice, and it is the only cost control that works when the cause is
# something nobody predicted.
#
# ---------------------------------------------------------------------------
# WHAT THE OWNER MUST DO THAT THIS SCRIPT CANNOT
#
# Budgets live on the BILLING ACCOUNT, not the project, so this needs
# `roles/billing.admin` (or `roles/billing.costsManager`) on
# ${VERDERY_BILLING_ACCOUNT_ID}. Project-level permissions are not enough and
# the failure is a permission error, not a validation error.
#
# The amount is `VERDERY_BUDGET_AMOUNT_USD` and is left empty in
# config/prod.env on purpose. A budget threshold is a business decision; the
# README's cost table is the input to it, not a substitute for it.
#
# COST: none. Budgets and their notifications are free.
# DOWNTIME: none. A budget cannot affect running infrastructure.
#
# Idempotent: matched by display name before creation. Changing the amount
# later is `gcloud billing budgets update`, deliberately not something a re-run
# of this script does.
#
# Source: implementation-plan.md work packages P8-NET-01 and P8-DB-01;
# development/runbooks.md gap list item 1; architecture/environments-and-
# delivery.md section 4 ("Monitoring policies and budgets where supported").

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 16-budget.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_config \
  VERDERY_BILLING_ACCOUNT_ID \
  VERDERY_BUDGET_AMOUNT_USD \
  VERDERY_BUDGET_DISPLAY_NAME \
  VERDERY_ALERT_CHANNEL_DISPLAY_NAME
require_explicit_apply \
  "creates a billing budget on account ${VERDERY_BILLING_ACCOUNT_ID}, which needs billing-admin rights."

enable_api_if_needed billingbudgets.googleapis.com

existing_budget="$(gcloud billing budgets list \
  --billing-account="${VERDERY_BILLING_ACCOUNT_ID}" \
  --filter="displayName=\"${VERDERY_BUDGET_DISPLAY_NAME}\"" \
  --format="value(name)" 2>/dev/null | head -n 1)"

if [[ -n "${existing_budget}" ]]; then
  log "Budget already exists: ${VERDERY_BUDGET_DISPLAY_NAME}"
  log "Change the amount with: gcloud billing budgets update ${existing_budget} --budget-amount=<n>USD"
  exit 0
fi

# The budget is scoped to this project only. A budget covering the whole
# billing account would blend development and production spend, and the point
# of the alert is to notice which one moved.
#
# Thresholds at 50%, 90%, and 100% of the amount: 50% is "this month is not
# behaving like last month" while there is still time to look, 90% is "act
# now", and 100% is the record for the retrospective. A forecasted-spend
# threshold is deliberately omitted — at this project's traffic a forecast
# built from a few days of data is noise, and an alert that cries wolf in month
# one is an alert nobody reads in month six.
log "Creating budget ${VERDERY_BUDGET_DISPLAY_NAME}: ${VERDERY_BUDGET_AMOUNT_USD} USD/month for ${VERDERY_PROJECT_ID}"

budget_args=(
  --billing-account="${VERDERY_BILLING_ACCOUNT_ID}"
  --display-name="${VERDERY_BUDGET_DISPLAY_NAME}"
  --budget-amount="${VERDERY_BUDGET_AMOUNT_USD}USD"
  --filter-projects="projects/${VERDERY_PROJECT_ID}"
  --calendar-period=month
  --threshold-rule=percent=0.5
  --threshold-rule=percent=0.9
  --threshold-rule=percent=1.0
)

# Reuse the same notification channel the alert policies use, when it exists,
# so a budget breach arrives where every other production signal arrives rather
# than only in the billing administrator's mailbox. Budget mail always reaches
# the billing account's admins regardless; this adds the on-call address.
channel_name="$(gcloud alpha monitoring channels list \
  --project="${VERDERY_PROJECT_ID}" \
  --filter="displayName=\"${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}\"" \
  --format="value(name)" 2>/dev/null | head -n 1)"

if [[ -n "${channel_name}" ]]; then
  log "Routing budget notifications to ${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}"
  budget_args+=(--notifications-rule-monitoring-notification-channels="${channel_name}")
else
  log "No monitoring channel named '${VERDERY_ALERT_CHANNEL_DISPLAY_NAME}' yet."
  log "Budget mail will reach the billing account administrators only."
  log "Run 15-monitoring-alerts.sh first if you want it on the on-call address too."
fi

gcloud billing budgets create "${budget_args[@]}"

log ""
log "Budget created. It NOTIFIES; it does not cap. Nothing in Google Cloud caps"
log "spend. The controls that actually bound the bill are --max-instances on"
log "each Cloud Run service, the Cloud Armor rate limits (12-cloud-armor.sh),"
log "and the Cloud SQL storage auto-increase limit (14-cloud-sql-hardening.sh)."
