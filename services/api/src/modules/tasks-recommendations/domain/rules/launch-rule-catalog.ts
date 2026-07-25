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
 * Source: architecture/recommendations-and-ai.md, sections "5. Rule
 * Engine" and "13. Safety Tiers"; tasks/todo.md, "Phase 7 ... planning".
 */

import { RuleCatalog } from '../rule-catalog.js';
import { lifecycleHarvestReadinessCheckRule } from './lifecycle-harvest-readiness-check.js';
import { observationRoutineCheckReminderRule } from './observation-routine-check-reminder.js';
import { wateringDrySpellCheckRule } from './watering-dry-spell-check.js';
import { weatherFrostWatchRule } from './weather-frost-watch.js';

/** Catalog order is evaluation order — deterministic and stable. */
export function createLaunchRuleCatalog(): RuleCatalog {
  return new RuleCatalog([
    wateringDrySpellCheckRule,
    observationRoutineCheckReminderRule,
    lifecycleHarvestReadinessCheckRule,
    weatherFrostWatchRule,
  ]);
}
