# Candidate suitability rule fixtures — the horticultural review artifact

This directory is the reviewable evidence for the P11-SUIT-01 suitability rules, mirroring
`tests/rule-fixtures/README.md`'s role for the recommendation engine.

**Review status: AWAITING horticultural review (P11-SUIT-01).** No agent or engineer can
self-satisfy a horticultural review. Every rule says so in its own `review` metadata, and
`src/modules/plants-inventory/domain/suitability-rules/suitability-rule-catalog.test.ts` fails
if that marking is removed without a real reviewer's name.

## What a fixture is

Each `*.fixtures.ts` file holds scenarios of one shape:

- `garden` — a constructed `GardenSuitabilityFacts`: sun exposure, drainage, growing context,
  region. This is everything the engine may consult about the garden.
- `candidate` — a constructed `CandidateSuitabilityFacts`: the candidate's grouping/quantity,
  its resolved plant-profile facts, and its resolved distribution/regulatory facts.
- `expected` — the complete engine output: every finding, in every category (match, caution,
  blocker, unknown, assumption), with its full evidence.
- `reviewNotes` — what the scenario shows and which horticultural/product judgment it embodies
  (a severity threshold, an honesty boundary, a degraded-data posture).

The runner (`suitability-fixtures.test.ts`) feeds `garden`/`candidate` through the real
suitability catalog and asserts `expected` with **deep equality**, then re-runs the same inputs
to prove determinism.

## How to review

1. Read the three rule definitions in
   `src/modules/plants-inventory/domain/suitability-rules/`. Each is one file: its ordinal
   distance table is a named constant, and its header states what it evaluates and what it
   deliberately does not (yet).
2. Read each fixture file here top to bottom. For each scenario, judge the `reviewNotes`
   question — is the severity (match/caution/blocker) and the honesty boundary
   (unknown/assumption vs. a real verdict) right?
3. Ask for changes by pointing at the fixture and the rule logic you disagree with. A content
   change ships as a NEW rule version (the pinned content hashes in
   `suitability-rule-catalog.test.ts` force that), with fixtures updated alongside.
4. Sign off by changing each approved rule's `review` metadata from
   `awaiting_horticultural_review` to `horticulturally_reviewed` with your name and date.

## Coverage map

| Behavior                                                             | Fixture file                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| Exact-match, adjacent-mismatch (caution), opposite-ends (blocker)    | `sun-exposure-compatibility`, `drainage-compatibility` |
| Missing garden context never becomes a positive match                | every fixture file                                     |
| Missing plant fact never becomes a positive match                    | every fixture file                                     |
| Region-matched regulatory verdict (future path, already implemented) | `regulatory-status`                                    |
| Region-unknown degraded posture: caution vs. explicit assumption     | `regulatory-status`                                    |

Three of design doc section 10's axes (hardiness, mature space, user preference) have no rule
or fixtures yet — see `suitability-rule-catalog-instance.ts`'s own header for why each is an
honest, recorded gap rather than an oversight.

End-to-end persistence (a real `RecalculateCandidateSuitability` command against real
Postgres, reading real garden-context facts and a real plant profile version) is proven in
`tests/integration/candidate-suitability.test.ts`.
