/**
 * `GET /gardens/{gardenId}/seasonal-plan` (P9D-SEASON-API-01, Stage 3 of
 * P9D-SEASON-01) — a garden-wide, forward-looking structured read, distinct
 * from the rule-fired Today/Recommendations pipeline: every reviewed
 * seasonal timing fact for the garden's own plants (every configured
 * window, not only whichever one happens to be open right now), plus the
 * CONTINUOUS bed-rotation state per placed plant with a known family.
 *
 * OWNING MODULE: `tasks-recommendations`, not `gardens-mapping`. This read
 * needs `gardens-mapping`'s `GeoreferenceRepository`/`GardenAuthorization`
 * AND `plants-inventory`'s `PlantRepository`/`TaxonomyReferenceRepository`/
 * `TaxonomySeasonalFactRepository`/`BedOccupancyHistoryReader` in the same
 * call. Checked before deciding: `gardens-mapping` never imports from
 * `plants-inventory` anywhere in this codebase (only the reverse), so
 * putting this route in `gardens-mapping` would be a NEW, circular edge
 * (`plants-inventory` already imports `gardens-mapping`'s `GardenAuthorization`/
 * `MapObjectRepository` throughout its application layer). `tasks-recommendations`
 * already imports from BOTH sibling modules today (see
 * `tasks-recommendations-unit-of-work.ts`'s own header) with no dependency
 * arrow pointing back at it from either — the same acyclic shape
 * `EvaluateGardenRecommendations` already relies on. Choosing
 * `tasks-recommendations` also means `gatherTaxonomyFacts`/
 * `gatherPriorBedOccupants` (`gather-seasonal-facts.ts`) are a same-module
 * import, not a new cross-module export surface.
 *
 * REUSE, NOT RE-DERIVATION: this class calls `gatherTaxonomyFacts`/
 * `gatherPriorBedOccupants` directly — the exact functions
 * `EvaluateGardenRecommendations` uses to assemble `GardenFacts.taxonomyFacts`/
 * `priorBedOccupants` inside its own transaction (P9D-SEASON-RULES-01).
 * Those functions' `context` parameter is typed as `SeasonalFactGatheringPorts`
 * (a narrow `Pick` of `TasksRecommendationsTransactionContext`, added by this
 * package — see that type's own header) precisely so a plain, non-transactional
 * read path like this one can supply just the three ports it actually has,
 * without constructing fakes for a dozen unrelated transactional ports
 * (`tasks`, `media`, `outbox`, `idempotency`, ...) a read never touches. This
 * is option (a) from this package's own brief: call the same functions
 * directly, wiring a lightweight non-transactional read path — never a
 * second copy of their query logic.
 *
 * NON-TRANSACTIONAL BY DESIGN: unlike `EvaluateGardenRecommendations`, this
 * is a plain HTTP GET with no writes and no evidence rows that must stay
 * snapshot-consistent with anything — every repository here is bound to the
 * ordinary pooled connection (`compose-tasks-recommendations.ts`), the same
 * "read paths use the pooled connection directly" posture `GetGardenMap`/
 * `ListGardenContextFacts` already take for their own multi-port garden
 * reads.
 *
 * CONTINUOUS ROTATION STATUS, NOT A GATED FIRE: `crop-rotation-caution`
 * only ever answers "would this rule fire right now" (gated by its own
 * `validityWindowDays`/`recurrenceIntervalMs` re-fire cadence — irrelevant
 * to a plain state read). `rotationStatus` below instead reports the state
 * for EVERY plant `gatherPriorBedOccupants` populates — placed, with a
 * known own family — including the "no known conflict" (no departed
 * occupant, or a different-family one) and "no configured rest period"
 * cases, mirroring the taxonomy section's own "never silently omit" posture
 * rather than only surfacing plants that would currently justify a
 * recommendation. `wholeDaysBetween` (`rule-support.ts`) and
 * `ROTATION_SEASON_DAYS` (`crop-rotation-caution.ts`) are imported, not
 * reimplemented, so the elapsed-days math and the `rotationRestSeasons ->
 * days` threshold are always identical to the rule's own.
 *
 * ACTIVE PLANTS ONLY (a genuine ambiguity this stage's own brief leaves
 * unresolved, resolved conservatively): `loadActivePlants` filters
 * `status: ['active']` at the query level. Neither Stage 2 rule this stage
 * reuses logic from ever evaluates a non-active plant either
 * (`evaluatePlant`'s own first check in both `seasonal-sowing-window-check.ts`
 * and `crop-rotation-caution.ts` is `plant.status !== 'active'`) — an
 * archived, removed, or dead plant needs no seasonal plan entry. This is the
 * most conservative, most consistent-with-existing-pattern reading: it never
 * fabricates seasonal relevance for a plant the rule engine itself would
 * already skip.
 *
 * HEMISPHERE: `hemisphere: Hemisphere | null` alone (no separate
 * `hemisphereUnknown` boolean) satisfies the brief's own "(or equivalent)"
 * — `null` IS "this garden has never been georeferenced", the same meaning
 * `GardenFacts.hemisphere`/`deriveHemisphere` already give it everywhere
 * else in this codebase. A second boolean that must always agree with this
 * field's own nullability would be exactly the kind of duplicated,
 * drift-prone fact this package's own "single source of truth" discipline
 * argues against.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization, GeoreferenceRepository } from '../../gardens-mapping/public.js';
import type {
  BedOccupancyHistoryReader,
  PlantRepository,
  TaxonomyReferenceRepository,
  TaxonomySeasonalFact,
  TaxonomySeasonalFactRepository,
} from '../../plants-inventory/public.js';
import type {
  Hemisphere,
  PlantFact,
  PriorBedOccupantFact,
  TaxonomyFact,
} from '../domain/garden-facts.js';
import { deriveHemisphere } from '../domain/garden-facts.js';
import { ROTATION_SEASON_DAYS } from '../domain/rules/crop-rotation-caution.js';
import { wholeDaysBetween } from '../domain/rules/rule-support.js';
import { gatherPriorBedOccupants, gatherTaxonomyFacts } from './gather-seasonal-facts.js';
import type { SeasonalFactGatheringPorts } from './gather-seasonal-facts.js';

/** Page size for the plant scan — plumbing, matching `EvaluateGardenRecommendations`' own `PLANT_PAGE_SIZE`, not a tuning knob. */
const PLANT_PAGE_SIZE = 200;

