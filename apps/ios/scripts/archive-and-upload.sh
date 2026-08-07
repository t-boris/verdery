#!/usr/bin/env bash
# Archives the Verdery iOS app and uploads it to TestFlight / App Store Connect.
#
# WHY PLAIN xcodebuild AND NOT FASTLANE
# -------------------------------------
# fastlane is the conventional answer and it is a good tool, but it would be
# the only Ruby in this repository: a Gemfile, a bundler lockfile, a Ruby
# version to pin in CI, and a few hundred transitive gems, all to wrap three
# xcodebuild invocations. Everything fastlane's `gym` + `pilot` do for this
# app is now first-party:
#
#   * `xcodebuild archive` builds the .xcarchive.
#   * `xcodebuild -exportArchive` produces the signed .ipa.
#   * `xcrun altool --upload-app` uploads it with an App Store Connect API key
#     — no Apple ID, no app-specific password, no 2FA session to refresh.
#
#     These are two commands rather than the one `destination = upload`
#     advertises, because that single form signs with the API key too and so
#     demands the Admin role. See the comment above the export step for the
#     failure it produces and why App Manager is the right role to keep.
#
# That matches the repository's existing shape — infrastructure/gcloud/scripts
# is bash with the same `set -euo pipefail` + `log`/`fail` structure — and adds
# no new toolchain. Revisit if this ever needs screenshot automation, metadata
# push, or match-style certificate sharing across machines; those are the
# things fastlane genuinely does better than a script.
#
# USAGE
# -----
#   # Everything except the upload. Runs today, with no credentials at all.
#   ./scripts/archive-and-upload.sh --validate-only
#
#   # The real thing, once the owner has supplied an API key.
#   VERDERY_ASC_KEY_ID=XXXXXXXXXX \
#   VERDERY_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#   VERDERY_ASC_KEY_PATH=~/private_keys/AuthKey_XXXXXXXXXX.p8 \
#     ./scripts/archive-and-upload.sh
#
# See docs/operations/app-store-submission.md for where each of those three
# values comes from, and for the owner-only actions that must happen first.

set -euo pipefail

IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

VALIDATE_ONLY=0
for argument in "$@"; do
  case "${argument}" in
    --validate-only) VALIDATE_ONLY=1 ;;
    -h | --help)
      sed -n '1,45p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) fail "Unknown argument: ${argument}" ;;
  esac
done

# --- Configuration -----------------------------------------------------------
# Every value is overridable, but only the three App Store Connect API-key
# variables have no working default — they are exactly the credentials the
# owner must create, and the script names them precisely when they are absent.
TEAM_ID="${VERDERY_TEAM_ID:-3M68DG8S7N}"
BUNDLE_ID="${VERDERY_BUNDLE_ID:-com.verdery.app}"
SCHEME="Verdery"
CONFIGURATION="Release"

# A build number App Store Connect has not seen before. The commit count is
# monotonic, reproducible from any checkout, and needs no state file; an
# explicit VERDERY_BUILD_NUMBER wins when a rebuild of the same commit has to
# be re-uploaded.
BUILD_NUMBER="${VERDERY_BUILD_NUMBER:-$(git -C "${IOS_ROOT}" rev-list --count HEAD)}"

BUILD_DIR="${VERDERY_BUILD_DIR:-${IOS_ROOT}/.build/distribution}"
ARCHIVE_PATH="${BUILD_DIR}/Verdery.xcarchive"
EXPORT_PATH="${BUILD_DIR}/export"
EXPORT_OPTIONS_PLIST="${BUILD_DIR}/ExportOptions.plist"

# --- Preflight ---------------------------------------------------------------
command -v xcodebuild >/dev/null || fail "xcodebuild not found. Install Xcode and run xcode-select --switch."
command -v xcodegen >/dev/null || fail "xcodegen not found. Install it: brew install xcodegen"

