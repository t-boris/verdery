import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import {
  authorizationDenying,
  authorizationGranting,
  fixedClock,
} from '../../plants-inventory/application/plants-inventory-test-doubles.js';
import { GetGardenPrecipitation, GetGardenWeather } from '../../integrations/public.js';
import type { WeatherRecord } from '../../integrations/public.js';
import { createLaunchRuleCatalog } from '../domain/rules/launch-rule-catalog.js';
import { GetGardenCareRules } from './get-garden-care-rules.js';
import type { CareRulePlantReadinessSource } from './get-garden-care-rules.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import {
  FakeGeoreferenceRepository,
  FakeWeatherRecordRepository,
} from './recommendation-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e0a';
const NOW = new Date('2026-08-07T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

const VIEWER = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'viewer' as const,
};

function plantReadiness(
  overrides: Partial<Awaited<ReturnType<CareRulePlantReadinessSource['readGardenPlantReadiness']>>>,
): CareRulePlantReadinessSource {
  return {
    readGardenPlantReadiness: () =>
      Promise.resolve({
        hasIdentifiedPlant: false,
        hasPlacedPlant: false,
        hasReviewedSeasonalFact: false,
        ...overrides,
      }),
  };
}

function buildRead(options: {
  readonly georeferenced?: boolean;
  readonly activeProviderKey?: string | null;
  readonly weatherRecords?: readonly WeatherRecord[];
  readonly plants?: CareRulePlantReadinessSource;
  readonly authorized?: boolean;
}): GetGardenCareRules {
  const georeferences = new FakeGeoreferenceRepository();
  if (options.georeferenced ?? false) {
    georeferences.byGardenId.set(GARDEN_ID, {
      id: generateUuidV7(),
      gardenId: GARDEN_ID,
      coordinateSpaceId: generateUuidV7(),
      localAnchor: [0, 0],
      // Amsterdam — northern, matching the sibling suites' own fixture.
      geographicAnchor: [4.895, 52.37],
      rotationDegrees: 0,
      scaleCorrection: 1,
      accuracyMetres: null,
      displayAddress: null,
      provenance: 'userMeasurement',
      method: 'test-fixture',
      revision: 1,
    });
  }
  const records = new FakeWeatherRecordRepository(options.weatherRecords ?? []);
  return new GetGardenCareRules(
    createLaunchRuleCatalog(),
    (options.authorized ?? true) ? authorizationGranting(VIEWER) : authorizationDenying(),
    georeferences,
    new GetGardenWeather(records, FRESHNESS, fixedClock(NOW)),
    new GetGardenPrecipitation(records),
    options.plants ?? plantReadiness({}),
    options.activeProviderKey === undefined ? 'open-meteo' : options.activeProviderKey,
    fixedClock(NOW),
  );
}

function blockersOf(
  result: Awaited<ReturnType<GetGardenCareRules['execute']>>,
  ruleKey: string,
): readonly string[] {
  return result.rules.find((rule) => rule.ruleKey === ruleKey)?.blockers ?? [];
}

describe('GetGardenCareRules', () => {
  it('lists exactly the rules an evaluation would run — the highest version of each key', async () => {
    const result = await buildRead({}).execute(GARDEN_ID, PROFILE_ID);

    expect(result.rules.map((rule) => `${rule.ruleKey}@${String(rule.version)}`)).toEqual([
      'watering.dry-spell-check@2',
      'observation.routine-check-reminder@1',
      'lifecycle.harvest-readiness-check@1',
      'weather.frost-watch@1',
      'seasonal.sowing-window-check@1',
      'succession.replanting-reminder@1',
      'rotation.crop-rotation-caution@1',
    ]);
  });

  it('reports a missing provider on the weather rules, and does not also blame the garden for it', async () => {
    const result = await buildRead({ activeProviderKey: null, georeferenced: false }).execute(
      GARDEN_ID,
      PROFILE_ID,
    );

    // Reporting "set your location" to somebody whose deployment can fetch
    // nothing would be advice that cannot work.
    expect(blockersOf(result, 'watering.dry-spell-check')).toContain('noWeatherProvider');
    expect(blockersOf(result, 'watering.dry-spell-check')).not.toContain('gardenNotGeoreferenced');
  });

  it('reports one missing georeference once, not as three separate symptoms', async () => {
    const result = await buildRead({ georeferenced: false }).execute(GARDEN_ID, PROFILE_ID);

    const watering = blockersOf(result, 'watering.dry-spell-check');
    expect(watering).toContain('gardenNotGeoreferenced');
    expect(watering).not.toContain('noWeatherObservation');
    expect(watering).not.toContain('noRainfallHistory');
    expect(blockersOf(result, 'seasonal.sowing-window-check')).toContain('gardenNotGeoreferenced');
  });

  it('names the specific missing inputs once coordinates are in place', async () => {
    const result = await buildRead({ georeferenced: true }).execute(GARDEN_ID, PROFILE_ID);

    expect(blockersOf(result, 'watering.dry-spell-check')).toEqual(
      expect.arrayContaining(['noWeatherObservation', 'noRainfallHistory']),
    );
    expect(blockersOf(result, 'weather.frost-watch')).toContain('noWeatherForecast');
    expect(blockersOf(result, 'seasonal.sowing-window-check')).toEqual(
      expect.arrayContaining(['noIdentifiedPlants', 'noReviewedSeasonalFacts']),
    );
    expect(blockersOf(result, 'rotation.crop-rotation-caution')).toContain('noPlacedPlants');
  });

  it('leaves the weather-free rules unblocked but for their outstanding review', async () => {
    const result = await buildRead({}).execute(GARDEN_ID, PROFILE_ID);

    // These two need nothing but the garden's own records, so a garden with
    // no provider, no coordinates and no identified plants still gets them.
    expect(blockersOf(result, 'observation.routine-check-reminder')).toEqual([
      'awaitingHorticulturalReview',
    ]);
    expect(blockersOf(result, 'lifecycle.harvest-readiness-check')).toEqual([
      'awaitingHorticulturalReview',
    ]);
  });

  it('discloses the outstanding horticultural review on every rule, since every rule still carries one', async () => {
    const result = await buildRead({ georeferenced: true }).execute(GARDEN_ID, PROFILE_ID);

    for (const rule of result.rules) {
      expect(rule.reviewStatus).toBe('awaiting_horticultural_review');
      expect(rule.blockers).toContain('awaitingHorticulturalReview');
    }
  });

  it('requires viewGarden', async () => {
    await expect(
      buildRead({ authorized: false }).execute(GARDEN_ID, PROFILE_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('covers every catalogued rule key in its precondition map — an omission would silently report no blockers', async () => {
    const result = await buildRead({ georeferenced: true }).execute(GARDEN_ID, PROFILE_ID);

    // Every rule either genuinely needs nothing beyond the garden's own
    // records, or names what it needs. A key missing from the map would
    // show up here as a rule with only the review disclosure despite
    // reading weather or taxonomy.
    for (const rule of result.rules) {
      if (rule.usesWeather) {
        expect(rule.blockers.length).toBeGreaterThan(1);
      }
    }
  });
});
