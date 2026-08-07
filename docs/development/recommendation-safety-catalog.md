# Recommendation safety catalog (P7-SAFE-01, extended by P9D-SEASON-RULES-01)

The single authoritative document a human horticultural reviewer reviews against and signs.
It consolidates, in one place: the safety-tier model and where it is enforced, the excluded
content categories and where each exclusion is enforced, the constraint rules for
elevated-risk generation, the per-rule review ledger for every shipped rule version, the review
procedure, and the sign-off protocol.

**Review status: AWAITING horticultural review.** No agent or engineer can perform a
horticultural review; producing this catalog is work package `P7-SAFE-01`'s implementable
half (extended, not replaced, by `P9D-SEASON-RULES-01` for the three seasonal rules Stage 2
of P9D-SEASON-01 added), and the sign-off itself remains honestly open (recorded in
[deferred-capabilities.md](deferred-capabilities.md)). Everything in sections 2–4 is
enforced structurally **regardless of review** — types, validation, database constraints,
and CI tests, each named below with its file and symbol.

## 1. Scope and sources

The launch recommendation pipeline is rules-first and deterministic
([../architecture/recommendations-and-ai.md](../architecture/recommendations-and-ai.md),
ADR-0008): seven versioned rules produce every candidate (the original four launch rules,
plus three seasonal rules — sowing-window timing, succession replanting, crop-rotation
caution — P9D-SEASON-RULES-01 appended), and the optional AI step may only rephrase a
candidate's own stored deterministic explanation — it never creates a recommendation and
never survives validation with new content. Safety therefore has exactly two enforcement
surfaces, both covered here:

- **The rule layer** — what a rule definition may declare and what a candidate row may
  contain (`services/api/src/modules/tasks-recommendations/domain/rule-definition.ts`,
  `migrations/1785600000000_recommendations-baseline.sql`).
- **The AI explanation layer** — what an accepted embellishment may say
  (`services/api/src/modules/tasks-recommendations/domain/ai-explanation-lexicon.ts`,
  `ai-explanation-validation.ts`).

Section 13 of recommendations-and-ai.md defines the policy; this catalog maps every clause
of it to its enforcement point.

## 2. The safety-tier model and its enforcement points

Section 13 defines three tiers. Only the first two are _generatable_; the third is
structurally unrepresentable in generated recommendations until a dedicated policy stage
exists.

| Tier            | Section 13 subjects                                                                    | Launch posture                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ordinary_care` | Watering, routine pruning timing, observation reminders, general maintenance           | Generatable through the standard pipeline (6 of 7 launch rules — the three P9D-SEASON-RULES-01 seasonal rules are all `ordinary_care`)                           |
| `elevated_risk` | Disease diagnosis, toxicity, pest treatment, fertilizer concentration, weather hazards | Generatable only under the section-4 constraints (1 launch rule, and only its weather-hazard subject — the other four subjects are excluded outright, section 3) |
| `restricted`    | Chemical application, emergency, legal-boundary, structural, electrical, medical       | **Structurally impossible** — see below                                                                                                                          |

`restricted` is excluded at four independent layers ("belt and suspenders" is deliberate —
any single layer failing leaves three):

1. **Type layer** — `GeneratableSafetyTier = Exclude<RecommendationSafetyTier, 'restricted'>`
   (`domain/rule-definition.ts`): a rule definition's `safetyTier` field cannot spell
   `'restricted'`; the code does not compile.
2. **Domain validation** — `requireGeneratableSafetyTier`
   (`domain/recommendation-candidate.ts`) rejects a restricted tier again at candidate
   construction.
3. **Database layer** (`migrations/1785600000000_recommendations-baseline.sql`) —
   `recommendation_candidate_generatable_safety_tier_check` (`safety_tier IN
