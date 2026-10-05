# R02 verification ledger

Specification read in full on 2026-10-04: overview, REQ-001, implementation plan,
SRC-001, Q-001–Q-003, DEC-001–DEC-003, and discussion.md. No findings directory
existed at the start. Recorded answers remain binding; no new product answer has
been inferred. Q-004 was asked but withdrawn without an answer after the direct
requirement audit found no contradiction; see F-002.

## Requirement audit

| Requirement / plan item              | Current evidence                                                                                                                                                                                                                 | Remaining verification                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright job and aggregation / I-1 | `ci.yml` runs the complete suite on an Auth-emulator/local-stack job with read-only contents permission; `gates.needs` includes `playwright`. Failure artifacts include traces, HTML report, screenshots, video, and stack logs. | First hosted red run and local aggregation matrix verified; all specs remain required, including the known excluded GG-0005 failure. |
| Five core web journeys / I-2         | Existing registration and care-loop specs plus `core-journeys.spec.ts`; fixtures use current R00 CORE-005–010 behavior and isolated accounts.                                                                                    | Named core journeys pass locally; hosted results for latest source are pending.                                                      |
| Required master check / I-3          | GitHub REST readback on 2026-10-04 confirms required `All gates`, GitHub Actions app 15368, strict up-to-date checks, and enforcement for administrators. No rulesets existed before configuration.                              | Verified on non-draft PR #31: All gates FAILURE, mergeStateStatus BLOCKED, mergeable MERGEABLE.                                      |
| Native UI target / I-4               | `VerderyUITests` target and explicit Verdery scheme; first-garden test starts empty, rejects an empty submit, creates a named active owner garden and reads it after relaunch.                                                   | Verified in CI 37243669761: one native UI test passed on Xcode 26.6 / iOS 26.5.                                                      |
| Path-filtered Swift UI gate / I-5    | Existing Swift filter is unchanged. `swift` runs `scripts/run-ui-tests.sh`; failure propagates, and failure xcresult artifacts are retained.                                                                                     | Affected R02 run passed native UI; unaffected PR #30 skipped Swift and passed All gates under the byte-identical filter.             |
| Manual deployed evidence / I-6       | Chrome manual checks against deployed development show web 0.6.4 on 2026-10-04.                                                                                                                                                  | Completed: GG-0003 closed; GG-0005/GG-0007 remain open with dated failures/unverified states.                                        |

## Native execution

- Command: `cd apps/ios && xcodegen generate && bash scripts/run-ui-tests.sh`.
- Successful execution: 2026-10-04 23:09:57 UTC, Xcode 27.0, macOS 27.0.1,
  iPhone 11 simulator, iOS 26.5. One test passed; zero failed or skipped.
- Machine-local result: `apps/ios/test-results/FirstGarden-20261004T230909Z.xcresult`.
  `xcresulttool get test-results summary` independently confirmed Passed.
- The fixture is compiled only for Debug simulator builds and requires the
  explicit launch argument plus a UUID run identifier. It uses the production
  GardensListView, view model, CreateGarden, GRDBGardenStore, migrations, and
  durable SQLite/outbox. Only the remote garden list is an empty fixture.
  Authentication, remote synchronization, and real-device behavior are not
  claimed by this native creation test. Initial launch resets only that test
  profile; relaunch keeps it. The runner removes only its own simulator.
- An initial run used the wrong XCTest element type for the existing empty-state
  accessibility identifier and failed. The selector was corrected to search
  descendants by identifier; the successful run above is the acceptance evidence.

## Branch protection readback