/** Every timing/duration column a reviewed seasonal fact carries — mirrors `TaxonomySeasonalTiming` (`plants-inventory/domain/taxonomy-seasonal-fact.ts`) field for field, all nullable for the identical reason: a crop with no transplant stage must be representable without a fabricated window. */
export interface SeasonalPlanTiming {
  readonly sowIndoorsStartMonth: number | null;
  readonly sowIndoorsEndMonth: number | null;
  readonly sowOutdoorsStartMonth: number | null;
  readonly sowOutdoorsEndMonth: number | null;
  readonly transplantStartMonth: number | null;
  readonly transplantEndMonth: number | null;
  readonly harvestStartMonth: number | null;
  readonly harvestEndMonth: number | null;
  readonly daysToMaturityMin: number | null;
  readonly daysToMaturityMax: number | null;
  readonly successionIntervalDays: number | null;
  readonly rotationRestSeasons: number | null;
}

/** `status` is the explicit "no seasonal data" marker the brief asks for — present whether the plant's taxon is entirely unknown or simply has no `horticulturally_reviewed` fact for this garden's hemisphere; both collapse to the same honest "nothing configured" outcome a client can render identically. */
export type SeasonalPlanTaxonomyStatus =
  | { readonly status: 'reviewed'; readonly timing: SeasonalPlanTiming }
  | { readonly status: 'noSeasonalData' };

export interface SeasonalPlanPlantEntry {
  readonly plantId: Uuid;
  readonly taxonomyReferenceId: Uuid | null;
  readonly seasonalFact: SeasonalPlanTaxonomyStatus;
}

/**
 * One placed plant's continuous bed-rotation state — see this file's own
 * header, "CONTINUOUS ROTATION STATUS". Modeled after
 * `crop-rotation-caution.ts`'s own `bed.rotation_conflict` evidence
 * `factValue` shape (`family`, `priorFamily`, `rotationRestSeasons`,
 * `priorOccupancyEndedAt`, `elapsedDays`) for consistency, plus the two
 * fields that shape has no reason to carry (a fired recommendation IS
 * already the "within" case): the derived `restPeriodThresholdDays` and the
 * `withinRestPeriod` verdict itself.
 */