('ordinary_care', 'elevated_risk')`) makes a restricted candidate row uninsertable, and
   the composite foreign key `recommendation_candidate_rule_version_fkey`
   (`(rule_version_id, safety_tier) REFERENCES rule_version (id, safety_tier)`) pins the
   candidate's stored tier to the referenced rule version's own tier, so a mismatched pair
   cannot exist either. `rule_version_safety_tier_check` closes the tier vocabulary itself.
4. **Registrar consistency** — `EvaluateGardenRecommendations`'s rule-version registrar
   (`application/evaluate-garden-recommendations.ts`) refuses at runtime a stored
   `rule_version` row whose tier disagrees with the catalog definition: rule content changed
   without a version bump is an error, never a silent overwrite.

CI pins the launch catalog's tier facts in
`domain/rules/launch-rule-catalog.test.ts`: exactly one `elevated_risk` rule, zero
`restricted` (unrepresentable and asserted absent), and a sha256 content hash per shipped
version so any content change — tier included — forces a new version.

## 3. Excluded content categories

`EXCLUDED_RULE_CONTENT_CATEGORIES` (`domain/rule-definition.ts`) names the subjects no rule
may declare: section 13's Restricted list verbatim, **plus** the Elevated-Risk subjects the
launch deliberately does not attempt. This is the "explicitly exclude" half of P7-SAFE-01's
mandate — every category named in the work package title (chemical, toxicity,
pest-treatment, structural, medical, legal-boundary) appears below, alongside the other
four the same policy covers.

Enforcement, per layer:

- **Rule layer**: `validateRuleDefinition` → `requireAllowedContentCategory` rejects any
  rule whose `careCategory` matches an excluded category **in any spelling**
  (`normalizeContentCategory` folds case, spaces, and hyphens: `'Pest Treatment'`,
  `'pest-treatment'`, and `'pest_treatment'` are one category). Runs at catalog
  construction, so a defective definition fails composition, not a garden's evaluation.
  Pinned by `domain/rule-definition.test.ts`.
- **AI layer**: `PROHIBITED_CATEGORIES` (`domain/ai-explanation-lexicon.ts`) spells each
  subject as bilingual (en + ru) word stems and exact forms; `validateAiExplanationDraft`
  (`domain/ai-explanation-validation.ts`) rejects any draft naming one — **regardless of
  baseline**: no launch rule can declare these categories, so no baseline can legitimize
  the vocabulary, and the lexicon refuses it even if one somehow did. Pinned per entry by
  `domain/ai-explanation-validation.test.ts` and the bilingual harness in
  `tests/ai-explanation-fixtures/`.

| Excluded category          | What it covers (guidance the launch refuses to generate)                           | Rule-layer entry           | AI-lexicon category        |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------- | -------------------------- |
| `chemical_application`     | Applying pesticides, herbicides, fungicides, insecticides, or any chemical product | `chemical_application`     | `chemical_application`     |
| `disease_diagnosis`        | Diagnosing plant disease (blight, mildew, rot, infection)                          | `disease_diagnosis`        | `disease_diagnosis`        |
| `electrical`               | Electrical work, wiring, voltage                                                   | `electrical`               | `electrical`               |
| `emergency`                | Emergency response of any kind                                                     | `emergency`                | `emergency`                |
| `fertilizer_concentration` | Dosages, dilutions, concentrations (ppm/mg/ml)                                     | `fertilizer_concentration` | `fertilizer_concentration` |
| `legal_boundary`           | Legal advice, property-boundary disputes, lawsuits                                 | `legal_boundary`           | `legal_boundary`           |
| `medical`                  | Human/animal medical guidance, poisoning response, antidotes                       | `medical`                  | `medical`                  |
| `pest_treatment`           | Treating pests (aphids, slugs, mites, caterpillars)                                | `pest_treatment`           | `pest_treatment`           |
| `structural`               | Structural work, foundations, load-bearing elements                                | `structural`               | `structural`               |
| `toxicity`                 | Plant-toxicity claims and guidance ("is this plant poisonous")                     | `toxicity`                 | `medical` (see below)      |

**The one deliberate divergence — `toxicity` → `medical`.** The rule layer excludes ten
categories; the AI lexicon carries nine prohibited-category ids. `toxicity` has no lexicon
entry of its own because, in both product languages, the words for "this plant is toxic"
(toxic, poison, яд, ядовит, токсич) **are** the `medical` entry's term set — plant-toxicity
guidance and poisoning-related medical guidance share one vocabulary, and a separate
`toxicity` entry would duplicate the same stems under a second id without rejecting a
single additional draft. The divergence is documented and **pinned by test**:
`domain/ai-explanation-lexicon.test.ts` asserts (a) every excluded rule category is covered
by a prohibited lexicon category through an explicit mapping, (b) no lexicon category
exists outside the rule-layer list, (c) representative toxicity vocabulary in both
languages actually matches the `medical` entry, and (d) every prohibited category carries
terms in both languages. Extending either list without the other fails CI.

**Widening or narrowing either list is a reviewed code edit** — never a runtime option, a
configuration flag, or a data migration. A future stage that wants to generate guidance in
one of these categories must ship the "dedicated policy" section 13 requires, relax the
database CHECK by migration, and pass its own review.

## 4. Constraint rules for elevated-risk generation

Section 13 does not exclude `elevated_risk` — it _constrains_ it: "higher confidence, clear
uncertainty, and reviewed sources". The launch reading of each clause, expressed in
versioned rule content (not engine configuration) so the constraints are themselves
review-visible data:

1. **Clear uncertainty in the content itself.** An elevated-risk rule's explanation
   template must state its uncertainty explicitly. The frost rule's template says
   "_may_ be frost-sensitive" and attributes the claim to a forecast;
   `launch-rule-catalog.test.ts` pins the template's uncertainty wording.
2. **Higher confidence required — so degraded inputs produce nothing.** An elevated-risk
   weather rule declares `whenStale: 'skip'`: a stale forecast produces no candidate rather
   than a lower-confidence hazard warning. (The ordinary-care watering rule may declare
   `useLabeledStale` instead — firing with a dropped confidence factor and the `stale`
   label in both the evidence snapshot and the factor basis.) The per-tier posture is
   pinned by `launch-rule-catalog.test.ts` and by fixtures in both weather rule files.
3. **Confidence stated as a number, deliberately low.** The frost rule's `confidence`
   factor contributes 10 (vs 20 for the ordinary-care rules' own-records/fresh-weather
   confidence), with the basis naming `safetyTier: 'elevated_risk'` and
   `source: 'forecast'` — section 13's uncertainty made explainable and persisted.
4. **A hazard window that ends when the hazard passes.** The frost candidate's validity
   window ends AT the forecast moment (the fact-derived `windowEnd` override) — a frost
   warning is meaningless after the night it warns about — and a forecast whose moment
   already passed skips with a typed `factMissing` reason.
5. **The suggested action stays protective and non-invasive.** "Consider protective cover"
   — covering, not chemicals, structures, or emergency action; the action-concept lexicon
   (section 5) then prevents the AI layer from escalating it.

The AI layer applies one further constraint to **every** tier: an embellishment's action
vocabulary is bounded by the candidate's own deterministic baseline. `ACTION_CONCEPTS`
(`domain/ai-explanation-lexicon.ts`) enumerates the care actions a model could name, and
`validateAiExplanationDraft` permits a concept only when the rule's own stored explanation
or action title names it — so a watering embellishment can restate watering in either
language but can never add pruning, fertilizing, spraying, transplanting, removal, or
moving. Invented numbers (`unsupported_fact`), out-of-packet evidence claims
(`unknown_evidence_reference`), and over-length drafts are rejected on the same pass, and
every rejection falls back to the always-served deterministic text.

**The catalog is now visible in the product.** `GET /gardens/{gardenId}/care-rules` lists every
rule an evaluation would run, its review status, and — computed against that garden's own facts —
what currently prevents it from producing anything. It reports PRECONDITIONS, never a prediction
that a rule would fire: whether a rule fires depends on thresholds, plant stages and recurrence
history, and answering that outside the engine would mean reimplementing its decisions somewhere
they could drift. The outstanding horticultural review is disclosed on every rule there, because a
surface explaining what the automation does must not quietly omit that its thresholds are
placeholders.

## 5. Launch rule ledger

Seven rule KEYS, eight shipped VERSIONS: `watering.dry-spell-check` ships v1 and v2, and only
v2 is evaluated (see 5.1). Every version carries
`reviewStatus: 'awaiting_horticultural_review'` — the original four keys under
`awaitingReviewBy: 'P7-SAFE-01'`, the three P9D-SEASON-RULES-01 seasonal rules under
`awaitingReviewBy: 'P9D-SEASON-RULES-01'` (`RuleReviewMetadata`'s own widened
`awaitingReviewBy` literal union, `domain/rule-definition.ts`) — carried in each rule's own
`review` metadata and asserted by `launch-rule-catalog.test.ts` until a named reviewer
replaces it. Rule sources live in
`services/api/src/modules/tasks-recommendations/domain/rules/`; fixtures in
`services/api/tests/rule-fixtures/` (46 scenarios total — 23 for the original four rules,
21 for the three seasonal rules, 2 for the completed-work suppression — each with
per-scenario horticultural `reviewNotes`; the cross-rule file exercises the original four
rules together, and each seasonal rule's own fixture file necessarily also pins the other two
seasonal rules' decisions for the same facts, since the full catalog runs on every fixture).

**Completed work is now an engine input.** A task provably originating from a rule and target,
completed less than one recurrence interval ago, suppresses that rule for that target. Before
this existed, completing a task removed the open task that had been suppressing its own
recommendation and the clock still ran from when the work was last SUGGESTED — so watering a
plant on Friday earned the same recommendation on Saturday. Equivalence is proved through
`task.origin_recommendation_id`; a manual task carries none and suppresses nothing, because a
free-text title cannot be shown to mean "I watered this".

### 5.1 `watering.dry-spell-check` v2 — ordinary care

**Supersedes v1.** v1 decided on a SINGLE latest precipitation figure, which for the selected
provider is the preceding hour. An hour of calm is not a dry spell and an hour of rain does not
water a garden, so v1 could recommend a watering check in the hour after a thunderstorm and stay
silent through a genuinely parched week. v2 decides on rainfall ACCUMULATED over elapsed days.
v1 remains in the catalog, unevaluated but renderable, so candidates it produced still explain
themselves.

| Field            | Value                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category  | `ordinary_care` / `watering`; urgency `normal`                                                                                                                                                                                     |
| Recommends       | "Check whether this plant needs watering" — a check plus a stated shortfall in millimetres, never an amount to apply or a schedule                                                                                                 |
| Trigger          | Rainfall summed over the last 7 elapsed days (`dryWindowDays`) below half (`deficitFraction`) of a 25 mm reference weekly supply (`referenceWeeklySupplyMm`), AND the latest reading ≥ 20 °C (`warmDayCelsius`)                    |
| Refuses to fire  | No rainfall history at all (unknown is never read as dry); fewer than 4 measured days (`minimumDaysCovered`) — a short window is not evidence of drought; no temperature measurement                                               |
| Eligible plants  | Active, in an active-growth stage: seedling, transplanted, growing, flowering, fruiting                                                                                                                                            |
| Timing           | 48 h validity window, 72 h recurrence interval — and the interval is measured from a COMPLETED watering task when one exists, so watering the plant silences its own check                                                         |
| Weather posture  | `useLabeledStale` — the temperature reading may be aged, with confidence 20 → 8; the rainfall history is elapsed days and does not stale the same way                                                                              |
| Priority         | 85 fresh (73 stale): urgency 20 + weather 30 (20 when the shortfall is milder) + plant impact 15 + confidence 20/8                                                                                                                 |
| Fixtures         | `watering-dry-spell-check.fixtures.ts`, 5 scenarios: rainless-week fire, labeled stale fire, adequate-rainfall skip, no-history skip, dormant-plant not-eligible; plus `completed-care.fixtures.ts` for the completion suppression |
| Review questions | Is 25 mm a defensible reference weekly supply, and is half of it the right line for "short of water"? Is 7 days the right window and 4 the right minimum history? Is 20 °C right? Is 72 h the right quiet period after a watering? |
| Not claimed      | The rule reports rainfall short of a reference supply. It does NOT model soil moisture — this system stores no soil facts, and the wording must not imply one                                                                      |
| Status           | **Awaiting horticultural review**                                                                                                                                                                                                  |

### 5.2 `observation.routine-check-reminder` v1 — ordinary care

| Field            | Value                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category  | `ordinary_care` / `observation`; urgency `low`                                                                                                                                                                      |
| Recommends       | "Record a quick condition check for this plant"                                                                                                                                                                     |
| Trigger          | Active plant unobserved ≥ 14 days (`checkIntervalDays`), measured from the latest observation or — never observed — from plant creation; no observation reference is ever invented                                  |
| Timing           | 7-day validity window, 14-day recurrence interval; no weather                                                                                                                                                       |
| Priority         | 40: urgency 10 + plant impact 10 + confidence 20 (own records)                                                                                                                                                      |
| Fixtures         | `observation-routine-check-reminder.fixtures.ts`, 3 scenarios: overdue fire with exact-observation evidence, never-observed fire with creation baseline and no fabricated reference, recently-observed not-eligible |
| Review questions | Is a 14-day cadence right? Is creation the right baseline for a never-observed plant?                                                                                                                               |
| Status           | **Awaiting horticultural review**                                                                                                                                                                                   |

### 5.3 `lifecycle.harvest-readiness-check` v1 — ordinary care

| Field            | Value                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category  | `ordinary_care` / `harvest`; urgency `high`                                                                                                                                                                                                                             |
| Recommends       | "Check ripeness and harvest what is ready" — the USER declared readiness; the rule adds only timing pressure                                                                                                                                                            |
| Trigger          | Active plant in user-declared `ready_to_harvest` stage                                                                                                                                                                                                                  |
| Timing           | 5-day validity window, 7-day recurrence interval; no weather                                                                                                                                                                                                            |
| Priority         | 75: urgency 30 + plant impact 25 + confidence 20 (user-declared stage)                                                                                                                                                                                                  |
| Fixtures         | `lifecycle-harvest-readiness-check.fixtures.ts`, 7 scenarios: fire, recurrence quiet after completion, recurrence-elapsed re-fire, stale-candidate supersession, postponed-until-tomorrow quiet, passed-postpone-horizon re-fire, dateless-postpone recurrence fallback |
| Review questions | Are the 5-day window and 7-day recurrence sensible for a harvest nudge? Is the recurrence interval the right fallback for a dateless postpone?                                                                                                                          |
| Status           | **Awaiting horticultural review**                                                                                                                                                                                                                                       |

### 5.4 `weather.frost-watch` v1 — elevated risk (the constrained rule)

| Field            | Value                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category  | `elevated_risk` / `weather_protection`; urgency `urgent`                                                                                                              |
| Recommends       | "Consider protective cover against forecast frost" — covering only, per the section-4 constraints                                                                     |
| Trigger          | Fresh forecast ≤ 0 °C (`frostThresholdCelsius`) at an UPCOMING moment; a passed forecast moment, a missing temperature, or a stale forecast each produce a typed skip |
| Eligible plants  | Active, in a frost-sensitive stage: seedling, transplanted, flowering                                                                                                 |
| Timing           | Validity window ends AT the forecast moment (fact-derived override; 48 h fallback); 24 h recurrence                                                                   |
| Weather posture  | `skip` on stale — an elevated-risk rule produces nothing rather than a lower-confidence hazard warning                                                                |
| Priority         | 95: urgency 35 + weather risk 30 + plant impact 20 + confidence **10 (deliberately low)**                                                                             |
| Uncertainty      | Template states "may be frost-sensitive" and attributes the reading to a forecast                                                                                     |
| Fixtures         | `weather-frost-watch.fixtures.ts`, 4 scenarios: fresh-frost fire with window-at-forecast-moment, stale-forecast skip, passed-moment skip, no-frost skip               |
| Review questions | Is 0 °C the right threshold (radiation frost can strike above it)? Is the stage list right? Is refusing stale forecasts the right elevated-risk posture?              |
| Status           | **Awaiting horticultural review**                                                                                                                                     |

### 5.5 `seasonal.sowing-window-check` v1 — ordinary care

| Field            | Value                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category  | `ordinary_care` / `sowing`; urgency `normal`                                                                                                                                                                                |
| Recommends       | Names which accepted sow-indoors/sow-outdoors/transplant window a taxon is within or approaching, for the garden's own hemisphere                                                                                           |
| Trigger          | Today falls within, or within `approachWindowDays` (14) of, a window the GARDEN HAS ACCEPTED for the plant's own taxon (see 5.8); the whole rule skips on an unknown hemisphere                                             |
| Eligible plants  | Active, with a known taxon whose accepted seasonal fact configures at least one window                                                                                                                                      |
| Timing           | 14-day validity window, 14-day recurrence interval; no weather                                                                                                                                                              |
| Month wraparound | A window like November–February is handled correctly (`monthInRange`/`daysUntilNextMonthStart`, `rule-support.ts`), unit-tested directly and via a dedicated fixture                                                        |
| Priority         | 60: urgency 15 + seasonal constraint 20 + plant impact 10 + confidence 15 (reviewed fact)                                                                                                                                   |
| Fixtures         | `seasonal-sowing-window-check.fixtures.ts`, 7 scenarios: within-window fire, approaching-window fire, month-wraparound fire, hemisphere-unknown skip, unreviewed-fact skip, no-windows-configured skip, outside-window skip |
| Review questions | Is a 14-day approach horizon sensible? Is the sow-indoors/sow-outdoors/transplant priority order right when several windows overlap?                                                                                        |
| Status           | **Awaiting horticultural review**                                                                                                                                                                                           |

### 5.6 `succession.replanting-reminder` v1 — ordinary care

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category   | `ordinary_care` / `succession_planting`; urgency `normal`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Recommends        | Reminds the gardener to sow another batch for a taxon with an accepted `successionIntervalDays`, quoting the real configured interval                                                                                                                                                                                                                                                                                                                     |
| Trigger           | Active plant with a known taxon whose accepted seasonal fact configures `successionIntervalDays`; the whole rule skips on an unknown hemisphere                                                                                                                                                                                                                                                                                                           |
| Recurrence design | The engine's own `timing.recurrenceIntervalMs` mechanism is reused (not a new one), but that field is ONE static value per rule version, while `successionIntervalDays` genuinely varies per taxon — see the rule file's own header for the full reasoning. Resolution: `recurrenceIntervalDaysFallback` (21 days) is a garden-wide placeholder spacing value; the real per-taxon number is always quoted honestly in evidence and explanation regardless |
| Timing            | 10-day validity window, 21-day recurrence interval (fallback, see above); no weather                                                                                                                                                                                                                                                                                                                                                                      |
| Priority          | 60: urgency 15 + seasonal constraint 20 + plant impact 10 + confidence 15 (reviewed fact)                                                                                                                                                                                                                                                                                                                                                                 |
| Fixtures          | `succession-replanting-reminder.fixtures.ts`, 6 scenarios: fire, recurrence-suppressed re-fire, fallback-elapsed re-fire, hemisphere-unknown skip, unreviewed-fact skip, no-interval-configured skip                                                                                                                                                                                                                                                      |
| Review questions  | Is 21 days an acceptable garden-wide fallback cadence given the real interval is always shown to the user? Should a later stage add a per-target recurrence override to the engine instead?                                                                                                                                                                                                                                                               |
| Status            | **Awaiting horticultural review**                                                                                                                                                                                                                                                                                                                                                                                                                         |

### 5.7 `rotation.crop-rotation-caution` v1 — ordinary care

| Field               | Value                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier / category     | `ordinary_care` / `crop_rotation`; urgency `normal`                                                                                                                                                                                   |
| Recommends          | Warns when a plant's own bed most recently grew the SAME botanical family within the taxon's own accepted `rotationRestSeasons` — never a disease diagnosis, only the prior family and elapsed days                                   |
| Trigger             | Active, placed plant with known family, a configured `rotationRestSeasons`, and a known departed prior bed occupant of the SAME family within the rest period; the whole rule skips on an unknown hemisphere                          |
| Season length       | One rotation "season" = 365 days (`rotationSeasonDays`) — this codebase has no other season-boundary concept; the rule file's own header explains why one year is the conservative reading (a shorter season would under-warn)        |
| Bed-occupancy input | `PriorBedOccupantFact` (`gather-seasonal-facts.ts`), derived from `BedOccupancyHistoryReader` inside the SAME transaction as the rest of fact-gathering — unit-tested directly in `gather-seasonal-facts.test.ts`                     |
| Timing              | 21-day validity window, 30-day recurrence interval; no weather                                                                                                                                                                        |
| Priority            | 65: urgency 15 + seasonal constraint 20 + plant impact 15 + confidence 15 (bed history + reviewed fact)                                                                                                                               |
| Fixtures            | `crop-rotation-caution.fixtures.ts`, 8 scenarios: fire, rest-period-elapsed skip, different-family skip, no-known-prior-occupant skip, not-placed skip, no-rest-period-configured skip, hemisphere-unknown skip, unreviewed-fact skip |
| Review questions    | Is one season == one year the right reading? Is 730 days (2 seasons) a sensible DEFAULT rest period for the fixture's own Solanaceae example, and is the caution itself (vs. a stronger warning) the right posture?                   |
| Status              | **Awaiting horticultural review**                                                                                                                                                                                                     |

### 5.8 Who accepts seasonal timing, and what that changes here

Amended August 7, 2026, together with ADR-0013's own amendment; the three rules in 5.5-5.7 all
depend on it.

Those rules read seasonal timing only when **the garden itself has accepted it**, recorded in
`garden_seasonal_fact_acceptance` and gated by the `editGardenContent` capability — the garden's
own owner or editor, never a viewer. Timing no acceptance row matches is invisible to the engine:
the rule-facing read is an inner join, so there is no query shape that hands an unaccepted fact to
a rule.

**What this replaced, and why.** The gate used to be a single global `horticulturally_reviewed`
status set by a named horticulturist from `PLANT_REVIEWER_EMAILS`. That allowlist was never passed
to the deployed service, so it was empty, nothing could ever be promoted, and all three rules were
silent in every garden, permanently. The stricter-looking control was an unoperable one.

**Why per garden rather than simply widening who may set the global status.**
`taxonomy_seasonal_fact` has no `garden_id` — a row is the timing for a taxon in a hemisphere,
shared by every garden. Letting a gardener set the global status would have published their
judgment into everyone else's gardens, which is the exact authority the horticulturist gate existed
to withhold. Keying the decision by garden keeps the content single and shared while confining the
consequence to the garden that chose it.

**What a reviewer of THIS catalog still owns.** Everything in 5.5-5.7 other than the source of the
timing values: the thresholds, the approach horizon, the fallback cadence, the season length, and
the priority arithmetic. Those are rule content, still `awaiting_horticultural_review`, and no
gardener's acceptance touches them. Acceptance decides whether a taxon's months are used at all;
it does not confirm that 14 days is the right approach horizon.

**What a gardener's acceptance is worth.** A gardener is not a horticulturist. Timing accepted this
way carries an interested amateur's judgment, which the rule surface continues to disclose, and its
consequences stop at their own garden. A horticulturist-reviewed tier remains a pure addition: one
more reason a fact is readable, alongside acceptance.

### 5.9 Cross-rule behavior (reviewed as content, not per rule)

`cross-rule.fixtures.ts`, 3 scenarios: idempotent re-evaluation (live candidates suppress
exact re-generation), suppression by a converted task vs the −15 `task_overlap` penalty for
an undecidable manual task, and the relative priority ordering when three rules fire at
once — frost 95 > watering 80 > observation 40 (harvest 75 sits between). The ordering is
itself a horticultural judgment the reviewer confirms.

## 6. Review procedure

The procedure `services/api/tests/rule-fixtures/README.md` defines, elevated here as the
catalog's own:

1. **Read this catalog top to bottom** — sections 2–4 are the enforced boundary (nothing
   there needs horticultural judgment; it needs verification that the boundary is where
   this document says it is), section 5 is the content under review.
2. **Read the seven rule definitions** in
   `services/api/src/modules/tasks-recommendations/domain/rules/` — each is one file whose
   thresholds sit in a named `parameters` block, whose stage lists are named constants, and
   whose header states what it recommends and what it deliberately does not.
3. **Read each fixture file** in `services/api/tests/rule-fixtures/` top to bottom. For
   each scenario, judge the `reviewNotes` question: given these facts, is this the right
   recommendation (or the right silence), at a sensible priority, with an honest
   explanation? The runner (`rule-fixtures.test.ts`) proves each scenario's complete
   expected output with deep equality and re-runs it to prove determinism.
4. **Ask for changes** by pointing at the fixture and the parameter or condition you
   disagree with. Any content change ships as a **new rule version** (section 7).
5. **The AI-explanation harness** (`services/api/tests/ai-explanation-fixtures/`, its own
   README) is a separate, additional review with its own residual: lexicons are finite, so
   spelled-out numerals and unlisted action phrasings pass undetected — its human
   evaluation pass over REAL model outputs is a release gate for live Vertex enablement,
   not for the rule catalog.

## 7. Sign-off protocol

**Approval** edits each approved rule's `review` metadata — the `RuleReviewMetadata` type
in `domain/rule-definition.ts` — from

```ts
review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' }
```

(or `awaitingReviewBy: 'P9D-SEASON-RULES-01'` for one of the three seasonal rules — the
type's own widened literal union names both real work packages, never a placeholder) to

```ts
review: { reviewStatus: 'horticulturally_reviewed', reviewedBy: '<name>', reviewedOn: 'YYYY-MM-DD' }
```

and updates `launch-rule-catalog.test.ts`'s review-marking assertion to the reviewed
metadata. This edit is deliberately **outside** the pinned content hash: approval blesses
content as it stands and must not force a version bump.

**Rejection of any content** — a threshold, a stage list, a cadence, a template, a
weather posture — means a **new rule version**: the content hashes pinned in
`launch-rule-catalog.test.ts` make an in-place edit a CI failure by design. The new version
is appended to the catalog (`domain/rules/launch-rule-catalog.ts`), its fixtures are
updated alongside, its hash is added, and the old version stays in the catalog forever
(stored candidates pin it for explanation replay). The database registrar refuses a stored
row whose tier disagrees with the definition, closing the same discipline at runtime.

**What approval does NOT unlock by itself:** live Vertex AI enablement additionally
requires the AI harness's human evaluation pass and a model choice (see
[deferred-capabilities.md](deferred-capabilities.md), the P7-AI-01 entry).

## 8. Honest state

- Structural exclusions and constraints (sections 2–4): **enforced and CI-pinned today**,
  including the rule-layer/AI-lexicon alignment test
  (`domain/ai-explanation-lexicon.test.ts`).
- This catalog, the ledger, and the procedure: **complete**.
- The horticultural sign-off itself: **open** — it requires a named human reviewer, and no
  agent or engineer can self-satisfy it. Until it lands, every launch rule says so in its
  own metadata and CI keeps it said.
