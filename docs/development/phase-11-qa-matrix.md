# Phase 11 QA matrix (P11-QA-01)

> Status: evidence for the G10 review.
> Last updated: August 3, 2026

P11-QA-01's row reads: "Execute the cross-platform domain, provider, search/filter, sync, offline,
media, AI safety, accessibility, localization, performance, deletion/export, sharing, failure, and
cost matrix," with "G10 evidence report" as the deliverable. This is that report.

It records what was actually executed and what was not. A matrix that marks a row green because the
code for it exists would be worse than no matrix: it would spend the reviewer's trust on a claim
nobody checked.

---

## 1. How to read a row

| Mark        | Meaning                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| **Run**     | Executed while writing this report; the count or the command is named.                         |
| **CI only** | Real automated coverage that needs a container runtime this environment does not have running. |
| **Gap**     | No automated coverage exists. What is missing is stated, not implied.                          |
| **Owner**   | Cannot be closed by engineering: a device, a deployment, a decision, or a person is required.  |

Two environment facts apply to every row and are not repeated:

1. **No Docker.** Every container-backed suite skips locally. That is 84 integration files, 24 HTTP
   route files, and 43 migration files in `services/api/tests/` — all real, all executed in CI's
   `typescript` job, none re-run here. Rows depending on them are marked **CI only**, never **Run**.
2. **No deployed environment.** There is no running Postgres/Firebase-backed instance to point a
   browser at, so `apps/web/e2e/` (ten Playwright specs) was not executed either.

---

## 2. What was executed

| Suite                       | Command                                     | Result                          |
| --------------------------- | ------------------------------------------- | ------------------------------- |
| Contract                    | `pnpm --filter @verdery/api-contracts test` | 34 tests passed                 |
| Contract bundle drift       | `... bundle:check`                          | bundle matches its source tree  |
| Generated client drift      | `... generate:check`                        | client matches the contract     |
| API unit and application    | `npx vitest run src` in `services/api`      | 187 files, 1602 tests passed    |
| Web                         | `npx vitest run` in `apps/web`              | 138 files, 1122 tests passed    |
| iOS                         | `swift test` in `apps/ios`                  | 1033 tests in 145 suites passed |
| Web production build        | `pnpm --filter @verdery/web build`          | compiled; every route present   |
| Workspace types             | `pnpm typecheck`                            | clean across every package      |
| Formatting, lint, file size | tracked files only                          | clean                           |

---

## 3. The matrix

### 3.1 Cross-platform domain

**Run.** Plant, candidate, observation, and journal semantics are covered by unit and application
tests on both clients and the server: `services/api/src/modules/plants-inventory`,
`observations-history`, `apps/web/features/{plants,candidates,observations}`, and
`apps/ios/Tests/{FeaturePlantsTests,FeatureObservationsTests}`.

**Gap.** Nothing asserts that the two clients present the same product meaning; each is tested
against the contract separately. The nearest thing that exists is
`packages/test-fixtures/fixtures`, which both runtimes read — but it covers geometry and sync
shapes, not plant-library or journal semantics. A shared fixture set for those is the honest fix and
is not built.

### 3.2 Providers

**CI only / Owner.** Adapter behaviour is covered by `services/api/tests/integration` against
recorded provider shapes. Five adapters exist (World Flora Online, USDA PLANTS, GBIF, USA-NPN,
Vertex AI species identification); the other five named in ADR-0016 were descoped by the owner on
2026-08-03 and have no tests because they have no code. Real-world evaluation against live
providers remains an owner gate — it needs credentials and a budget decision, not a test.

### 3.3 Search and filters

**Run.** `searchPlants`' six joined filters have parser tests
(`services/api/src/modules/plants-inventory/transport/plant-search-query.test.ts`) and client
coverage on both platforms. The web filter state round-trips through the URL
(`plant-list-url-state.test.ts`, 15 cases including hand-edited and stale values).

**CI only.** The SQL those filters produce is exercised by
`services/api/tests/integration/plant-search-extensions.test.ts`, which needs Postgres.

**Gap.** Search by synonym and cultivar with a visible match explanation (§20.4) is not built:
`searchTaxonomyReferences` matches names and returns `matchedName`, but no client shows WHY a row
matched.

### 3.4 Synchronization and offline

**Run.** iOS outbox, conflict, and backlog behaviour: `CoreSynchronizationTests`, including a
randomized long-running convergence suite. Journal capture goes through the same outbox — a
measurement or a purpose-labelled photograph recorded offline is in the payload
(`ObservationsUseCasesOfflineTests`).

**CI only.** Server-side push/pull, tombstones, and cursor resume:
`services/api/tests/integration/synchronization*.test.ts`.

**Gap.** The web client is online-first by design; there is nothing to test there beyond the
recoverable drafts already covered.

### 3.5 Media

**Run.** Upload state machine, recovery, and derivative display on both clients
(`media-upload-controller.test.ts`, `MediaUploadCoordinator` tests). Journal frames read, narrow,
and drop an unresolvable frame rather than the sequence (`plant-journal-strip.test.tsx`,
`PlantJournalViewModelTests`).

**CI only.** Upload verification, retention sweeps, and orphan reconciliation:
`services/api/tests/integration/media*.test.ts`.

**Gap.** Duplicate detection is unbuilt and needs a perceptual-hashing dependency this repository
does not have — an owner decision, recorded in `deferred-capabilities.md`. Structured symptoms are
likewise unbuilt: the P11-MEDIA-01 migration's own header explains that they overlap
`image_analysis_result` and need a design pass first. Time-lapse generation is deliberately cut
(owner decision, 2026-08-03).

