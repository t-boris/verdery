---
type: feature
id: r02-reproducible-verification
title: R02 - Reproducible Verification
status: implemented
owner: ''
created: 2026-09-27
provenance: Recorded from the original research roadmap under the user's bulk creation instruction
roadmap_id: R02
priority: P0
sequence: 3
stage: 0
delivery_track: main-roadmap
understanding:
  Problem: known
  Target Users: known
  Primary Workflow: known
  Permissions: known
  Failure Scenarios: 'Failed or cancelled gates block merging; skipped gates are allowed by All gates. Failed GG-issues remain open and their fixes are excluded. Playwright retries once in CI; the native UI test does not retry.'
  Data Model: n/a
  Notifications: n/a
  Security: partial
  Analytics: n/a
  Dependencies: 'The existing Playwright specs now run through e2e/run-e2e.sh in an unconditional CI job. project.yml has the VerderyUITests target, executed by the retained Swift path filter. The default branch is master.'
  Acceptance Criteria: known
understanding_notes:
  Problem: Ядро web- и iOS-сценариев проверяется невоспроизводимо, и CI ничего не блокирует. Нужны обязательные гейты и датированные доказательства по GG-issues.
  Target Users: Команда разработки и QA/Platform, которые мержат в master.
  Primary Workflow: PR → «All gates» (Playwright, iOS UI-тест по path-фильтру) → merge разрешён только при зелёном required check. GG-issues проверяются вручную на deployed development.
  Permissions: 'Для branch protection нужны права администратора репозитория. Новые jobs работают с contents: read, как и существующие.'
  Failure Scenarios: 'Failed or cancelled gates block merging; skipped gates are allowed by All gates. Failed GG-issues remain open and their fixes are excluded. Playwright retries once in CI; the native UI test does not retry.'
  Data Model: Модель данных не меняется. Фикстуры берутся из базовой линии R00.
  Notifications: Не затрагиваются.
  Security: Playwright в CI использует Auth emulator, реальные секреты не нужны. Workflow сохраняет deny-by-default permissions.
  Analytics: Не затрагивается.
  Dependencies: 'The existing Playwright specs now run through e2e/run-e2e.sh in an unconditional CI job. project.yml has the VerderyUITests target, executed by the retained Swift path filter. The default branch is master.'
  Acceptance Criteria: 'REQ-001 обновлён: Playwright-job входит в «All gates», required check на master зафиксирован с датой, iOS UI-тест идёт в swift-job, у каждого GG-issue есть датированная строка в Observations.'
questions_left: 0
---

# R02 - Reproducible Verification

## Idea

Make verification of the core web and iOS journeys reproducible and required in CI.

## Planned Work

- Run Playwright in CI and cover garden creation, map editing, plants, observations, and tasks. The Playwright job is added to ci.yml and to the `needs` of "All gates"; "All gates" becomes a required status check for `master`, and that setting is documented with a date (DEC-001).
- Add the first native iOS UI test for creating the first garden. It runs on a simulator in the existing `swift` job, under that job's change-detection filter, so it is part of "All gates" (DEC-002).
- Verify the already fixed GG-0003, GG-0005, and GG-0007 by a manual browser check on deployed development and record each result as a dated Observations row with the web version in the issue; no Playwright assertions are added for these issues (DEC-003). Close them only when their own criteria pass.

## Priority and Placement

- Roadmap source: **R02**, **Stage 0**.
- Planning priority: **P0**; see the [roadmap index](../README.md) for priority and lane definitions.
- Index position: **3**; this records the source order, not a calendar commitment.
- Source estimate: **M**.
- Source delivery roles: **QA/Platform**; no named owner is assigned by this intake.

## Dependencies and Constraints

No earlier roadmap feature is stated as a hard dependency for the initial work. Follow the source's environment, domain, and approval prerequisites described below.

The current R00 baseline is the fixture reference. Implemented browser and native
gates and their dated execution results are recorded in the verification ledger.

## Requirement

[REQ-001 - Reproducible Verification](requirements/REQ-001.md) records the agreed scope and its verified acceptance criteria.

## Acceptance Criteria

- [x] The browser suite is an obligatory CI gate with the named core journeys.
- [x] The first-garden iOS UI test executes successfully as part of the path-filtered `swift` job in "All gates".
- [x] Each of GG-0003, GG-0005, and GG-0007 has dated acceptance evidence, not just implementation status.

## Implementation State

All seven REQ-001 criteria and all six plan items are verified in the
[ledger](implementation/verification.md). CI 37247309803 executed all 53 browser
tests: the five named core journeys and 52 tests passed; the retained GG-0005
assertion failed and correctly made required All gates fail. Native first-garden
creation/relaunch passed in CI. Master protection, failure/cancellation
propagation, the unchanged Swift filter, and dated deployed issue observations
are documented with evidence. GG-0003 is closed; GG-0005 and GG-0007 remain open.

Q-004 was withdrawn without a user answer after a direct requirement audit found
no contradiction. Recorded answers and decisions remain unchanged. No GG fix,
merge or release approval is inferred.

## Source

[SRC-001 - Original roadmap R02](references/SRC-001.md).
