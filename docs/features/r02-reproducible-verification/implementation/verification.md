# R02 verification ledger

Specification read in full on 2026-10-04: overview, REQ-001, implementation plan,
SRC-001, Q-001–Q-003, DEC-001–DEC-003, and discussion.md. No findings directory
existed at the start. Recorded answers remain binding; no new product answer has
been requested or inferred.

## Requirement audit

| Requirement / plan item              | Current evidence                                                                                                                                                                                                                 | Remaining verification                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Playwright job and aggregation / I-1 | `ci.yml` runs the complete suite on an Auth-emulator/local-stack job with read-only contents permission; `gates.needs` includes `playwright`. Failure artifacts include traces, HTML report, screenshots, video, and stack logs. | Execute the final suite and CI; verify aggregation failure/cancellation.                   |
| Five core web journeys / I-2         | Existing registration and care-loop specs plus `core-journeys.spec.ts`; fixtures use current R00 CORE-005–010 behavior and isolated accounts.                                                                                    | Full passing browser execution pending; stale disclosure interactions are being corrected. |
| Required master check / I-3          | GitHub REST readback on 2026-10-04 confirms required `All gates`, GitHub Actions app 15368, strict up-to-date checks, and enforcement for administrators. No rulesets existed before configuration.                              | Observe a red-check PR blocked from merging without attempting a merge.                    |
| Native UI target / I-4               | `VerderyUITests` target and explicit Verdery scheme; first-garden test starts empty, rejects an empty submit, creates a named active owner garden and reads it after relaunch.                                                   | CI simulator execution pending.                                                            |
| Path-filtered Swift UI gate / I-5    | Existing Swift filter is unchanged. `swift` runs `scripts/run-ui-tests.sh`; failure propagates, and failure xcresult artifacts are retained.                                                                                     | Observe affected and unaffected CI runs.                                                   |
| Manual deployed evidence / I-6       | Chrome manual checks against deployed development show web 0.6.4 on 2026-10-04.                                                                                                                                                  | Record complete issue observations and closure decisions.                                  |

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

This setting is already applied remotely. Workflow changes are still in the
working tree until a reviewed branch is published; protection alone does not
prove that the new browser or simulator jobs have executed in GitHub Actions.
