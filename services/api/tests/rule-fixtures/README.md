# Recommendation rule fixtures — the horticultural review artifact

This directory is the reviewable evidence for the launch recommendation rules:
the original four (work package P7-RULE-01, acceptance evidence
"Horticulture-reviewed fixture suite") plus the three P9D-SEASON-RULES-01
seasonal rules (Stage 2 of P9D-SEASON-01, the identical evidence standard
applied to seasonal timing/rotation content). The consolidated review entry
point — tier model, excluded categories, per-rule ledger, and the sign-off
protocol in one document — is
`docs/development/recommendation-safety-catalog.md`; this README remains the
fixture-level half of that procedure.

**Review status: AWAITING horticultural review.** No agent or engineer can
self-satisfy a horticultural review; that sign-off belongs to a named human
reviewer, under work package P7-SAFE-01 for the original four rules and
P9D-SEASON-RULES-01 for the three seasonal rules. Every launch rule says so in
its own `review` metadata, and `launch-rule-catalog.test.ts` fails if that
marking is removed without a real reviewer's name. What is enforced
_regardless of review_, structurally: no rule can carry the `restricted`
safety tier (the type cannot express it, and the database rejects such a
candidate at insert), and no rule can declare an excluded content category —
chemical application, toxicity, pest treatment, disease diagnosis, fertilizer
concentration, structural, electrical, medical, legal-boundary, emergency
(`EXCLUDED_RULE_CONTENT_CATEGORIES` in
`src/modules/tasks-recommendations/domain/rule-definition.ts`).

## What a fixture is

Each `*.fixtures.ts` file holds scenarios of one shape:

- `facts` — a constructed garden: plants (with lifecycle stage and status),
  observations, open tasks, and the latest weather observation/forecast with
  an explicit freshness label. This is EVERYTHING the engine may consult.
- `prior` — what earlier evaluations already produced (live candidates, and
  the most recent candidate per rule and target).
- `expected` — the complete engine output for those inputs: every per-rule
  decision (fired / not eligible with a reason code / suppressed with the
  named duplicate / skipped with a typed missing-or-stale-data reason) and
  every produced candidate in full — safety tier, urgency, validity window,
  evidence rows referencing the exact records consulted, priority factors
  with numeric contributions and their basis facts, and the rendered
  user-facing explanation text.
- `reviewNotes` — what the scenario shows and which horticultural judgments
  it embodies (thresholds, stage lists, cadences, postures).

The runner (`rule-fixtures.test.ts`) feeds `facts` + `prior` through the real
launch catalog and asserts `expected` with **deep equality** — no partial
matching — and then re-runs the same inputs to prove the output is
deterministic. The engine is a pure function: same facts, same answer, no
clock or randomness inside.

## How to review

1. Read the seven rule definitions in
   `src/modules/tasks-recommendations/domain/rules/`. Each is one file: its
   thresholds sit in a named `parameters` block, its stage lists are named
   constants, its explanation template and stale-weather posture are declared
   data, and its header says what it recommends and what it deliberately does
   not. The three seasonal rules (`seasonal-sowing-window-check.ts`,
   `succession-replanting-reminder.ts`, `crop-rotation-caution.ts`) each carry
   an additional design-decision note in their header — a genuine engine
   constraint or a documented ambiguity resolution — worth reading before
   judging their `parameters`.
2. Read each fixture file here top to bottom. For each scenario, judge the
   `reviewNotes` question: given these facts, is this the right
   recommendation (or the right silence), at a sensible priority, with an
   honest explanation?
3. Ask for changes by pointing at the fixture and the parameter or condition
   you disagree with. A content change ships as a NEW rule version (the
   pinned content hashes in `launch-rule-catalog.test.ts` force that), with
   fixtures updated alongside.
4. Sign off by changing each approved rule's `review` metadata from
   `awaiting_horticultural_review` to `horticulturally_reviewed` with your
   name and date — that edit is the owning work package's deliverable
   (`P7-SAFE-01` for the original four rules, `P9D-SEASON-RULES-01` for the
   three seasonal rules), deliberately not part of the content hash
   (approval blesses content as it stands).

## Coverage map

| Behavior                                                                  | Fixture file                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Eligibility misses (status, stage, recency)                               | every per-rule file                                                                       |
| Weather-degraded behavior: stale used-and-labeled vs. stale-skip          | `watering-dry-spell-check` / `weather-frost-watch`                                        |
| Missing facts are never invented (no record; absent measurement)          | `watering-dry-spell-check`, `observation-routine-check-reminder`, `weather-frost-watch`   |
| Timing: validity windows, fact-derived window end, recurrence suppression | `lifecycle-harvest-readiness-check`, `weather-frost-watch`                                |
| Duplicate suppression against live candidates                             | `cross-rule`                                                                              |
| Duplicate suppression against open tasks (and the manual-task penalty)    | `cross-rule`                                                                              |
| Supersession of a stale live candidate                                    | `lifecycle-harvest-readiness-check`                                                       |
| Priority ordering across rules                                            | `cross-rule`                                                                              |
| Whole-rule skip on an unknown hemisphere                                  | `seasonal-sowing-window-check`, `succession-replanting-reminder`, `crop-rotation-caution` |
| Honest skip on an `awaiting_horticultural_review`-only seasonal fact      | `seasonal-sowing-window-check`, `succession-replanting-reminder`, `crop-rotation-caution` |
| Calendar-month WRAPAROUND (a window crossing the year boundary)           | `seasonal-sowing-window-check`                                                            |
| Engine recurrence mechanism reused for a per-taxon cadence fallback       | `succession-replanting-reminder`                                                          |
| Bed-occupancy-derived rotation conflict, same vs. different prior family  | `crop-rotation-caution`                                                                   |

End-to-end persistence of the same behaviors (evidence rows as foreign keys,
supersession transitions, idempotent re-runs, rule-version registration)
is proven against real PostgreSQL in
`tests/integration/recommendation-engine.test.ts`. The seasonal rules'
own fact-ASSEMBLY (the review-status filter, bed-occupancy derivation) is
additionally unit-tested directly in
`src/modules/tasks-recommendations/application/gather-seasonal-facts.test.ts`,
since the fixtures here start from an already-built `GardenFacts` and cannot
reach that layer.
