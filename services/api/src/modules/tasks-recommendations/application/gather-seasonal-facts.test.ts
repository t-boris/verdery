/**
 * Direct unit tests for `gather-seasonal-facts.ts` (P9D-SEASON-RULES-01) —
 * the fact-gathering half the pure rule fixtures (`tests/rule-fixtures/`)
 * cannot reach, since those start FROM an already-built `GardenFacts`.
 * This file proves the ASSEMBLY itself: the per-garden acceptance gate is
 * genuinely honored (not merely documented), one garden's acceptance never
 * leaks into another's facts, a `null` hemisphere never fabricates a
 * seasonal fact, and the bed-occupancy derivation picks the
 * right prior segment under the real gating rules
 * (`PriorBedOccupantFact`'s own doc comment in `garden-facts.ts`).
 */

import { describe, expect, it } from 'vitest';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type {
  BedOccupancyPeriod,
  TaxonomyReference,
  TaxonomySeasonalFact,
} from '../../plants-inventory/public.js';
import type { PlantFact } from '../domain/garden-facts.js';
import { gatherPriorBedOccupants, gatherTaxonomyFacts } from './gather-seasonal-facts.js';
import { createTasksRecommendationsFakes } from './tasks-recommendations-test-doubles.js';

const EVALUATED_AT = new Date('2026-07-25T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const GARDEN_ID = generateUuidV7();
const OTHER_GARDEN_ID = generateUuidV7();
const TAXONOMY_A_ID = generateUuidV7();
const TAXONOMY_B_ID = generateUuidV7();
const TAXONOMY_UNPLACED_HISTORY_ID = generateUuidV7();
const ACCEPTED_FACT_ID = generateUuidV7();
const BED_A_ID = generateUuidV7();
const PLANT_A_ID = generateUuidV7();
const PLANT_B_ID = generateUuidV7();
const PRIOR_PLANT_ID = generateUuidV7();

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
    sowIndoorsStartMonth: null,
    sowIndoorsEndMonth: null,
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

function plantFact(overrides: Partial<PlantFact> & { plantId: string }): PlantFact {
  return {
    displayName: 'Test plant',
    lifecycleStage: 'growing',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    taxonomyReferenceId: null,
    gardenAreaMapObjectId: null,
    ...overrides,
  };
}

describe('gatherTaxonomyFacts', () => {
  it('resolves family and the reviewed seasonal fact for each DISTINCT taxon among the plants, sorted, deduplicated', async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([
        [TAXONOMY_A_ID, taxonomyReference({ id: TAXONOMY_A_ID, family: 'Solanaceae' })],
        [TAXONOMY_B_ID, taxonomyReference({ id: TAXONOMY_B_ID, family: 'Brassicaceae' })],
      ]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_A_ID}:northern`,
          seasonalFact({
            id: ACCEPTED_FACT_ID,
            taxonomyReferenceId: TAXONOMY_A_ID,
            successionIntervalDays: 14,
          }),
        ],
      ]),
    });
    fakes.taxonomySeasonalFacts.acceptFor(GARDEN_ID, ACCEPTED_FACT_ID);

    const plants = [
      plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID }),
      plantFact({ plantId: PLANT_B_ID, taxonomyReferenceId: TAXONOMY_A_ID }), // same taxon twice
      plantFact({ plantId: generateUuidV7(), taxonomyReferenceId: TAXONOMY_B_ID }),
      plantFact({ plantId: generateUuidV7() }), // unknown taxonomy — excluded entirely
    ];

    const result = await gatherTaxonomyFacts(fakes, GARDEN_ID, plants, 'northern');

    expect(result).toHaveLength(2);
    const byId = new Map(result.map((fact) => [fact.taxonomyReferenceId, fact]));
    expect(byId.get(TAXONOMY_A_ID)).toMatchObject({
      family: 'Solanaceae',
      seasonalFact: expect.objectContaining({ successionIntervalDays: 14 }) as unknown,
    });
    expect(byId.get(TAXONOMY_B_ID)).toEqual({
      taxonomyReferenceId: TAXONOMY_B_ID,
      family: 'Brassicaceae',
      seasonalFact: null,
    });
  });

  it('never surfaces a fact this garden has not accepted — the same gate the real repository joins on', async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([[TAXONOMY_A_ID, taxonomyReference({ id: TAXONOMY_A_ID })]]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_A_ID}:northern`,
          seasonalFact({ id: ACCEPTED_FACT_ID, taxonomyReferenceId: TAXONOMY_A_ID }),
        ],
      ]),
    });
    // Seeded but never accepted: content existing is not consent to use it.

    const result = await gatherTaxonomyFacts(
      fakes,
      GARDEN_ID,
      [plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID })],
      'northern',
    );

    expect(result).toEqual([
      { taxonomyReferenceId: TAXONOMY_A_ID, family: 'Solanaceae', seasonalFact: null },
    ]);
  });

  it('does not surface a fact ANOTHER garden accepted — a decision reaches only the garden that made it', async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([[TAXONOMY_A_ID, taxonomyReference({ id: TAXONOMY_A_ID })]]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_A_ID}:northern`,
          seasonalFact({ id: ACCEPTED_FACT_ID, taxonomyReferenceId: TAXONOMY_A_ID }),
        ],
      ]),
    });
    fakes.taxonomySeasonalFacts.acceptFor(OTHER_GARDEN_ID, ACCEPTED_FACT_ID);

    const result = await gatherTaxonomyFacts(
      fakes,
      GARDEN_ID,
      [plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID })],
      'northern',
    );

    // The whole point of scoping the decision: this garden's owner never
    // agreed to this timing, so its rules stay silent regardless of what
    // any other garden decided.
    expect(result).toEqual([
      { taxonomyReferenceId: TAXONOMY_A_ID, family: 'Solanaceae', seasonalFact: null },
    ]);
  });

  it('leaves every seasonalFact null when hemisphere is unknown, even if an accepted row exists', async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([[TAXONOMY_A_ID, taxonomyReference({ id: TAXONOMY_A_ID })]]),
      taxonomySeasonalFacts: new Map([
        [
          `${TAXONOMY_A_ID}:northern`,
          seasonalFact({ id: ACCEPTED_FACT_ID, taxonomyReferenceId: TAXONOMY_A_ID }),
        ],
      ]),
    });
    fakes.taxonomySeasonalFacts.acceptFor(GARDEN_ID, ACCEPTED_FACT_ID);

    const result = await gatherTaxonomyFacts(
      fakes,
      GARDEN_ID,
      [plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID })],
      null,
    );

    expect(result).toEqual([
      { taxonomyReferenceId: TAXONOMY_A_ID, family: 'Solanaceae', seasonalFact: null },
    ]);
  });

  it('leaves family null for a taxon with no catalogued reference row — never invented', async () => {
    const fakes = createTasksRecommendationsFakes();

    const result = await gatherTaxonomyFacts(
      fakes,
      GARDEN_ID,
      [plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID })],
      'northern',
    );

    expect(result).toEqual([
      { taxonomyReferenceId: TAXONOMY_A_ID, family: null, seasonalFact: null },
    ]);
  });
});

describe('gatherPriorBedOccupants', () => {
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

  it('is empty for a plant with no bed placement, or with a placement but an unknown own family', async () => {
    const fakes = createTasksRecommendationsFakes();
    const unplaced = plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID });
    const placedButUnknownFamily = plantFact({
      plantId: PLANT_B_ID,
      taxonomyReferenceId: TAXONOMY_A_ID,
      gardenAreaMapObjectId: BED_A_ID,
    });
    const taxonomyFacts = [
      { taxonomyReferenceId: TAXONOMY_A_ID, family: null, seasonalFact: null },
    ];

    const result = await gatherPriorBedOccupants(
      fakes,
      [unplaced, placedButUnknownFamily],
      taxonomyFacts,
      EVALUATED_AT,
    );

    expect(result).toEqual([]);
  });

  it("finds the most recently DEPARTED (non-self) occupant, resolving their family even when they share no taxon with the garden's own current plants", async () => {
    const fakes = createTasksRecommendationsFakes({
      taxonomyReferences: new Map([
        [
          TAXONOMY_UNPLACED_HISTORY_ID,
          taxonomyReference({ id: TAXONOMY_UNPLACED_HISTORY_ID, family: 'Fabaceae' }),
        ],
      ]),
      bedOccupancyPeriods: new Map([
        [
          BED_A_ID,
          [
            // The plant's OWN earlier segment in this same bed — excluded (self).
            bedPeriod({
              plantId: PLANT_A_ID,
              occupiedFrom: new Date(EVALUATED_AT.getTime() - 500 * DAY_MS),
              occupiedUntil: new Date(EVALUATED_AT.getTime() - 400 * DAY_MS),
              taxonomyReferenceId: TAXONOMY_A_ID,
            }),
            // An older departed occupant of a different taxon.
            bedPeriod({
              plantId: PRIOR_PLANT_ID,
              occupiedFrom: new Date(EVALUATED_AT.getTime() - 300 * DAY_MS),
              occupiedUntil: new Date(EVALUATED_AT.getTime() - 200 * DAY_MS),
              taxonomyReferenceId: TAXONOMY_UNPLACED_HISTORY_ID,
            }),
            // The MOST RECENTLY departed occupant — this is the one that should win.
            bedPeriod({
              plantId: PLANT_B_ID,
              occupiedFrom: new Date(EVALUATED_AT.getTime() - 100 * DAY_MS),
              occupiedUntil: new Date(EVALUATED_AT.getTime() - 50 * DAY_MS),
              taxonomyReferenceId: TAXONOMY_UNPLACED_HISTORY_ID,
            }),
            // A still-open (concurrent) OTHER occupant — not "departed", excluded.
            bedPeriod({
              plantId: generateUuidV7(),
              occupiedFrom: new Date(EVALUATED_AT.getTime() - 10 * DAY_MS),
              occupiedUntil: null,
              taxonomyReferenceId: TAXONOMY_A_ID,
            }),
          ],
        ],
      ]),
    });
    const plant = plantFact({
      plantId: PLANT_A_ID,
      taxonomyReferenceId: TAXONOMY_A_ID,
      gardenAreaMapObjectId: BED_A_ID,
    });
    const taxonomyFacts = [
      { taxonomyReferenceId: TAXONOMY_A_ID, family: 'Solanaceae', seasonalFact: null },
    ];

    const result = await gatherPriorBedOccupants(fakes, [plant], taxonomyFacts, EVALUATED_AT);

    expect(result).toEqual([
      {
        plantId: PLANT_A_ID,
        gardenAreaMapObjectId: BED_A_ID,
        priorFamily: 'Fabaceae',
        priorOccupancyEndedAt: new Date(EVALUATED_AT.getTime() - 50 * DAY_MS),
      },
    ]);
  });

  it('reports no known conflict (both fields null) when the bed has no departed occupant at all', async () => {
    const fakes = createTasksRecommendationsFakes({
      bedOccupancyPeriods: new Map([[BED_A_ID, []]]),
    });
    const plant = plantFact({
      plantId: PLANT_A_ID,
      taxonomyReferenceId: TAXONOMY_A_ID,
      gardenAreaMapObjectId: BED_A_ID,
    });
    const taxonomyFacts = [
      { taxonomyReferenceId: TAXONOMY_A_ID, family: 'Solanaceae', seasonalFact: null },
    ];

    const result = await gatherPriorBedOccupants(fakes, [plant], taxonomyFacts, EVALUATED_AT);

    expect(result).toEqual([
      {
        plantId: PLANT_A_ID,
        gardenAreaMapObjectId: BED_A_ID,
        priorFamily: null,
        priorOccupancyEndedAt: null,
      },
    ]);
  });

  it('reports a known departure with an unknown family honestly, rather than guessing a match', async () => {
    const fakes = createTasksRecommendationsFakes({
      bedOccupancyPeriods: new Map([
        [
          BED_A_ID,
          [
            bedPeriod({
              plantId: PRIOR_PLANT_ID,
              occupiedUntil: new Date(EVALUATED_AT.getTime() - 50 * DAY_MS),
              taxonomyReferenceId: null, // the departed occupant was never identified
            }),
          ],
        ],
      ]),
    });
    const plant = plantFact({
      plantId: PLANT_A_ID,
      taxonomyReferenceId: TAXONOMY_A_ID,
      gardenAreaMapObjectId: BED_A_ID,
    });
    const taxonomyFacts = [
      { taxonomyReferenceId: TAXONOMY_A_ID, family: 'Solanaceae', seasonalFact: null },
    ];

    const result = await gatherPriorBedOccupants(fakes, [plant], taxonomyFacts, EVALUATED_AT);

    expect(result).toEqual([
      {
        plantId: PLANT_A_ID,
        gardenAreaMapObjectId: BED_A_ID,
        priorFamily: null,
        priorOccupancyEndedAt: new Date(EVALUATED_AT.getTime() - 50 * DAY_MS),
      },
    ]);
  });
});
