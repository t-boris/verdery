/**
 * Port for selecting which gardens the scheduled recommendation sweep
 * (P7-ASYNC-01) evaluates.
 *
 * ELIGIBILITY, decided from what the launch catalog can actually do rather
 * than invented: a garden is eligible when it is `active` (an archived or
 * deletion-requested garden is out of ordinary care — no rule should nag
 * it) AND holds at least one plant with `status = 'active'` — every launch
 * rule targets plants and every one of them skips a non-active plant
 * (`plant.status_not_active` in all four evaluators), so evaluating a
 * garden without an active plant is provably decision-free work. A garden
 * that later gains its first active plant enters the set on the next sweep
 * with no bookkeeping. Weather/georeference is deliberately NOT a
 * condition: three of the four rules run without weather, and the engine's
 * typed `weatherMissing` skip is the documented degradation, not an
 * exclusion.
 *
 * Keyset-paged by garden id so the sweep drains the WHOLE eligible set each
 * run in bounded pages (see `run-recommendation-evaluation-sweep.ts` for
 * why a per-run cap was rejected here), deterministically ordered.
 *
 * Cross-schema read (gardens-mapping's `garden`, plants-inventory's
 * `plant`), the same narrow-read-port shape
 * `integrations/application/weather-refresh-candidate-source.ts` documents.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface EvaluationGardenSource {
  /**
   * Up to `limit` eligible garden ids with id greater than `afterGardenId`
   * (`null` starts from the beginning), ascending.
   */
  listEligibleGardenIds(afterGardenId: Uuid | null, limit: number): Promise<readonly Uuid[]>;

  /**
   * The same eligible set, narrowed to gardens that are DUE — the read that
   * lets the sweep run every few minutes instead of every few hours.
   *
   * A garden is due when either:
   *
   * - something the engine reads changed since its last evaluation — a
   *   plant, an observation, a task, or a stored weather record; or
   * - its last evaluation is older than `stalenessFloor`, so a purely
   *   time-based rule (the 14-day observation reminder, a forecast window
   *   opening) can still fire with nothing else having happened.
   *
   * A garden never evaluated is always due.
   *
   * WHY THE FLOOR IS NOT OPTIONAL: without it, a garden nobody touches and
   * whose weather stops refreshing would go silent forever, and the rules
   * most likely to matter to a neglected garden are exactly the time-based
   * ones. The floor is what keeps "nothing changed" from meaning "nothing
   * to say".
   */
  listGardenIdsDueForEvaluation(
    afterGardenId: Uuid | null,
    limit: number,
    stalenessFloor: Date,
  ): Promise<readonly Uuid[]>;
}
