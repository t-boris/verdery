#!/usr/bin/env bash
# Creates and removes only its own simulator. Keeps xcresult evidence on failure.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p test-results
SIMULATOR_ID=""
cleanup() {
  if [[ -n "${SIMULATOR_ID}" ]]; then
    xcrun simctl shutdown "${SIMULATOR_ID}" >/dev/null 2>&1 || true
    xcrun simctl delete "${SIMULATOR_ID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Resolve from the selected Xcode's installed runtimes, without assuming that
# runner and developer machines have the same iPhone generation or iOS patch.
xcrun simctl list --json > test-results/simulators.json
DESTINATION=$(python3 - <<'PY'
import json
from pathlib import Path
inventory = json.loads(Path('test-results/simulators.json').read_text())
runtimes = [r for r in inventory['runtimes'] if r['isAvailable'] and r['name'].startswith('iOS ')]
if not runtimes:
    raise SystemExit('No available iOS Simulator runtime. Install one in Xcode before running UI tests.')
runtime = max(runtimes, key=lambda r: tuple(int(part) for part in r['version'].split('.')))
parts = [int(part) for part in runtime['version'].split('.')]
parts += [0] * (3 - len(parts))
version = (parts[0] << 16) + (parts[1] << 8) + parts[2]
devices = [d for d in inventory['devicetypes'] if d['name'].startswith('iPhone')
           and d.get('minRuntimeVersion', 0) <= version <= d.get('maxRuntimeVersion', 4294967295)]
if not devices:
    raise SystemExit('No compatible iPhone Simulator device type.')
print(devices[-1]['identifier'], runtime['identifier'])
PY
)
read -r DEVICE_TYPE RUNTIME <<< "${DESTINATION}"
SIMULATOR_ID=$(xcrun simctl create "Verdery UI tests $$" "${DEVICE_TYPE}" "${RUNTIME}")
xcrun simctl boot "${SIMULATOR_ID}"
xcrun simctl bootstatus "${SIMULATOR_ID}" -b

xcodebuild -project Verdery.xcodeproj -scheme Verdery \
  -configuration Debug -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
  -derivedDataPath test-results/DerivedData \
  -resultBundlePath "test-results/FirstGarden-$(date -u +%Y%m%dT%H%M%SZ).xcresult" \
  -parallel-testing-enabled NO \
  -only-testing:VerderyUITests/FirstGardenCreationTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO test 2>&1 | tee test-results/xcodebuild.log
