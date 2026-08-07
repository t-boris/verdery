/**
 * The launch rule catalog: every rule version this application has
 * shipped, assembled and validated as one `RuleCatalog`.
 *
 * ALL FOUR LAUNCH RULES ARE AWAITING HORTICULTURAL REVIEW (P7-SAFE-01) —
 * each definition says so in its own `review` metadata, and
 * `launch-rule-catalog.test.ts` asserts it stays said until a named
 * reviewer signs off. No agent can perform that review; what IS enforced
 * regardless, structurally, is the safety-tier exclusion: no definition
 * can carry the `'restricted'` tier (the type forbids it) or an excluded
 * content category (`validateRuleDefinition` rejects it), and the
 * database rejects a restricted candidate again at insert.
 *
 * Append-only: a content change ships as a NEW version appended here —
 * see `rule-catalog.ts` for the discipline and its two mechanical guards.
 *
 * `watering.dry-spell-check` v2 appends a second version of the watering
 * rule. v1 decided on a single latest precipitation figure — one
 * provider-defined period, an hour for the selected provider — which cannot
 * tell an hour of calm from a week of drought. v2 decides on rainfall
 * ACCUMULATED over elapsed days and reports the shortfall in millimetres.
 * v1 remains in the catalog, unevaluated but renderable, exactly as the
 * append-only discipline requires.
 *
 * P9D-SEASON-RULES-01 (Stage 2 of P9D-SEASON-01) appends three more rules
 * on top of the original four launch rules — `seasonal.sowing-window
 * -check`, `succession.replanting-reminder`, `rotation.crop-rotation
 * -caution` — each `awaiting_horticultural_review` by that SAME work
 * package (a distinct `awaitingReviewBy` value from the original four's
 * `P7-SAFE-01`, per `RuleReviewMetadata`'s own widened type), consuming
 * `GardenFacts.hemisphere`/`taxonomyFacts`/`priorBedOccupants` — none of
 * which the original four ever read.
 *
 * Source: architecture/recommendations-and-ai.md, sections "5. Rule
 * Engine" and "13. Safety Tiers"; tasks/todo.md, "Phase 7 ... planning",
 * "P9D-SEASON-01 design decisions".
 */

import { RuleCatalog } from '../rule-catalog.js';
import { cropRotationCautionRule } from './crop-rotation-caution.js';
import { lifecycleHarvestReadinessCheckRule } from './lifecycle-harvest-readiness-check.js';
import { observationRoutineCheckReminderRule } from './observation-routine-check-reminder.js';
import { seasonalSowingWindowCheckRule } from './seasonal-sowing-window-check.js';
import { successionReplantingReminderRule } from './succession-replanting-reminder.js';
import { wateringDrySpellCheckRule } from './watering-dry-spell-check.js';
import { wateringDrySpellCheckV2Rule } from './watering-dry-spell-check-v2.js';
import { weatherFrostWatchRule } from './weather-frost-watch.js';

/** Catalog order is evaluation order — deterministic and stable. */
export function createLaunchRuleCatalog(): RuleCatalog {
  return new RuleCatalog([
    // v1 stays shipped forever so a candidate it produced can still render
    // its own explanation; v2 is the higher version, so it is what
    // `activeRules()` evaluates. See `rule-catalog.ts` on the append-only
    // discipline.
    wateringDrySpellCheckRule,
    wateringDrySpellCheckV2Rule,
    observationRoutineCheckReminderRule,
    lifecycleHarvestReadinessCheckRule,
    weatherFrostWatchRule,
    seasonalSowingWindowCheckRule,
    successionReplantingReminderRule,
    cropRotationCautionRule,
  ]);
}
