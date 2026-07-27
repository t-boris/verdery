/**
 * P9D-SEASON-RULES-01's own fact-gathering helpers, split out of
 * `evaluate-garden-recommendations.ts` (which stays the transactional
 * shell) purely to keep that file under the repository's 600-line source
 * limit — the same "factor shared logic into its own file" discipline
 * `domain/rules/rule-support.ts` already applies one layer down.
 *
 * Both functions run INSIDE `EvaluateGardenRecommendations`'s own
 * transaction, over the `TasksRecommendationsTransactionContext` ports
 * `plants-inventory` exports (`taxonomyReferences`, `taxonomySeasonalFacts`,
 * `bedOccupancyHistory`) — see that context interface's own header for why
 * this in-transaction shape was chosen over weather/hemisphere's
 * pre-transaction fetch-then-thread shape.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  Hemisphere,
  PlantFact,
  PriorBedOccupantFact,
  TaxonomyFact,
} from '../domain/garden-facts.js';
import type { TasksRecommendationsTransactionContext } from './tasks-recommendations-unit-of-work.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed lookback window for the bed-occupancy rotation query, generous
 * enough to never truncate a real answer: ten years comfortably exceeds
 * any realistic `rotationRestSeasons` value a horticultural reviewer would
 * configure (the column is an unbounded positive integer, but real
 * crop-rotation guidance rarely asks for more than a handful of years'
 * rest). This is application-layer PLUMBING, not a horticultural
 * threshold: the ACTUAL rest-period comparison against a taxon's own
 * `rotationRestSeasons` is `crop-rotation-caution`'s own job, over the raw
 * `PriorBedOccupantFact` this constant only bounds the query for. Widening
 * it costs one extra query parameter, never a behavior change, so it is
 * not exposed as a rule `parameters` value.
 */
const BED_ROTATION_LOOKBACK_DAYS = 10 * 365;

/**
 * One `TaxonomyFact` per DISTINCT `taxonomyReferenceId` this garden's own
 * plants actually carry (never a catalog-wide dump) — family from
 * `TaxonomyReferenceRepository.findById`, plus the garden's own
 * `hemisphere`'s reviewed seasonal fact when a hemisphere is known at all.
 * `hemisphere === null` still resolves family for every taxon (a plant's
 * own identity does not depend on the garden ever having been
 * georeferenced); it only leaves every `seasonalFact` `null` — the three
 * seasonal rules' own whole-rule skip on a `null` hemisphere is what
 * actually enforces "never fabricate a window for an ungeoreferenced
 * garden", not an early return here.
 */
export async function gatherTaxonomyFacts(
  context: TasksRecommendationsTransactionContext,
  plants: readonly PlantFact[],
  hemisphere: Hemisphere | null,
): Promise<TaxonomyFact[]> {
  const distinctTaxonomyIds = [
    ...new Set(
      plants.map((plant) => plant.taxonomyReferenceId).filter((id): id is Uuid => id !== null),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const taxonomyFacts: TaxonomyFact[] = [];
  for (const taxonomyReferenceId of distinctTaxonomyIds) {
    const reference = await context.taxonomyReferences.findById(taxonomyReferenceId);
    const seasonalFact =
      hemisphere === null
        ? null
        : await context.taxonomySeasonalFacts.findReviewedForTaxonomyAndHemisphere(
            taxonomyReferenceId,
            hemisphere,
          );
    taxonomyFacts.push({ taxonomyReferenceId, family: reference?.family ?? null, seasonalFact });
  }
  return taxonomyFacts;
}

/**
 * One `PriorBedOccupantFact` per plant that has BOTH a known bed placement
 * AND a known own family (via `taxonomyFacts`, already gathered) — see
 * `PriorBedOccupantFact`'s own doc comment for why both gates apply and
 * what the two null-together fields mean. For each such plant, the most
 * recently DEPARTED (non-self, `occupiedUntil` at or before `evaluatedAt`)
 * segment `BedOccupancyHistoryReader.findForBed` returns within
 * `BED_ROTATION_LOOKBACK_DAYS` is this plant's answer; a departed
 * occupant's own family is resolved through a small local cache (seeded
 * from `taxonomyFacts`) so a historical taxon shared by several beds or
 * plants is looked up at most once.
 */
export async function gatherPriorBedOccupants(
  context: TasksRecommendationsTransactionContext,
  plants: readonly PlantFact[],
  taxonomyFacts: readonly TaxonomyFact[],
  evaluatedAt: Date,
): Promise<PriorBedOccupantFact[]> {
  const familyCache = new Map<Uuid, string | null>(
    taxonomyFacts.map((fact) => [fact.taxonomyReferenceId, fact.family]),
  );
  async function resolveFamily(taxonomyReferenceId: Uuid): Promise<string | null> {
    const cached = familyCache.get(taxonomyReferenceId);
    if (cached !== undefined) {
      return cached;
    }
    const reference = await context.taxonomyReferences.findById(taxonomyReferenceId);
    const family = reference?.family ?? null;
    familyCache.set(taxonomyReferenceId, family);
    return family;
  }

  const intervalStart = new Date(evaluatedAt.getTime() - BED_ROTATION_LOOKBACK_DAYS * DAY_MS);
  const priorBedOccupants: PriorBedOccupantFact[] = [];
  for (const plant of plants) {
    if (plant.gardenAreaMapObjectId === null) {
      continue;
    }
    const ownFamily =
      plant.taxonomyReferenceId === null ? null : familyCache.get(plant.taxonomyReferenceId);
    if (ownFamily === null || ownFamily === undefined) {
      continue;
    }

    const segments = await context.bedOccupancyHistory.findForBed(
      plant.gardenAreaMapObjectId,
      intervalStart,
      evaluatedAt,
    );
    // The departed (non-self) segment with the latest `occupiedUntil` at or
    // before `evaluatedAt` — "most recently held" — tracked alongside its
    // own resolved departure time so no later null-check is needed.
    let latestDepartureTaxonomyId: Uuid | null = null;
    let latestDepartureAt: Date | null = null;
    for (const segment of segments) {
      if (
        segment.plantId === plant.plantId ||
        segment.occupiedUntil === null ||
        segment.occupiedUntil.getTime() > evaluatedAt.getTime()
      ) {
        continue;
      }
      if (
        latestDepartureAt === null ||
        segment.occupiedUntil.getTime() > latestDepartureAt.getTime()
      ) {
        latestDepartureAt = segment.occupiedUntil;
        latestDepartureTaxonomyId = segment.taxonomyReferenceId;
      }
    }

    priorBedOccupants.push({
      plantId: plant.plantId,
      gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
      priorFamily:
        latestDepartureTaxonomyId === null ? null : await resolveFamily(latestDepartureTaxonomyId),
      priorOccupancyEndedAt: latestDepartureAt,
    });
  }
  return priorBedOccupants;
}
