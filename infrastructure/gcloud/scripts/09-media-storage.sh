#!/usr/bin/env bash
# Creates the four private Cloud Storage buckets that hold every media
# artifact described by docs/architecture/media-storage-and-processing.md:
# user-uploaded photos and imported plans, raw Garden Scan/AR capture data,
# rebuildable derivatives (thumbnails, previews, tiles), and short-lived
# export packages.
#
# Every bucket gets uniform bucket-level access and public access prevention
# enforced, matching section 18 ("Security"): "Uniform bucket-level access.
# Public access prevention." Object versioning is deliberately left off (its
# default state) on all four: object keys are opaque UUIDs
# (`<shard>/<mediaUuid>/<objectUuid>`, section 4) that are never overwritten
# in place — a new derivative or a re-upload is always a new object, never a
# write to an existing key — so versioning would only protect against a
# scenario this design does not produce, at extra storage cost.
#
# Lifecycle policy is NOT uniform across the four buckets. Section 15
# ("Retention and Lifecycle") gives each media class different retention
# language, and a bucket-level lifecycle rule is only applied where it can
# faithfully express that language without a real event or duration the
# rest of this codebase has not decided yet. See the comment above each
# bucket's setup below for the specific reasoning; in short:
#
#   user-media    no bucket lifecycle rule   (section 15: "remain until
#                                              deleted by user, garden, or
#                                              account policy" — an
#                                              application decision, not a
#                                              storage-age one)
#   raw-capture   no bucket lifecycle rule   (section 15's "30 days after
#                                              extraction" is anchored to an
#                                              event a blind object-age rule
#                                              cannot see — see below)
#   derived       SetStorageClass to Nearline after 30 days (section 3 calls
#                                              this class "lifecycle-managed"
#                                              by name; storage-class
#                                              transition is the safe half of
#                                              that, see below)
#   exports       Delete after 7 days        (section 15: "expire
#                                              automatically after the
#                                              communicated deadline" — no
#                                              number given anywhere in this
#                                              repository, so one is chosen
#                                              and documented here)
#
# IAM: grants the existing runtime service account (05-service-accounts.sh)
# roles/storage.objectAdmin, scoped to each bucket individually rather than
# project-wide roles/storage.admin, on all four buckets. It is the only
# identity that concretely touches media objects today — P6-API-01 (the next
# stage) creates resumable upload sessions (needs object create), serves
# downloads (needs object read), and the deletion workflow in section 16
# ("Delete derivatives... Delete original and raw objects") spans every
# bucket class the app orchestrates today (needs object delete). Section 18
# also asks for "separate read/write permissions by worker role", but the
# worker roles that would justify a second, more restricted service account
# (P6-WORKER-01: validators, P6-WORKER-02: derivative generation) do not
# exist as running workloads yet — per implementation-plan.md, both depend
# on P6-ASYNC-01, which itself depends on P6-API-01, several stages away.
# Granting a role to a service account with no workload to run it is
# infrastructure ahead of a real need, so that split is deferred to the
# stage that actually builds those workers, not created here as an unused
# placeholder identity.
#
# Idempotent: bucket creation and the IAM binding are both skip/no-op safe
# to re-run. Lifecycle configuration is applied on every run (not gated
# behind a "bucket already existed" check) so editing a lifecycle rule in
# this script and re-running it updates an already-existing bucket instead
# of silently doing nothing.
#
# Source: implementation-plan.md work package P6-PLAT-01;
# architecture/media-storage-and-processing.md, sections 4, 15, 18.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 09-media-storage.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project

# Enabled centrally by 01-enable-apis.sh too; enabled defensively here as
# well, matching the precedent 08-app-check-recaptcha.sh already set for a
# script that needs to stay self-sufficient if ever run standalone, ahead of
# a full provision.sh pass.
enable_api_if_needed storage.googleapis.com

runtime_email="${VERDERY_RUNTIME_SERVICE_ACCOUNT_ID}@${VERDERY_PROJECT_ID}.iam.gserviceaccount.com"

LIFECYCLE_DIR="${GCLOUD_ROOT}/config/lifecycle"

create_bucket_if_needed() {
  local bucket_name="${1}"

  if resource_exists gcloud storage buckets describe "gs://${bucket_name}" --project="${VERDERY_PROJECT_ID}"; then
    log "Bucket already exists: ${bucket_name}"
  else
    log "Creating bucket: ${bucket_name}"
    gcloud storage buckets create "gs://${bucket_name}" \
      --project="${VERDERY_PROJECT_ID}" \
      --location="${VERDERY_REGION}" \
      --uniform-bucket-level-access \
      --public-access-prevention \
      --default-storage-class=STANDARD
  fi
}

apply_lifecycle_file() {
  local bucket_name="${1}" lifecycle_file="${2}"

  log "Applying lifecycle configuration to ${bucket_name} (${lifecycle_file##*/})"
  gcloud storage buckets update "gs://${bucket_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --lifecycle-file="${lifecycle_file}" \
    >/dev/null
}

