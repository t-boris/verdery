/**
 * Unit tests for `GetGardenSeasonalPlan` (P9D-SEASON-API-01), over the same
 * in-memory fakes `gather-seasonal-facts.test.ts` and
 * `evaluate-garden-recommendations.test.ts` already use — proving the
 * response shape (reviewed fact / unknown taxon / no reviewed fact for this
 * hemisphere / hemisphere-unknown / rotation within-vs-clear), the
 * authorization denial, and — the brief's own required proof — that this
 * NON-transactional read path and `gather-seasonal-facts.ts`'s
 * TRANSACTIONAL callers produce IDENTICAL facts for identical fixture data,
 * since both go through the exact same `gatherTaxonomyFacts`/
 * `gatherPriorBedOccupants` functions.
 */

import { describe, expect, it } from 'vitest';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type {
  BedOccupancyPeriod,
  Plant,
  TaxonomyReference,
  TaxonomySeasonalFact,
} from '../../plants-inventory/public.js';
import { GetGardenSeasonalPlan } from './get-garden-seasonal-plan.js';
import { FakeGeoreferenceRepository } from './recommendation-test-doubles.js';
import {
  authorizationDenying,
  authorizationGranting,
  createTasksRecommendationsFakes,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019a2000-0000-7000-8000-000000000001';
const PROFILE_ID = '019a2000-0000-7000-8000-000000000002';
const NOW = new Date('2026-07-25T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const TAXONOMY_REVIEWED_ID = generateUuidV7();
const TAXONOMY_UNREVIEWED_HEMISPHERE_ID = generateUuidV7();
const TAXONOMY_WITHIN_REST_ID = generateUuidV7();
const TAXONOMY_CLEAR_REST_ID = generateUuidV7();

const PLANT_REVIEWED_ID = generateUuidV7();
const PLANT_UNKNOWN_TAXON_ID = generateUuidV7();
const PLANT_UNREVIEWED_HEMISPHERE_ID = generateUuidV7();
const PLANT_WITHIN_REST_ID = generateUuidV7();
const PLANT_CLEAR_REST_ID = generateUuidV7();
const BED_WITHIN_ID = generateUuidV7();
const BED_CLEAR_ID = generateUuidV7();
const PRIOR_OCCUPANT_WITHIN_ID = generateUuidV7();
const PRIOR_OCCUPANT_CLEAR_ID = generateUuidV7();

function taxonomyReference(
  overrides: Partial<TaxonomyReference> & { id: string },
): TaxonomyReference {
  return {
    scientificName: 'Solanum lycopersicum',
    commonName: 'Tomato',
    varietyName: null,
    family: 'Solanaceae',
    genus: 'Solanum',
    source: 'system_catalog',
    createdByProfileId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function seasonalFact(
  overrides: Partial<TaxonomySeasonalFact> & { taxonomyReferenceId: string },
): TaxonomySeasonalFact {
  return {
    id: generateUuidV7(),
    hemisphere: 'northern',
    sowIndoorsStartMonth: 3,
    sowIndoorsEndMonth: 4,
    sowOutdoorsStartMonth: null,
    sowOutdoorsEndMonth: null,
    transplantStartMonth: null,
    transplantEndMonth: null,
    harvestStartMonth: null,
    harvestEndMonth: null,
    daysToMaturityMin: null,
    daysToMaturityMax: null,
    successionIntervalDays: null,
    rotationRestSeasons: null,
    authoringMethod: 'human_authored',
    reviewStatus: 'horticulturally_reviewed',
    reviewedBy: 'Fixture Reviewer',
    reviewedOn: '2026-01-01',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as TaxonomySeasonalFact;
}

function plant(overrides: Partial<Plant> & { id: string }): Plant {
  return {
    gardenId: GARDEN_ID,
    displayName: 'Test plant',
    taxonomyReferenceId: null,
    varietyLabel: null,
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'growing',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId: PROFILE_ID,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function bedPeriod(
  overrides: Partial<BedOccupancyPeriod> & { plantId: string },
): BedOccupancyPeriod {
  return {
    taxonomyReferenceId: null,
    occupiedFrom: new Date('2026-01-01T00:00:00Z'),
    occupiedUntil: null,
    ...overrides,
  };
}

/** A `FakeGeoreferenceRepository` reporting `GARDEN_ID` georeferenced in the northern hemisphere (Amsterdam) — the same fixture coordinates `tests/integration/garden-hemisphere.test.ts` uses for its own northern case. */
function northernGeoreferenceRepository(): FakeGeoreferenceRepository {
  const georeferenceRepository = new FakeGeoreferenceRepository();
  georeferenceRepository.byGardenId.set(GARDEN_ID, {
    id: generateUuidV7(),
    gardenId: GARDEN_ID,
    coordinateSpaceId: generateUuidV7(),
    localAnchor: [0, 0],
    geographicAnchor: [4.895, 52.37],
    rotationDegrees: 0,
    scaleCorrection: 1,
    accuracyMetres: null,
    provenance: 'userMeasurement',
    method: 'test-fixture',
    revision: 1,
  });
  return georeferenceRepository;
}

function makeUseCase(
  fakes: ReturnType<typeof createTasksRecommendationsFakes>,
  options?: {
    authorization?: ReturnType<typeof authorizationGranting>;
    georeferenceRepository?: FakeGeoreferenceRepository;
  },
) {
  return new GetGardenSeasonalPlan(
    options?.authorization ??
      authorizationGranting({
        id: 'm1',
        gardenId: GARDEN_ID,
        profileId: PROFILE_ID,
        role: 'owner',
      }),
    fakes.plants,
    fakes.taxonomyReferences,
    fakes.taxonomySeasonalFacts,
    fakes.bedOccupancyHistory,
    options?.georeferenceRepository ?? new FakeGeoreferenceRepository(),
    fixedClock(NOW),
  );
}

describe('GetGardenSeasonalPlan', () => {
  it('denies a caller with no membership on the garden — the same conceal-as-notFound pattern every sibling garden read applies', async () => {
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_REVIEWED_ID, plant({ id: PLANT_REVIEWED_ID })]]),
    });
    const useCase = makeUseCase(fakes, { authorization: authorizationDenying() });

    await expect(useCase.execute(GARDEN_ID, PROFILE_ID)).rejects.toMatchObject({
      code: 'garden.not_found',
    });
  });

  it('reports hemisphere null and every plant as noSeasonalData when the garden has never been georeferenced', async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([
        [TAXONOMY_REVIEWED_ID, taxonomyReference({ id: TAXONOMY_REVIEWED_ID })],
      ]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_REVIEWED_ID}:northern`,
          seasonalFact({ taxonomyReferenceId: TAXONOMY_REVIEWED_ID }),
        ],
      ]),
      plants: new Map([
        [
          PLANT_REVIEWED_ID,
          plant({ id: PLANT_REVIEWED_ID, taxonomyReferenceId: TAXONOMY_REVIEWED_ID }),
        ],
      ]),
    });
    const useCase = makeUseCase(fakes);

    const plan = await useCase.execute(GARDEN_ID, PROFILE_ID);

    expect(plan.hemisphere).toBeNull();
    expect(plan.plants).toEqual([
      {
        plantId: PLANT_REVIEWED_ID,
        taxonomyReferenceId: TAXONOMY_REVIEWED_ID,
        seasonalFact: { status: 'noSeasonalData' },
      },
    ]);
  });

  it('covers the three plants[] cases: a reviewed fact, an unknown taxon, and a taxon with no reviewed fact for this hemisphere', async () => {
    const georeferenceRepository = northernGeoreferenceRepository();
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([
        [TAXONOMY_REVIEWED_ID, taxonomyReference({ id: TAXONOMY_REVIEWED_ID })],
        [
          TAXONOMY_UNREVIEWED_HEMISPHERE_ID,
          taxonomyReference({ id: TAXONOMY_UNREVIEWED_HEMISPHERE_ID, family: 'Brassicaceae' }),
        ],
      ]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_REVIEWED_ID}:northern`,
          seasonalFact({
            taxonomyReferenceId: TAXONOMY_REVIEWED_ID,
            sowIndoorsStartMonth: 3,
            sowIndoorsEndMonth: 4,
            daysToMaturityMin: 60,
            daysToMaturityMax: 80,
          }),
        ],
        // Reviewed, but only for the SOUTHERN hemisphere — invisible to this
        // northern-hemisphere garden, the same as no row at all.
        [
          `${TAXONOMY_UNREVIEWED_HEMISPHERE_ID}:southern`,
          seasonalFact({
            taxonomyReferenceId: TAXONOMY_UNREVIEWED_HEMISPHERE_ID,
            hemisphere: 'southern',
          }),
        ],
      ]),
      plants: new Map([
        [
          PLANT_REVIEWED_ID,
          plant({ id: PLANT_REVIEWED_ID, taxonomyReferenceId: TAXONOMY_REVIEWED_ID }),
        ],
        [
          PLANT_UNREVIEWED_HEMISPHERE_ID,
          plant({
            id: PLANT_UNREVIEWED_HEMISPHERE_ID,
            taxonomyReferenceId: TAXONOMY_UNREVIEWED_HEMISPHERE_ID,
          }),
        ],
        [PLANT_UNKNOWN_TAXON_ID, plant({ id: PLANT_UNKNOWN_TAXON_ID })],
      ]),
    });
    const useCase = makeUseCase(fakes, { georeferenceRepository });

    const plan = await useCase.execute(GARDEN_ID, PROFILE_ID);

    expect(plan.hemisphere).toBe('northern');
    const byId = new Map(plan.plants.map((entry) => [entry.plantId, entry]));
    expect(byId.get(PLANT_REVIEWED_ID)).toEqual({
      plantId: PLANT_REVIEWED_ID,
      taxonomyReferenceId: TAXONOMY_REVIEWED_ID,
      seasonalFact: {
        status: 'reviewed',
        timing: expect.objectContaining({
          sowIndoorsStartMonth: 3,
          sowIndoorsEndMonth: 4,
          daysToMaturityMin: 60,
          daysToMaturityMax: 80,
        }) as unknown,
      },
    });
    expect(byId.get(PLANT_UNREVIEWED_HEMISPHERE_ID)).toEqual({
      plantId: PLANT_UNREVIEWED_HEMISPHERE_ID,
      taxonomyReferenceId: TAXONOMY_UNREVIEWED_HEMISPHERE_ID,
      seasonalFact: { status: 'noSeasonalData' },
    });
    expect(byId.get(PLANT_UNKNOWN_TAXON_ID)).toEqual({
      plantId: PLANT_UNKNOWN_TAXON_ID,
      taxonomyReferenceId: null,
      seasonalFact: { status: 'noSeasonalData' },
    });
  });

  it('reports both a WITHIN and a CLEAR rotation-rest-period plant, computed continuously', async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([
        [
          TAXONOMY_WITHIN_REST_ID,
          taxonomyReference({ id: TAXONOMY_WITHIN_REST_ID, family: 'Solanaceae' }),
        ],
        [
          TAXONOMY_CLEAR_REST_ID,
          taxonomyReference({ id: TAXONOMY_CLEAR_REST_ID, family: 'Brassicaceae' }),
        ],
      ]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_WITHIN_REST_ID}:northern`,
          seasonalFact({ taxonomyReferenceId: TAXONOMY_WITHIN_REST_ID, rotationRestSeasons: 2 }),
        ],
        [
          `${TAXONOMY_CLEAR_REST_ID}:northern`,
          seasonalFact({ taxonomyReferenceId: TAXONOMY_CLEAR_REST_ID, rotationRestSeasons: 1 }),
        ],
      ]),
      plants: new Map([
        [
          PLANT_WITHIN_REST_ID,
          plant({
            id: PLANT_WITHIN_REST_ID,
            taxonomyReferenceId: TAXONOMY_WITHIN_REST_ID,
            gardenAreaMapObjectId: BED_WITHIN_ID,
          }),
        ],
        [
          PLANT_CLEAR_REST_ID,
          plant({
            id: PLANT_CLEAR_REST_ID,
            taxonomyReferenceId: TAXONOMY_CLEAR_REST_ID,
            gardenAreaMapObjectId: BED_CLEAR_ID,
          }),
        ],
      ]),
      bedOccupancyPeriods: new Map([
        [
          BED_WITHIN_ID,
          [
            // Same family departed 100 days ago; threshold is 2 seasons = 730 days — still WITHIN.
            bedPeriod({
              plantId: PRIOR_OCCUPANT_WITHIN_ID,
              occupiedUntil: new Date(NOW.getTime() - 100 * DAY_MS),
              taxonomyReferenceId: TAXONOMY_WITHIN_REST_ID,
            }),
          ],
        ],
        [
          BED_CLEAR_ID,
          [
            // Same family departed 400 days ago; threshold is 1 season = 365 days — CLEAR.
            bedPeriod({
              plantId: PRIOR_OCCUPANT_CLEAR_ID,
              occupiedUntil: new Date(NOW.getTime() - 400 * DAY_MS),
              taxonomyReferenceId: TAXONOMY_CLEAR_REST_ID,
            }),
          ],
        ],
      ]),
    });
    const useCase = makeUseCase(fakes, {
      georeferenceRepository: northernGeoreferenceRepository(),
    });

    const plan = await useCase.execute(GARDEN_ID, PROFILE_ID);

    const byPlantId = new Map(plan.rotationStatus.map((entry) => [entry.plantId, entry]));
    expect(byPlantId.get(PLANT_WITHIN_REST_ID)).toEqual({
      plantId: PLANT_WITHIN_REST_ID,
      gardenAreaMapObjectId: BED_WITHIN_ID,
      family: 'Solanaceae',
      priorFamily: 'Solanaceae',
      priorOccupancyEndedAt: new Date(NOW.getTime() - 100 * DAY_MS),
      elapsedDays: 100,
      rotationRestSeasons: 2,
      restPeriodThresholdDays: 730,
      withinRestPeriod: true,
    });
    expect(byPlantId.get(PLANT_CLEAR_REST_ID)).toEqual({
      plantId: PLANT_CLEAR_REST_ID,
      gardenAreaMapObjectId: BED_CLEAR_ID,
      family: 'Brassicaceae',
      priorFamily: 'Brassicaceae',
      priorOccupancyEndedAt: new Date(NOW.getTime() - 400 * DAY_MS),
      elapsedDays: 400,
      rotationRestSeasons: 1,
      restPeriodThresholdDays: 365,
      withinRestPeriod: false,
    });
  });

  /**
   * CONSISTENCY PROOF (this package's own brief): the exact fixture data
   * `gather-seasonal-facts.test.ts`'s "finds the most recently DEPARTED
   * (non-self) occupant" test already proves `gatherPriorBedOccupants`
   * resolves through its OWN direct call — reused verbatim here, driven
   * through `GetGardenSeasonalPlan`'s non-transactional path instead, to
   * prove both callers reach the identical answer for identical data, not
   * merely independently plausible ones.
   */
  it('produces the same prior-occupant facts gather-seasonal-facts.test.ts proves directly, through the non-transactional read path', async () => {
    const taxonomyAId = generateUuidV7();
    const taxonomyUnplacedHistoryId = generateUuidV7();
    const bedAId = generateUuidV7();
    const plantAId = generateUuidV7();
    const plantBId = generateUuidV7();
    const priorPlantId = generateUuidV7();
    const evaluatedAt = new Date('2026-07-25T09:00:00Z');

    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([
        [taxonomyAId, taxonomyReference({ id: taxonomyAId, family: 'Solanaceae' })],
        [
          taxonomyUnplacedHistoryId,
          taxonomyReference({ id: taxonomyUnplacedHistoryId, family: 'Fabaceae' }),
        ],
      ]),
      plants: new Map([
        [
          plantAId,
          plant({ id: plantAId, taxonomyReferenceId: taxonomyAId, gardenAreaMapObjectId: bedAId }),
        ],
      ]),
      bedOccupancyPeriods: new Map([
        [
          bedAId,
          [
            // The plant's OWN earlier segment in this same bed — excluded (self).
            bedPeriod({
              plantId: plantAId,
              occupiedFrom: new Date(evaluatedAt.getTime() - 500 * DAY_MS),
              occupiedUntil: new Date(evaluatedAt.getTime() - 400 * DAY_MS),
              taxonomyReferenceId: taxonomyAId,
            }),
            // An older departed occupant of a different taxon.
            bedPeriod({
              plantId: priorPlantId,
              occupiedFrom: new Date(evaluatedAt.getTime() - 300 * DAY_MS),
              occupiedUntil: new Date(evaluatedAt.getTime() - 200 * DAY_MS),
              taxonomyReferenceId: taxonomyUnplacedHistoryId,
            }),
            // The MOST RECENTLY departed occupant — this is the one that should win.
            bedPeriod({
              plantId: plantBId,
              occupiedFrom: new Date(evaluatedAt.getTime() - 100 * DAY_MS),
              occupiedUntil: new Date(evaluatedAt.getTime() - 50 * DAY_MS),
              taxonomyReferenceId: taxonomyUnplacedHistoryId,
            }),
          ],
        ],
      ]),
    });
    const useCase = makeUseCase(fakes, {
      georeferenceRepository: new FakeGeoreferenceRepository(),
    });
    // Reuses `makeUseCase`'s `fixedClock(NOW)` for authorization but the
    // production `now` this stage's own elapsed-days math consults is the
    // injected clock; `NOW` here is deliberately the identical instant
    // `gather-seasonal-facts.test.ts`'s own `EVALUATED_AT` uses.
    expect(NOW).toEqual(evaluatedAt);

    const plan = await useCase.execute(GARDEN_ID, PROFILE_ID);

    const entry = plan.rotationStatus.find((row) => row.plantId === plantAId);
    expect(entry).toMatchObject({
      plantId: plantAId,
      gardenAreaMapObjectId: bedAId,
      family: 'Solanaceae',
      priorFamily: 'Fabaceae',
      priorOccupancyEndedAt: new Date(evaluatedAt.getTime() - 50 * DAY_MS),
    });
  });
});