Repository: `t-boris/verdery`, branch: `master`, checked 2026-10-04.

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [{ "context": "All gates", "app_id": 15368 }]
  },
  "enforce_admins": { "enabled": true },
  "allow_force_pushes": { "enabled": false },
  "allow_deletions": { "enabled": false }
}
```

This setting is already applied remotely, and PR #31 publishes the workflow.
The first hosted run below verifies native execution and red-check merge blocking;
it does not establish hosted passing evidence for the latest core-journey source.

## Aggregation and filter checks

On 2026-10-04 the actual `All gates` shell step was executed with dependency
result strings. Success plus a skipped Swift job returned 0; browser failure,
browser cancellation, and failed change detection with downstream skips each
returned 1. `playwright` is explicitly present in `needs`. Actionlint passed.
The Swift path-filter block is byte-identical to the original workflow.

An unaffected hosted run is also available: [CI 36810760409](https://github.com/t-boris/verdery/actions/runs/36810760409)
for PR #30, completed 2026-10-01. Its changed paths were only
`apps/web/package.json` and `pnpm-lock.yaml`; Swift was skipped and All gates
passed. This demonstrates the retained filter's skip behavior before R02;
the R02 affected run separately verifies the newly added simulator step.

## Manual deployed evidence

Manual Chrome checks on 2026-10-04 used deployed development web 0.6.4, with
English and Russian copy, desktop and narrow layouts, real weather readings,
and a disposable unlocated garden. No production data or credentials are
included in the public evidence. Each issue has a dated Observations row:

- GG-0003: all resolution criteria passed; verified and closed.
- GG-0005: partial pass, Backdrop content leaks into other selected tabs;
  complete keyboard selection/multi-selection/deletion acceptance is unverified.
  Remains open (`fixed`).
- GG-0007: observed current/partial forecast, zero/missing interval, coverage,
  impact, localization and unit persistence passed. Stale and full forecast
  states were unavailable for deployed manual verification. Remains open (`fixed`).

No issue-specific Playwright assertion or fix was added (DEC-003). Browser zoom,
interface language, temperature units and existing-garden inspector width were
restored. The named disposable verification garden is retained for reproducibility;
its Archive action did not visibly change its state in this deployed session.

## Local supporting checks

- Swift package test command passed; Release device-target build passed.
- Plant/task creation regression suites: 8 tests passed, including default
  command values and omission of an absent task time window.
- Targeted ESLint, web typecheck, Actionlint, formatting in the isolated review
  tree and the 600-line source check passed. Generated browser reports/results
  are excluded from that source check.
- [F-001](../findings/F-001.md) records the resolved core form and audit drift.
  These repairs ship as web 0.6.6; the authenticated header reads that package
  version, also visible in browser test snapshots. Manual acceptance above is
  explicitly evidence for the existing deployed 0.6.4 build.

## First hosted run and merge blocking

[CI 37243669761](https://github.com/t-boris/verdery/actions/runs/37243669761)
ran the R02 workflow for non-draft [PR #31](https://github.com/t-boris/verdery/pull/31),
commit `10f8d80857835277350fdc3dfa558f063229bd76`, on 2026-10-04.
Swift package build/tests, the Release app build, and the first-garden UI test
all passed on pinned Xcode 26.6 and iOS 26.5. The UI test finished at
23:46:40 UTC: one test, zero failures, 77.015 seconds. Result bundle:
`FirstGarden-20261004T233619Z.xcresult`. Thus an affected change
executes the native gate in GitHub Actions, rather than only on a developer machine.

Browser and lint jobs failed on intermediate code, and All gates correctly
failed. At 23:47 UTC, GitHub reported `isDraft: false`, `mergeable: MERGEABLE`,
`mergeStateStatus: BLOCKED`, and the required All gates check `FAILURE`.
This demonstrates check-based merge blocking with no content conflict and without
attempting to merge. Browser failure artifacts were retained. Core form/default
and audit repairs are now ready locally; the complete local suite reached
52 passed / 1 failed. The remaining tabpanel failure matches GG-0005 and stays
open under the explicit fix exclusion in REQ-001 and plan I-6.
[Q-004](../questions/Q-004.md) was withdrawn without a user answer: acceptance
requires passing named core specs and failure propagation for the full suite,
not fixes to every failure it detects. F-002 records this scope correction.
The red PR remains unmergeable until GG-0005 is corrected in separately
authorized work; this ledger does not grant merge or release approval.

## Second hosted run: harness timing diagnosis

[CI 37245483547](https://github.com/t-boris/verdery/actions/runs/37245483547)
ran commit `b502a7a8403a62646629c9fb485201b04f3c7d5b`. Browser execution
finished at 2026-10-05 00:07:58 UTC (October 4 in the repository timezone):
44 passed, three failed, one flaky, five did not run because of serial-suite
failures. Registration/reopening, plant, observation, manual task and the
existing care loop passed. The map scenario failed before its persistence
assertions: its trace shows an already created Bed while the test waited for
Finish shape, which rapid Konva double-click detection had removed. Multi-route
light axe and desktop responsiveness hit the 30-second total test timeout.
The retained phone tabpanel assertion also detected the excluded GG-0005 failure.

The harness repairs separate map click gestures beyond Konva's double-click
window and use a 60-second CI total test budget, retaining 10-second assertion
timeouts, all existing assertions and complete-suite execution. Final hosted
core verification is pending. Lint, types, unit/integration tests, formatting,
file size, secret scan and API contract passed in this second run.

## Local verification of the Linux harness repairs

On 2026-10-05 at 00:17:40 UTC (October 4 locally), the complete suite ran with
`CI=true E2E_DB_PORT=55433 E2E_LOG_DIR=/tmp/r02-stack-logs-ci bash apps/web/e2e/run-e2e.sh`.
All 53 tests executed: 52 passed, one failed, none skipped or flaky. The
60-second CI budget and separated map gestures were active. All five named
core journeys passed; map drawing/property persistence completed in 11.9 seconds.
The sole failure remained the existing GG-0005 tabpanel count assertion after
its configured retry. The stack was cleaned up with exit status 1; the unrelated
developer Postgres on port 55432 was preserved. Hosted confirmation is pending.