# roles/storage.objectAdmin, not roles/storage.admin: object create/read/
# update/delete only, no bucket-level admin (IAM policy, lifecycle, or
# bucket deletion itself) — that stays with whoever runs this script.
grant_runtime_object_admin() {
  local bucket_name="${1}"

  log "Granting roles/storage.objectAdmin on ${bucket_name} to ${runtime_email}"
  gcloud storage buckets add-iam-policy-binding "gs://${bucket_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --member="serviceAccount:${runtime_email}" \
    --role="roles/storage.objectAdmin" \
    --condition=None \
    >/dev/null
}

# --- user-media -------------------------------------------------------
# Garden photos and imported plan documents (section 3). Section 15: these
# "remain until deleted by user, garden, or account policy" — a decision the
# application makes when it processes those deletions (section 16's
# workflow), not something Cloud Storage can infer from an object's age. No
# lifecycle rule is applied.
create_bucket_if_needed "${VERDERY_USER_MEDIA_BUCKET}"
grant_runtime_object_admin "${VERDERY_USER_MEDIA_BUCKET}"

# --- raw-capture --------------------------------------------------------
# Garden Scan video, AR artifacts, depth data (section 3). Section 15 states
# "Raw successful capture defaults to deletion 30 days after extraction" —
# anchored to the *successful extraction* event, not to object-creation
# time, and section 3 separately notes "Failed raw capture is retained only
# long enough for recovery and support policy" with no stated duration. A
# blind "delete 30 days after upload" bucket rule cannot express either
# qualifier: it would delete objects whose extraction is still pending or
# retried past 30 days, and it would delete failed captures on the same
# schedule as successful ones despite the doc drawing a different retention
# line for each.
#
# The real deadline already has a home: `media.media_record.
# retention_deadline_at`, added by
# services/api/migrations/1785100000000_media-lifecycle-and-quotas.sql and
# left NULL at registration for exactly this reason — that migration's own
# comment states "`retention_deadline_at` stays NULL at registration for
# every class, including `raw_capture`: section 3's '30 days after
# successful extraction' is anchored to an event ... this stage has no
# producer for. Computing a real deadline is a later stage's job once these
# events and durations exist." A bucket-level TTL guessing at a number today
# would race that column once a later stage starts computing and enforcing
# it, and section 15's own words ("Lifecycle deletion must not race an
# active retry, support case, or legal hold") argue directly against
# encoding a number here ahead of that. No lifecycle rule is applied; actual
# deletion is application-orchestrated, through section 16's workflow,
# against `retention_deadline_at` once a later stage populates it.
create_bucket_if_needed "${VERDERY_RAW_CAPTURE_BUCKET}"
grant_runtime_object_admin "${VERDERY_RAW_CAPTURE_BUCKET}"

# --- derived --------------------------------------------------------------
# Thumbnails, screen previews, plan tiles (section 3, "Derived preview").
# Unlike raw capture, section 3's own class table calls this class
# "Rebuildable; lifecycle-managed" by name, and section 15 adds "Rebuildable
# derivatives may transition to lower-cost storage or be regenerated" — two
# distinct options, storage-class transition or regeneration. Regeneration
# is a P6-WORKER-02 capability (idempotent, addressed by source checksum
# plus transformation version per section 9) that does not exist yet, so a
# bucket rule that *deletes* derivatives would leave a preview permanently
# missing with nothing yet able to rebuild it. A storage-class transition
# is the half of that sentence available today: it does not destroy data,
# and Nearline fits derivatives well — read heavily right after upload while
# a garden view first renders, then rarely again. 30 days chosen as a
# reasoned default (not stated anywhere in the docs) matching Nearline's own
# minimum storage duration, so the transition never triggers an early-
# deletion charge on an object it just moved.
create_bucket_if_needed "${VERDERY_DERIVED_BUCKET}"
apply_lifecycle_file "${VERDERY_DERIVED_BUCKET}" "${LIFECYCLE_DIR}/derived-lifecycle.json"
grant_runtime_object_admin "${VERDERY_DERIVED_BUCKET}"

# --- exports ----------------------------------------------------------
# User-requested ZIP export packages (section 3). Section 15: "Short-lived
# exports expire automatically after the communicated deadline" — no
# specific duration is named anywhere in this repository's docs. 7 days is
# chosen as a reasoned default: long enough for a user to notice an export
# is ready and download it without returning to the app same-day, short
# enough to bound how long a bundled copy of potentially sensitive garden
# media sits in storage. If the API ever communicates a different deadline
# to the user than this bucket enforces, that mismatch needs reconciling in
# the application layer that generates the "communicated deadline" text, not
# by guessing a different number here.
create_bucket_if_needed "${VERDERY_EXPORTS_BUCKET}"
apply_lifecycle_file "${VERDERY_EXPORTS_BUCKET}" "${LIFECYCLE_DIR}/exports-lifecycle.json"
grant_runtime_object_admin "${VERDERY_EXPORTS_BUCKET}"

log "Media storage buckets ready:"
log "  ${VERDERY_USER_MEDIA_BUCKET}    (no lifecycle rule)"
log "  ${VERDERY_RAW_CAPTURE_BUCKET}   (no lifecycle rule; see comment above)"
log "  ${VERDERY_DERIVED_BUCKET}       (Nearline after 30 days)"
log "  ${VERDERY_EXPORTS_BUCKET}       (deleted after 7 days)"