export interface SeasonalPlanRotationStatusEntry {
  readonly plantId: Uuid;
  readonly gardenAreaMapObjectId: Uuid;
  readonly family: string;
  /** `null` = no departed occupant is known within the lookback window, or the departed occupant's own family is unknown — "no known conflict" (`PriorBedOccupantFact`'s own doc comment). */
  readonly priorFamily: string | null;
  readonly priorOccupancyEndedAt: Date | null;
  /** `null` exactly when `priorOccupancyEndedAt` is `null`. */
  readonly elapsedDays: number | null;
  /** `null` = this taxon has no reviewed seasonal fact for this hemisphere, or the fact configures no rest period — "no known conflict threshold" (`crop-rotation-caution.ts`'s own skip reason), not a fabricated `0`. */
  readonly rotationRestSeasons: number | null;
  /** `rotationRestSeasons * ROTATION_SEASON_DAYS`; `null` exactly when `rotationRestSeasons` is `null`. */
  readonly restPeriodThresholdDays: number | null;
  /** `true` only when `priorFamily` matches `family` AND a threshold is configured AND `elapsedDays` is still below it — `false` in every other case (no conflict, no threshold, or already elapsed), never a third state. */
  readonly withinRestPeriod: boolean;
}

export interface GardenSeasonalPlan {
  readonly gardenId: Uuid;
  readonly hemisphere: Hemisphere | null;
  readonly plants: readonly SeasonalPlanPlantEntry[];
  readonly rotationStatus: readonly SeasonalPlanRotationStatusEntry[];
}

function findTaxonomyFact(
  taxonomyFacts: readonly TaxonomyFact[],
  taxonomyReferenceId: Uuid,
): TaxonomyFact | null {
  return taxonomyFacts.find((fact) => fact.taxonomyReferenceId === taxonomyReferenceId) ?? null;
}

function toSeasonalPlanTiming(fact: TaxonomySeasonalFact): SeasonalPlanTiming {
  return {
    sowIndoorsStartMonth: fact.sowIndoorsStartMonth,
    sowIndoorsEndMonth: fact.sowIndoorsEndMonth,
    sowOutdoorsStartMonth: fact.sowOutdoorsStartMonth,
    sowOutdoorsEndMonth: fact.sowOutdoorsEndMonth,
    transplantStartMonth: fact.transplantStartMonth,
    transplantEndMonth: fact.transplantEndMonth,
    harvestStartMonth: fact.harvestStartMonth,
    harvestEndMonth: fact.harvestEndMonth,
    daysToMaturityMin: fact.daysToMaturityMin,
    daysToMaturityMax: fact.daysToMaturityMax,
    successionIntervalDays: fact.successionIntervalDays,
    rotationRestSeasons: fact.rotationRestSeasons,
  };
}

function toSeasonalPlanPlantEntry(
  plant: PlantFact,
  taxonomyFacts: readonly TaxonomyFact[],
): SeasonalPlanPlantEntry {
  const taxonomyFact =
    plant.taxonomyReferenceId === null
      ? null
      : findTaxonomyFact(taxonomyFacts, plant.taxonomyReferenceId);
  const seasonalFact: SeasonalPlanTaxonomyStatus =
    taxonomyFact === null || taxonomyFact.seasonalFact === null
      ? { status: 'noSeasonalData' }
      : { status: 'reviewed', timing: toSeasonalPlanTiming(taxonomyFact.seasonalFact) };

  return { plantId: plant.plantId, taxonomyReferenceId: plant.taxonomyReferenceId, seasonalFact };
}