### 3.6 AI safety

**Run.** `analyzeObservationPhoto`'s refusal and fallback paths, the fixed no-analysis outcome when
no model can be reached, and the four-state disposition are covered in
`services/api/src/modules/observations-history` and, on the web, in
`observation-analysis-result.test.tsx`. `PLANT_CONDITION_AI_ENABLED` is `false` in every
environment.

**Owner.** Real-photo evaluation of the Vertex adapter and the data-retention confirmation are the
same ADR-0015 gates they have been since Phase 10. No test can close them.

### 3.7 Accessibility

**Run.** `apps/ios/Tests` enforce two conventions mechanically: no view hard-codes a font size, and
every literal dimension goes through `@ScaledMetric`. Web components are tested through
accessible queries (roles and labels), so a control without an accessible name fails its own test.

**Gap / Owner.** No screen reader has been run against either client in this phase — not VoiceOver
on a device, not a desktop reader against the web app. `apps/web/e2e/accessibility.spec.ts` exists
and was not executed here (no environment). This is the largest single gap in the matrix and it
cannot be closed without hardware.

### 3.8 Localization

**Run.** Both catalogues are complete and machine-checked: `keyed-copy.test.ts` fails on English
prose written into JSX instead of a key, and the iOS `LocalizationCatalogueTests` fail on a key with
no entry, an entry nothing refers to, and a Russian entry still holding its English text. Every
string added in this phase is in both languages.

**Gap.** No review by a Russian-speaking gardener. The catalogue is complete; whether it reads
naturally is not something a test knows.

### 3.9 Performance

**Gap / Owner.** No performance evidence was gathered in this phase. The budgets in
`ios-application-design.md` (frame rate, query duration, outbox drain) and the web's own targets are
unmeasured here; `tests/load/` exists and needs a deployed environment. Nothing in this phase's
changes is obviously hot — the journal strip resolves signed URLs one per frame, bounded at 200 —
but "not obviously hot" is not a measurement.

### 3.10 Deletion and export

**CI only.** `services/api/tests/integration/exports-privacy.test.ts` and the deletion workflow
suites cover entitlement and purge order, including the garden-purge FK behaviour P11-SHARE-01
fixed.

**Gap.** No client UI for requesting an export or a deletion exists on either platform; the
contract ships and nothing calls it. Recorded in `deferred-capabilities.md`.

### 3.11 Sharing

**Run.** Publication staging now offers derivative-only media options
(`staging-queries.test.ts`), which is the client half of the EXIF/GPS rule the server enforces
twice.

**CI only.** Entitlement, withdrawal, and cross-client isolation:
`services/api/tests/integration/collaboration-publications*.test.ts`.

**Gap.** No iOS client portal. A client reads publications on the web only.

### 3.12 Failure behaviour

**Run.** Both clients keep already-loaded data visible behind a staleness notice on a failed
refresh, and both were tested for it. Provider outage has a web E2E spec
(`provider-outage.spec.ts`, not executed here).

**CI only.** Idempotency replay, revision conflicts, and constraint violations across the API
suites — including the duplicate-measurement refusal added in this phase, which is covered by
parser unit tests that run without a container.

### 3.13 Cost

**Owner.** Unmeasured. Per-request AI cost, media storage growth, and provider quota consumption
need a deployed environment and a billing account to observe. `cost-and-scaling.md` names the
triggers; none of them can be evaluated from a checkout.

---

## 4. Required UI states (§20.4)

| State group                                    | Where it stands                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Actual/candidate/converted/archived/removed    | Built and tested on both clients.                                                                                            |
| Image-card and compact-row layouts             | Web plant list is a photo-first card grid with a fallback for a plant with no photo. iOS list is rows.                       |
| Icon controls, focus, non-colour status cues   | Enforced by convention tests on iOS and by accessible-name queries on web; unverified by a screen reader.                    |
| Search by synonym/cultivar with match reason   | **Gap** — see 3.3.                                                                                                           |
| Filter panel, active-filter summary, clear-all | Web: panel plus an active-filter count, and now shareable URL state. iOS: filters exist; no shareable state (none to share). |
| Zero-results recovery                          | Both clients distinguish "nothing here" from "nothing matches this filter" in the journal; the plant lists do not yet.       |
| Add from catalog/camera/existing image/unknown | Camera and existing image on both. Catalog browse exists on web (name search plus profile); adding FROM it does not.         |
| Candidate placement, suitability, alternatives | Web: built. iOS: built.                                                                                                      |
| Plant detail hero, cited care, partial data    | The taxon profile shows every fact with provider and citation, and says when it is partial. Not yet on the plant screen.     |
| Journal capture, before/after, measurements    | Built on both clients this phase. Duplicate warning, matched overlay, and time-lapse are **Gap** — see 3.5.                  |
| Health-analysis states                         | Built on web (evidence, alternatives, safety class, model-unavailable, disposition). iOS shows the real shape.               |

---

## 5. What must happen before G10 is decided

None of these is engineering work that was skipped; each needs something a checkout cannot provide.

1. A screen-reader pass on both clients, on real hardware (3.7).
2. Performance measurement against a deployed environment (3.9).
3. Real-photo evaluation of the Vertex adapter, and the data-retention confirmation (3.6).
4. A cost observation window with real usage (3.13).
5. Owner decisions, each already recorded: the perceptual-hashing dependency for duplicate
   detection, the symptom schema design pass, and the licensed-imagery provider for taxon photos.

Source: [../implementation-plan.md](../implementation-plan.md), work package `P11-QA-01` and
section 20.4; [deferred-capabilities.md](deferred-capabilities.md).
