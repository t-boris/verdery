/**
 * Maps `GardenSeasonalPlan` (`get-garden-seasonal-plan.ts`) to the contract's
 * `SeasonalPlanResult` resource — the same "domain to wire" split
 * `garden-context-fact-view.ts`'s `toGardenContextFactResource` already
 * establishes: the mapping's return type is annotated against the actual
 * generated contract type, not a hand-rolled duplicate, so a schema/mapping
 * drift is a compiler error here, not a runtime surprise.
 */

import type {
  SeasonalPlanPlantEntry as SeasonalPlanPlantEntryResource,
  SeasonalPlanResult,
  SeasonalPlanRotationStatusEntry as SeasonalPlanRotationStatusEntryResource,
  SeasonalPlanTaxonomyStatus as SeasonalPlanTaxonomyStatusResource,
  SeasonalPlanTaxonomyTiming as SeasonalPlanTimingResource,
} from '@verdery/api-contracts';
import type {
  GardenSeasonalPlan,
  SeasonalPlanPlantEntry,
  SeasonalPlanRotationStatusEntry,
  SeasonalPlanTaxonomyStatus,
  SeasonalPlanTiming,
} from './get-garden-seasonal-plan.js';

function toTimingResource(timing: SeasonalPlanTiming): SeasonalPlanTimingResource {
  return { ...timing };
}

function toTaxonomyStatusResource(
  status: SeasonalPlanTaxonomyStatus,
): SeasonalPlanTaxonomyStatusResource {
  return status.status === 'reviewed'
    ? { status: 'reviewed', timing: toTimingResource(status.timing) }
    : { status: 'noSeasonalData' };
}

function toPlantEntryResource(entry: SeasonalPlanPlantEntry): SeasonalPlanPlantEntryResource {
  return {
    plantId: entry.plantId,
    taxonomyReferenceId: entry.taxonomyReferenceId,
    seasonalFact: toTaxonomyStatusResource(entry.seasonalFact),
  };
}

function toRotationStatusEntryResource(
  entry: SeasonalPlanRotationStatusEntry,
): SeasonalPlanRotationStatusEntryResource {
  return {
    plantId: entry.plantId,
    gardenAreaMapObjectId: entry.gardenAreaMapObjectId,
    family: entry.family,
    priorFamily: entry.priorFamily,
    priorOccupancyEndedAt: entry.priorOccupancyEndedAt?.toISOString() ?? null,
    elapsedDays: entry.elapsedDays,
    rotationRestSeasons: entry.rotationRestSeasons,
    restPeriodThresholdDays: entry.restPeriodThresholdDays,
    withinRestPeriod: entry.withinRestPeriod,
  };
}

export function toGardenSeasonalPlanResource(plan: GardenSeasonalPlan): SeasonalPlanResult {
  return {
    gardenId: plan.gardenId,
    hemisphere: plan.hemisphere,
    plants: plan.plants.map(toPlantEntryResource),
    rotationStatus: plan.rotationStatus.map(toRotationStatusEntryResource),
  };
}
