# Reproducible browser and native verification

R02 implements [REQ-001](../features/r02-reproducible-verification/requirements/REQ-001.md)
under accepted DEC-001–003. The [verification ledger](../features/r02-reproducible-verification/implementation/verification.md)
records dated results and outstanding evidence. Local tests are distinct from
manual acceptance on deployed development and from GitHub Actions execution.

## Browser suite

Use Node 24, pnpm 10.28.2, a running Docker daemon, and Firebase CLI 13.29.2.

```bash
pnpm install --frozen-lockfile
pnpm --filter './packages/**' build
npm install --global firebase-tools@13.29.2
pnpm --filter @verdery/web exec playwright install chromium
bash apps/web/e2e/run-e2e.sh
```

Linux runners install Chromium with `playwright install --with-deps chromium`.
The workflow runs all `apps/web/e2e/*.spec.ts`, on one Chromium worker, with one
retry in CI. The shell script owns the real API, PostGIS migrations, Auth
emulator, and Next development server with an enforcing CSP. Recommendation
fixtures seed catalog-shaped candidates in the disposable database; no provider,
OIDC worker, or production credential is needed.

Core scenarios cover registration/first garden and reopening, map drawing and
saved property edits, plant creation, recorded observations, persistent manual
tasks, and the existing Today feedback/task-conversion flow. Current R00
CORE-005–010 behavior is the fixture baseline. Forms are opened through their
actual disclosures; each scenario owns its own account and garden.

Defaults: database 55432, API 8090, web 3100, Auth emulator 9099. Override
`E2E_DB_PORT`, `E2E_API_PORT`, or `E2E_WEB_PORT` when a developer stack owns one
of those ports. The Auth port is fixed by `firebase.json`. Containers have
run-specific names and cleanup removes only the run's container/processes.
`E2E_DB_CONTAINER_NAME` is supplied to SQL fixtures by the orchestrator.

Failure evidence: `apps/web/test-results/` contains traces, screenshots and
video; `apps/web/playwright-report/` contains the HTML report. Stack logs use a
printed temporary directory, or the directory specified by `E2E_LOG_DIR`.
CI retains all three as `playwright-failure` for 14 days on failure/cancellation.

```bash
pnpm --filter @verdery/web exec playwright show-report
pnpm --filter @verdery/web exec playwright show-trace test-results/<test>/trace.zip
```

## Native first-garden UI test

Use the selected Xcode toolchain, XcodeGen, and an installed compatible iOS
simulator runtime. CI keeps the existing pinned Xcode 26.6 toolchain.

```bash
cd apps/ios
xcodegen generate
bash scripts/run-ui-tests.sh
```

The script creates a fresh compatible iPhone simulator from the newest installed
iOS runtime and deletes only that simulator afterward. It runs the explicit
`VerderyUITests/FirstGardenCreationTests` target, serially, with no automatic
UI-test retry. A failure returns a nonzero exit code and blocks the Swift job.
xcresult bundles remain under `apps/ios/test-results/`; CI retains them as
`ios-ui-test-failure` for 14 days on failure/cancellation.

The test checks the real offline-capable garden creation flow: empty list,
empty-name submit disabled, name entry, active owner garden, disappearance of
the empty state, and persistence after process relaunch. The simulator-only
Debug fixture requires an explicit launch argument and a UUID test profile.
It uses real SwiftUI feature code and SQLite/outbox; the remote list is empty.
It does not verify Firebase sign-in, remote sync, or device behavior. Release
builds cannot activate this fixture.

## Required check and path filtering

`master` requires the GitHub Actions `All gates` check, with administrator
enforcement and up-to-date-branch checks (read back 2026-10-04). The aggregator
fails if any dependency fails or is cancelled. A skipped conditional gate is
allowed; failed/cancelled change detection is also included so it cannot hide
unexecuted gates.

The browser job always runs. The Swift job, including its simulator test, keeps
its original filter: `apps/ios/**`, `packages/test-fixtures/fixtures/**`, and
`.github/workflows/ci.yml`. A documentation-only PR skips Swift while the other
applicable gates and the aggregator run. Modifying the CI workflow triggers
Swift as before.

## Manual deployed issue checks

DEC-003 requires manual browser checks on deployed development, with the date,
visible web package version, expected result, actual result, and reproducibility
in GG-0003, GG-0005, and GG-0007. No new Playwright assertions are added for those
issues. Close only when every issue-specific criterion is verified; otherwise
keep the issue open and record the failure or missing evidence. Fixing discovered
issue failures is outside R02.
