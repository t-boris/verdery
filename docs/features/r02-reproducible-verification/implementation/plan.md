---
type: plan
feature: r02-reproducible-verification
title: R02 - Reproducible Verification
issues:
  - id: I-1
    title: Add Playwright CI job wired into "All gates"
    summary: Add a CI job to .github/workflows/ci.yml that boots the local stack with the Auth emulator and runs the apps/web/e2e Playwright suite. List the job in the `needs` of the aggregating "All gates" job, so a failed or cancelled Playwright run makes "All gates" fail. Keep test artifacts (traces, reports) on failure.
    requirements: [REQ-001]
    decisions: [DEC-001]
  - id: I-2
    title: Playwright specs for core web journeys
    summary: Write or complete passing Playwright specs for garden creation, map editing, plants, observations, and tasks. Use deterministic fixtures based on the current R00 baseline. Every spec runs in the CI Playwright job.
    requirements: [REQ-001]
    decisions: [DEC-001]
  - id: I-3
    title: Require "All gates" in master branch protection and document it
    summary: A repository admin makes "All gates" a required status check on `master`. Confirm that a PR with a red "All gates" cannot be merged. Record the protection state and the date it was checked in repository documentation, and update the README note about the September 25 handoff. Every existing gate becomes merge-blocking.
    requirements: [REQ-001]
    decisions: [DEC-001]
  - id: I-4
    title: iOS UI test target with first-garden creation test
    summary: Add a UI test target to the iOS project (project.yml) with a simulator UI test that creates the first garden from a clean state. Isolate test data and make the test stable enough to block merges.
    requirements: [REQ-001]
    decisions: [DEC-002]
  - id: I-5
    title: Run iOS UI test in the path-filtered swift CI job
    summary: 'Extend the existing `swift` job to run the UI test target on a simulator. The job must fail when the test fails. Keep the job''s current change-detection filter: a change under apps/ios/** runs the test, and a change outside the filter skips it while "All gates" still passes.'
    requirements: [REQ-001]
    decisions: [DEC-002]
  - id: I-6
    title: Manual verification of GG-0003, GG-0005, GG-0007 on deployed development
    summary: Check each issue by hand in a browser on deployed development. In each issue, add a dated Observations row with "Web <version>, deployed development", the expected result, the actual result, and reproducibility. Close an issue only if all of its own acceptance criteria pass. Otherwise leave it open with the failing observation recorded. Fixing failures is out of scope.
    requirements: [REQ-001]
    decisions: [DEC-003]
updated: 2026-10-04
---

# Implementation plan — R02 - Reproducible Verification

## I-1: Add Playwright CI job wired into "All gates"

Add a CI job to .github/workflows/ci.yml that boots the local stack with the Auth emulator and runs the apps/web/e2e Playwright suite. List the job in the `needs` of the aggregating "All gates" job, so a failed or cancelled Playwright run makes "All gates" fail. Keep test artifacts (traces, reports) on failure.

Requirements: REQ-001
Decisions: DEC-001

## I-2: Playwright specs for core web journeys

Write or complete passing Playwright specs for garden creation, map editing, plants, observations, and tasks. Use deterministic fixtures based on the current R00 baseline. Every spec runs in the CI Playwright job.

Requirements: REQ-001
Decisions: DEC-001

## I-3: Require "All gates" in master branch protection and document it

A repository admin makes "All gates" a required status check on `master`. Confirm that a PR with a red "All gates" cannot be merged. Record the protection state and the date it was checked in repository documentation, and update the README note about the September 25 handoff. Every existing gate becomes merge-blocking.

Requirements: REQ-001
Decisions: DEC-001

## I-4: iOS UI test target with first-garden creation test

Add a UI test target to the iOS project (project.yml) with a simulator UI test that creates the first garden from a clean state. Isolate test data and make the test stable enough to block merges.

Requirements: REQ-001
Decisions: DEC-002

## I-5: Run iOS UI test in the path-filtered swift CI job

Extend the existing `swift` job to run the UI test target on a simulator. The job must fail when the test fails. Keep the job's current change-detection filter: a change under apps/ios/** runs the test, and a change outside the filter skips it while "All gates" still passes.

Requirements: REQ-001
Decisions: DEC-002

## I-6: Manual verification of GG-0003, GG-0005, GG-0007 on deployed development

Check each issue by hand in a browser on deployed development. In each issue, add a dated Observations row with "Web <version>, deployed development", the expected result, the actual result, and reproducibility. Close an issue only if all of its own acceptance criteria pass. Otherwise leave it open with the failing observation recorded. Fixing failures is out of scope.

Requirements: REQ-001
Decisions: DEC-003

## Implementation and verification handoff

All six plan items have concrete implementation and acceptance evidence in the
[verification ledger](verification.md). The five named web journeys passed in
CI 37247309803; the complete 53-test suite retains one excluded GG-0005 failure.
The native first-garden test passed in CI 37243669761 and CI 37247309803. Required-check configuration,
failed/cancelled aggregation, retained path-filter behavior, and the three
manual deployed observations are recorded with dates and source references.
The final native job passed and All gates correctly failed for GG-0005. This handoff does
not authorize merging a red PR or fixing or closing failed GG-issues.