if [[ "${VALIDATE_ONLY}" -eq 0 ]]; then
  # Named individually rather than as one blanket message: the owner needs to
  # know which of the three is missing, not that "credentials" are missing.
  [[ -n "${VERDERY_ASC_KEY_ID:-}" ]] ||
    fail "VERDERY_ASC_KEY_ID is not set. It is the 10-character Key ID shown next to the key in App Store Connect > Users and Access > Integrations > App Store Connect API."
  [[ -n "${VERDERY_ASC_ISSUER_ID:-}" ]] ||
    fail "VERDERY_ASC_ISSUER_ID is not set. It is the UUID shown above the key list on that same page — one issuer id for the whole team."
  [[ -n "${VERDERY_ASC_KEY_PATH:-}" ]] ||
    fail "VERDERY_ASC_KEY_PATH is not set. It is the path to the AuthKey_<KeyID>.p8 file, which App Store Connect lets you download exactly once."
  [[ -f "${VERDERY_ASC_KEY_PATH}" ]] ||
    fail "No .p8 key file at ${VERDERY_ASC_KEY_PATH}"
fi

# --- Generate the project ----------------------------------------------------
# Unconditional, and deliberately so. Verdery.xcodeproj is generated output;
# between Phase 2 and Phase 8 the committed copy silently fell four phases
# behind project.yml (a whole source file was missing from it) because nothing
# ever regenerated it. Regenerating here makes that class of drift impossible
# for any build this script produces.
log "Regenerating Verdery.xcodeproj from project.yml"
(cd "${IOS_ROOT}" && xcodegen generate)

# --- The API this build will talk to -----------------------------------------
# `project.yml` gives the Release configuration the deployed development API,
# so an archive reaches a real server without any extra argument. This variable
# exists to point a build somewhere else — a staging or production origin, once
# one exists — and is validated when supplied.
#
# Why this matters: through build 153 the origin was http://localhost:8080 in
# every configuration. On a phone localhost IS the phone, so Today, the journal
# and the map — all server-backed reads — failed, and three of the five tabs
# looked broken.
VERDERY_API_ORIGIN="${VERDERY_API_ORIGIN:-}"
if [[ -n "${VERDERY_API_ORIGIN}" ]]; then
  case "${VERDERY_API_ORIGIN}" in
    https://*) ;;
    *) fail "VERDERY_API_ORIGIN must be https:// — the app declares no App Transport Security exception. Got: ${VERDERY_API_ORIGIN}" ;;
  esac
  API_ORIGIN_ARGUMENTS=(API_ORIGIN="${VERDERY_API_ORIGIN}")
  log "API origin overridden: ${VERDERY_API_ORIGIN}"
else
  API_ORIGIN_ARGUMENTS=()
  log "API origin: the Release default from project.yml"
fi

# --- The web application an emailed sign-in link points at --------------------
# Same shape as the API origin above, and for the same reason: the value names
# a deployed environment, so it belongs in configuration rather than in Swift.
# It was hard-coded to https://verdery-dev.firebaseapp.com/emailSignIn, a host
# this project has never had a Firebase Hosting site for — every sign-in link
# Firebase mailed led to a 404, which is indistinguishable from "the email
# never arrived" for anyone who received one.
VERDERY_WEB_ORIGIN="${VERDERY_WEB_ORIGIN:-}"
if [[ -n "${VERDERY_WEB_ORIGIN}" ]]; then
  case "${VERDERY_WEB_ORIGIN}" in
    https://*) ;;
    *) fail "VERDERY_WEB_ORIGIN must be https:// — a sign-in link is opened outside this device. Got: ${VERDERY_WEB_ORIGIN}" ;;
  esac
  WEB_ORIGIN_ARGUMENTS=(WEB_ORIGIN="${VERDERY_WEB_ORIGIN}")
  log "Web origin overridden: ${VERDERY_WEB_ORIGIN}"
else
  WEB_ORIGIN_ARGUMENTS=()
  log "Web origin: the Release default from project.yml"
fi

# --- Archive -----------------------------------------------------------------
log "Archiving ${SCHEME} (${CONFIGURATION}) — bundle ${BUNDLE_ID}, build ${BUILD_NUMBER}, team ${TEAM_ID}"
rm -rf "${ARCHIVE_PATH}" "${EXPORT_PATH}"
mkdir -p "${BUILD_DIR}"

