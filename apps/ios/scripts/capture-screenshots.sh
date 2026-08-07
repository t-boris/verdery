#!/usr/bin/env bash
# Captures App Store screenshots at the two sizes App Store Connect requires.
#
# WHAT THIS DOES AND DOES NOT DO
# ------------------------------
# It automates the mechanical half: creating and booting a simulator of the
# right model, building and installing the app, capturing the screen at the
# exact pixel dimensions Apple wants, and naming the files so they can be
# uploaded without renaming.
#
# It CANNOT navigate the app. Between captures it waits for you to press Enter,
# so you drive the app to each screen by hand. Automating that half needs an
# XCUITest target calling XCUIScreen.main.screenshot() at each checkpoint; this
# package has unit tests only, by design (see apps/ios/README.md,
# "Testability"), so that target does not exist and building it is not part of
# P8-STORE-01.
#
# It also cannot invent content. Apple rejects screenshots of an empty app, so
# sign in first with an account that already has a drawn garden, plants, photos,
# and tasks — the same seeded demo account App Review needs. See
# docs/development/ios-distribution.md, section 10.
#
# USAGE
#   ./scripts/capture-screenshots.sh              # both device sets
#   ./scripts/capture-screenshots.sh iphone       # just the iPhone set
#   ./scripts/capture-screenshots.sh ipad

set -euo pipefail

IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${VERDERY_SCREENSHOT_DIR:-${IOS_ROOT}/.build/screenshots}"

log() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# The set App Store Connect requires; every smaller size is derived from it by
# Apple. The iPad set went with iPad support itself — the app declares
# TARGETED_DEVICE_FAMILY "1".
#   key | simulator device type | expected portrait pixels
DEVICE_SETS=(
  "iphone|iPhone 16 Pro Max|1320x2868"
)

# The screens worth shipping, in the order they should appear on the listing.
SHOTS=(
  "01-map|The garden map, drawn and populated"
  "02-plant|A plant detail screen with photos and condition history"
  "03-observations|The observations timeline"
  "04-tasks|The tasks list"
  "05-plan-import|Plan import or calibration, showing a traced site plan"
)

requested="${1:-all}"

command -v xcodegen >/dev/null || fail "xcodegen not found. Install it: brew install xcodegen"

capture_set() {
  local key="$1" device_type="$2" expected="$3"

  log "=== ${key}: ${device_type} (expecting ${expected} px portrait) ==="

  local runtime
  runtime="$(xcrun simctl list runtimes --json |
    /usr/bin/python3 -c 'import json,sys; rs=[r for r in json.load(sys.stdin)["runtimes"] if r["isAvailable"] and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS")]; print(rs[-1]["identifier"] if rs else "")')"
  [[ -n "${runtime}" ]] || fail "No available iOS simulator runtime. Install one: xcodebuild -downloadPlatform iOS"

  local udid
  udid="$(xcrun simctl create "verdery-shot-${key}" "${device_type}" "${runtime}" 2>/dev/null)" ||
    fail "Could not create a '${device_type}' simulator. List the available types with: xcrun simctl list devicetypes"

  # shellcheck disable=SC2064
  trap "xcrun simctl delete '${udid}' >/dev/null 2>&1 || true" RETURN

  log "Booting ${udid}"
  xcrun simctl boot "${udid}"
  xcrun simctl bootstatus "${udid}" -b

  log "Building for the simulator"
  (cd "${IOS_ROOT}" && xcodegen generate)
  local derived="${IOS_ROOT}/.build/screenshot-derived"
  xcodebuild -project "${IOS_ROOT}/Verdery.xcodeproj" \
    -scheme Verdery \
    -configuration Debug \
    -destination "id=${udid}" \
    -derivedDataPath "${derived}" \
    CODE_SIGNING_ALLOWED=NO \
    build

  local app_path="${derived}/Build/Products/Debug-iphonesimulator/Verdery.app"
  [[ -d "${app_path}" ]] || fail "No app bundle at ${app_path}"

  log "Installing and launching"
  xcrun simctl install "${udid}" "${app_path}"
  xcrun simctl launch "${udid}" com.verdery.app

  mkdir -p "${OUTPUT_DIR}/${key}"
  printf '\nSign in with the seeded demo account before continuing.\n'

  local entry name description target
  for entry in "${SHOTS[@]}"; do
    name="${entry%%|*}"
    description="${entry#*|}"
    printf '\n  Navigate to: %s\n  Press Enter to capture (or s to skip): ' "${description}"
    read -r answer </dev/tty
    [[ "${answer}" == "s" ]] && continue

    target="${OUTPUT_DIR}/${key}/${name}.png"
    xcrun simctl io "${udid}" screenshot --type=png "${target}"

    local actual
    actual="$(sips -g pixelWidth -g pixelHeight "${target}" |
      awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w"x"h}')"
    if [[ "${actual}" != "${expected}" ]]; then
      printf '    WARNING: captured %s, App Store Connect expects %s for this set.\n' "${actual}" "${expected}"
    else
      printf '    Captured %s\n' "${actual}"
    fi
  done

  log "Shut down and remove ${udid}"
  xcrun simctl shutdown "${udid}" || true
}

for set_spec in "${DEVICE_SETS[@]}"; do
  IFS='|' read -r key device_type expected <<<"${set_spec}"
  if [[ "${requested}" == "all" || "${requested}" == "${key}" ]]; then
    capture_set "${key}" "${device_type}" "${expected}"
  fi
done

log "Screenshots are in ${OUTPUT_DIR}"