function toRotationStatusEntry(
  plant: PlantFact,
  occupant: PriorBedOccupantFact,
  taxonomyFacts: readonly TaxonomyFact[],
  now: Date,
): SeasonalPlanRotationStatusEntry | null {
  // Structurally unreachable: `gatherPriorBedOccupants` only ever produces
  // an entry for a plant with a known `taxonomyReferenceId` whose taxon
  // resolves to a known family — see that function's own doc comment. Kept
  // as an honest typed skip rather than a non-null assertion, the same
  // posture `crop-rotation-caution.ts`'s own
  // `bed.prior_occupant_departure_unknown` branch takes.
  const taxonomyFact =
    plant.taxonomyReferenceId === null
      ? null
      : findTaxonomyFact(taxonomyFacts, plant.taxonomyReferenceId);
  const family = taxonomyFact?.family ?? null;
  if (family === null) {
    return null;
  }

  const rotationRestSeasons = taxonomyFact?.seasonalFact?.rotationRestSeasons ?? null;
  const restPeriodThresholdDays =
    rotationRestSeasons === null ? null : rotationRestSeasons * ROTATION_SEASON_DAYS;
  const elapsedDays =
    occupant.priorOccupancyEndedAt === null
      ? null
      : wholeDaysBetween(occupant.priorOccupancyEndedAt, now);
  const withinRestPeriod =
    occupant.priorFamily !== null &&
    occupant.priorFamily === family &&
    restPeriodThresholdDays !== null &&
    elapsedDays !== null &&
    elapsedDays < restPeriodThresholdDays;

  return {
    plantId: plant.plantId,
    gardenAreaMapObjectId: occupant.gardenAreaMapObjectId,
    family,
    priorFamily: occupant.priorFamily,
    priorOccupancyEndedAt: occupant.priorOccupancyEndedAt,
    elapsedDays,
    rotationRestSeasons,
    restPeriodThresholdDays,
    withinRestPeriod,
  };
}

export class GetGardenSeasonalPlan {
  constructor(
    private readonly authorization: GardenAuthorization,
    private readonly plants: PlantRepository,
    private readonly taxonomyReferences: TaxonomyReferenceRepository,
    private readonly taxonomySeasonalFacts: TaxonomySeasonalFactRepository,
    private readonly bedOccupancyHistory: BedOccupancyHistoryReader,
    private readonly georeferences: GeoreferenceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<GardenSeasonalPlan> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const georeference = await this.georeferences.findCurrentForGarden(gardenId);
    const hemisphere = deriveHemisphere(georeference?.geographicAnchor ?? null);
    const now = this.clock.now();

    const plants = await this.loadActivePlants(gardenId);
    const ports: SeasonalFactGatheringPorts = {
      taxonomyReferences: this.taxonomyReferences,
      taxonomySeasonalFacts: this.taxonomySeasonalFacts,
      bedOccupancyHistory: this.bedOccupancyHistory,
    };
    const taxonomyFacts = await gatherTaxonomyFacts(ports, plants, hemisphere);
    const priorBedOccupants = await gatherPriorBedOccupants(ports, plants, taxonomyFacts, now);

    const plantsById = new Map(plants.map((plant) => [plant.plantId, plant]));
    const rotationStatus: SeasonalPlanRotationStatusEntry[] = [];
    for (const occupant of priorBedOccupants) {
      const plant = plantsById.get(occupant.plantId);
      if (plant === undefined) {
        continue;
      }
      const entry = toRotationStatusEntry(plant, occupant, taxonomyFacts, now);
      if (entry !== null) {
        rotationStatus.push(entry);
      }
    }

    return {
      gardenId,
      hemisphere,
      plants: plants.map((plant) => toSeasonalPlanPlantEntry(plant, taxonomyFacts)),
      rotationStatus,
    };
  }

  /** Every ACTIVE plant in the garden, id-ordered — see this file's own header, "ACTIVE PLANTS ONLY". Mirrors `evaluate-garden-recommendations.ts`'s own `gatherGardenFacts` plant-paging loop, minus the fields (observations, open tasks) this read does not need. */
  private async loadActivePlants(gardenId: Uuid): Promise<PlantFact[]> {
    const plants: PlantFact[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.plants.search(
        gardenId,
        { query: null, lifecycleStage: null, status: ['active'], groupingKind: null },
        cursor,
        PLANT_PAGE_SIZE,
      );
      for (const plant of page.items) {
        plants.push({
          plantId: plant.id,
          displayName: plant.displayName,
          lifecycleStage: plant.lifecycleStage,
          status: plant.status,
          createdAt: plant.createdAt,
          taxonomyReferenceId: plant.taxonomyReferenceId,
          gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
        });
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    plants.sort((a, b) => a.plantId.localeCompare(b.plantId));
    return plants;
  }
}