# APNs environment. `aps-environment` is an entitlements plist entry, not a
# build setting, so it cannot be overridden with an xcodebuild argument the way
# every other per-invocation value above is. project.yml keeps `development` as
# the local-build default and this rewrites the generated file to `production`
# for the archive. Silent if wrong: the app registers a token APNs never
# delivers to, and nothing anywhere reports an error.
ENTITLEMENTS_PATH="${IOS_ROOT}/Generated/Verdery.entitlements"
if [[ -f "${ENTITLEMENTS_PATH}" ]]; then
  log "Setting aps-environment=production in ${ENTITLEMENTS_PATH}"
  /usr/libexec/PlistBuddy -c "Set :aps-environment production" "${ENTITLEMENTS_PATH}" \
    || /usr/libexec/PlistBuddy -c "Add :aps-environment string production" "${ENTITLEMENTS_PATH}"
fi

xcodebuild archive \
  -project "${IOS_ROOT}/Verdery.xcodeproj" \
  -scheme "${SCHEME}" \
  -configuration "${CONFIGURATION}" \
  -destination 'generic/platform=iOS' \
  -archivePath "${ARCHIVE_PATH}" \
  PRODUCT_BUNDLE_IDENTIFIER="${BUNDLE_ID}" \
  DEVELOPMENT_TEAM="${TEAM_ID}" \
  CURRENT_PROJECT_VERSION="${BUILD_NUMBER}" \
  "${API_ORIGIN_ARGUMENTS[@]}" \
  "${WEB_ORIGIN_ARGUMENTS[@]}" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates

[[ -d "${ARCHIVE_PATH}" ]] || fail "Archive was not produced at ${ARCHIVE_PATH}"
log "Archived: ${ARCHIVE_PATH}"

# --- Export options ----------------------------------------------------------
# Written rather than committed: `destination` and `teamID` both vary by
# invocation, and a committed plist that disagrees with the flags above is a
# trap. `uploadSymbols` ships dSYMs so App Store Connect can symbolicate the
# crash reports this app has no third-party crash reporter for.
cat >"${EXPORT_OPTIONS_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>export</string>
	<key>teamID</key>
	<string>${TEAM_ID}</string>
	<key>uploadSymbols</key>
	<true/>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
PLIST

if [[ "${VALIDATE_ONLY}" -eq 1 ]]; then
  log "Exporting the .ipa locally (no upload; --validate-only)"
  xcodebuild -exportArchive \
    -archivePath "${ARCHIVE_PATH}" \
    -exportPath "${EXPORT_PATH}" \
    -exportOptionsPlist "${EXPORT_OPTIONS_PLIST}" \
    -allowProvisioningUpdates
  log "Done. Signed .ipa is in ${EXPORT_PATH}. Nothing was uploaded."
  exit 0
fi

# --- Export locally, then upload -------------------------------------------
#
# TWO STEPS, NOT ONE, AND WHY
# ---------------------------
# `-exportArchive` with `destination = upload` and `-authenticationKey*` looks
# like the tidy single command, and it fails: xcodebuild uses the same key for
# SIGNING as for uploading, and cloud signing requires an App Store Connect key
# with the Admin role. An App Manager key — the role Apple's own documentation
# recommends for CI, and the least privilege that can upload a build — is
# refused with "Cloud signing permission error / No signing certificate
# 'iOS Distribution' found", after the archive has already been built.
#
# Splitting the steps keeps the key at App Manager: the export signs with the
# machine's own Xcode account (`-allowProvisioningUpdates`, which is what
# issues the cloud-managed distribution certificate), and `altool` uploads the
# finished .ipa with the API key, which is all an upload actually needs.
#
# Found by running the real thing against a real App Manager key.
log "Exporting the signed .ipa"
xcodebuild -exportArchive \
  -archivePath "${ARCHIVE_PATH}" \
  -exportPath "${EXPORT_PATH}" \
  -exportOptionsPlist "${EXPORT_OPTIONS_PLIST}" \
  -allowProvisioningUpdates

IPA_PATH="$(find "${EXPORT_PATH}" -name '*.ipa' -maxdepth 1 | head -1)"
[[ -n "${IPA_PATH}" ]] || fail "No .ipa was produced in ${EXPORT_PATH}"

log "Uploading ${IPA_PATH} to App Store Connect"
xcrun altool --upload-app --type ios \
  --file "${IPA_PATH}" \
  --apiKey "${VERDERY_ASC_KEY_ID}" \
  --apiIssuer "${VERDERY_ASC_ISSUER_ID}"

log "Uploaded. The build appears in TestFlight once App Store Connect finishes"
log "processing it, usually within a few minutes."
