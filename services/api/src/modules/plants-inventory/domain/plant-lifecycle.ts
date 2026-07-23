/**
 * `lifecycleStage` and `status` transitions — split out of `plant.ts` the
 * same way gardens-mapping splits `map-object-lifecycle.ts` out of
 * `map-object.ts`.
 *
 * Unlike `transitionMapObjectLifecycle` (a binary `active`/`deleted` toggle
 * that rejects transitioning to the state already held), neither transition
 * here rejects any target: "No hard state-machine ordering is enforced (any
 * of the 8 stages is reachable from any other — the requirements explicitly
 * do not mandate a strict progression)" for `lifecycleStage`, and `status` is
 * the orthogonal axis governing active/dormant/archived/removed/dead with no
 * ordering requirement stated either — this is also how "delete a plant" is
 * modeled: there is no hard-delete command, only a transition to `'removed'`
 * or `'dead'`. A transition to the value already held is accepted rather than
 * rejected: it is a legitimate (if inert) command a caller may issue, and
 * idempotent retries are already handled at the idempotency-key layer, not
 * by rejecting a semantically valid no-op here.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * comment on `plants_inventory.plant`.
 */

import type { Plant } from './plant.js';

export type LifecycleStage =
  | 'planned'
  | 'seed'
  | 'seedling'
  | 'transplanted'
  | 'growing'
  | 'flowering'
  | 'fruiting'
  | 'ready_to_harvest';

export type PlantStatus = 'active' | 'dormant' | 'archived' | 'removed' | 'dead';

export function transitionPlantLifecycleStage(
  plant: Plant,
  targetStage: LifecycleStage,
  now: Date,
): Plant {
  return { ...plant, lifecycleStage: targetStage, revision: plant.revision + 1, updatedAt: now };
}

export function setPlantStatus(plant: Plant, targetStatus: PlantStatus, now: Date): Plant {
  return { ...plant, status: targetStatus, revision: plant.revision + 1, updatedAt: now };
}
