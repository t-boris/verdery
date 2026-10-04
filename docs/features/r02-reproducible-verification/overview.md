---
type: feature
id: r02-reproducible-verification
title: R02 - Reproducible Verification
status: implementing
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
  Failure Scenarios: partial
  Data Model: n/a
  Notifications: n/a
  Security: partial
  Analytics: n/a
  Dependencies: known
  Acceptance Criteria: known
understanding_notes:
  Problem: Ядро web- и iOS-сценариев проверяется невоспроизводимо, и CI ничего не блокирует. Нужны обязательные гейты и датированные доказательства по GG-issues.
  Target Users: Команда разработки и QA/Platform, которые мержат в master.
  Primary Workflow: PR → «All gates» (Playwright, iOS UI-тест по path-фильтру) → merge разрешён только при зелёном required check. GG-issues проверяются вручную на deployed development.
  Permissions: 'Для branch protection нужны права администратора репозитория. Новые jobs работают с contents: read, как и существующие.'
  Failure Scenarios: 'Красный или отменённый гейт блокирует merge, пропущенный считается допустимым (так уже устроено в «All gates��). Если GG-issue не проходит, он остаётся открытым, а исправление не входит в фичу. Нестабильность тестов в CI сглаживается retries: 1 в playwright.config.ts; для iOS это решает реализатор.'
  Data Model: Модель данных не меняется. Фикстуры берутся из базовой линии R00.
  Notifications: Не затрагиваются.
  Security: Playwright в CI использует Auth emulator, реальные секреты не нужны. Workflow сохраняет deny-by-default permissions.
  Analytics: Не затрагивается.
  Dependencies: 'Факт проекта: playwright.config.ts и specs уже есть (register-and-create-garden, care-loop и др.) и запускаются через e2e/run-e2e.sh, но в ci.yml job для них нет. UI-test target в project.yml отсутствует. Default-ветка — master.'
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

Use the current R00 baseline when choosing fixtures. This card does not claim that Playwright or native UI gates already exist.

## Requirement

[REQ-001 - Reproducible Verification](requirements/REQ-001.md) records the source scope and its future acceptance criteria.

## Acceptance Criteria

- [ ] The browser suite is an obligatory CI gate with the named core journeys.
- [ ] The first-garden iOS UI test executes successfully as part of the path-filtered `swift` job in "All gates".
- [ ] Each of GG-0003, GG-0005, and GG-0007 has dated acceptance evidence, not just implementation status.

## Intake State

This is a draft record of planned work. Feature intake has not performed discovery, implementation,
verification, or release approval for this feature. All acceptance criteria remain pending.

## Source

[SRC-001 - Original roadmap R02](references/SRC-001.md).
