import type {
  PlantListResult,
  SeasonalPlanRotationStatusEntry,
  SeasonalPlanTaxonomyTiming,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { describeRotationEntry, plantNameLookup, resolvedPlantName, timingRows } from './labels';

const NO_TIMING: SeasonalPlanTaxonomyTiming = {
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
};

function rotationEntry(
  overrides: Partial<SeasonalPlanRotationStatusEntry>,
): SeasonalPlanRotationStatusEntry {
  return {
    plantId: 'plant-1',
    gardenAreaMapObjectId: 'area-1',
    family: 'Solanaceae',
    priorFamily: null,
    priorOccupancyEndedAt: null,
    elapsedDays: null,
    rotationRestSeasons: null,
    restPeriodThresholdDays: null,
    withinRestPeriod: false,
    ...overrides,
  };
}

describe('timingRows', () => {
  it('omits a window entirely when both bounds are null', () => {
    expect(timingRows(NO_TIMING, 'en')).toEqual([]);
  });

  it('renders a full month range for a configured window', () => {
    const timing: SeasonalPlanTaxonomyTiming = {
      ...NO_TIMING,
      sowIndoorsStartMonth: 2,
      sowIndoorsEndMonth: 4,
    };

    const rows = timingRows(timing, 'en');

    expect(rows).toEqual([
      {
        labelKey: 'seasonalPlan.calendar.sowIndoorsLabel',
        rangeKey: 'seasonalPlan.calendar.monthRange',
        rangeArgs: { start: 'February', end: 'April' },
      },
    ]);
  });

  it('renders every configured window, in a stable order', () => {
    const timing: SeasonalPlanTaxonomyTiming = {
      ...NO_TIMING,
      sowOutdoorsStartMonth: 5,
      sowOutdoorsEndMonth: 6,
      harvestStartMonth: 8,
      harvestEndMonth: 9,
    };

    const rows = timingRows(timing, 'en');

    expect(rows.map((row) => row.labelKey)).toEqual([
      'seasonalPlan.calendar.sowOutdoorsLabel',
      'seasonalPlan.calendar.harvestLabel',
    ]);
  });

  it('falls back to a single-month row when only one bound is set', () => {
    const timing: SeasonalPlanTaxonomyTiming = { ...NO_TIMING, transplantStartMonth: 6 };

    const rows = timingRows(timing, 'en');

    expect(rows).toEqual([
      {
        labelKey: 'seasonalPlan.calendar.transplantLabel',
        rangeKey: 'seasonalPlan.calendar.singleMonth',
        rangeArgs: { month: 'June' },
      },
    ]);
  });
});

describe('plantNameLookup / resolvedPlantName', () => {
  it('resolves a name present in the lookup page', () => {
    const list: PlantListResult = {
      items: [
        {
          id: 'plant-1',
          gardenId: 'garden-1',
          gardenAreaMapObjectId: null,
          placementMapObjectId: null,
          displayName: 'Roma Tomato',
          taxonomyReferenceId: null,
          varietyLabel: null,
          acceptedIdentificationId: null,
          acquisitionDate: null,
          acquisitionDateType: null,
          groupingKind: 'individual',
          quantity: null,
          lifecycleStage: 'growing',
          status: 'active',
          conditionNote: null,
          careGuidanceNote: null,
          coverMediaId: null,
          revision: 1,
          createdByProfileId: 'profile-1',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };

    const lookup = plantNameLookup(list);

    expect(resolvedPlantName(lookup, 'plant-1')).toBe('Roma Tomato');
  });

  it('returns null for a plant absent from the lookup, never a guess', () => {
    expect(resolvedPlantName(plantNameLookup(undefined), 'plant-missing')).toBeNull();
  });
});

describe('describeRotationEntry', () => {
  it('describes a conflict with the plain-language template', () => {
    const entry = rotationEntry({
      priorFamily: 'Solanaceae',
      elapsedDays: 40,
      restPeriodThresholdDays: 730,
      withinRestPeriod: true,
    });

    expect(describeRotationEntry(entry)).toEqual({
      key: 'seasonalPlan.rotation.conflictText',
      args: {
        family: 'Solanaceae',
        priorFamily: 'Solanaceae',
        elapsedDays: 40,
        restPeriodThresholdDays: 730,
      },
    });
  });

  it('describes no known prior occupant', () => {
    const entry = rotationEntry({ priorFamily: null });

    expect(describeRotationEntry(entry)).toEqual({
      key: 'seasonalPlan.rotation.noPriorOccupant',
      args: { family: 'Solanaceae' },
    });
  });

  it('describes a different prior family as no concern', () => {
    const entry = rotationEntry({ priorFamily: 'Fabaceae' });

    expect(describeRotationEntry(entry)).toEqual({
      key: 'seasonalPlan.rotation.differentFamily',
      args: { family: 'Solanaceae', priorFamily: 'Fabaceae' },
    });
  });

  it('describes an unknown departure date for the same family', () => {
    const entry = rotationEntry({ priorFamily: 'Solanaceae', elapsedDays: null });

    expect(describeRotationEntry(entry)).toEqual({
      key: 'seasonalPlan.rotation.restDurationUnknown',
      args: { family: 'Solanaceae', priorFamily: 'Solanaceae' },
    });
  });

  it('describes a same-family return with no configured rest period', () => {
    const entry = rotationEntry({
      priorFamily: 'Solanaceae',
      elapsedDays: 200,
      restPeriodThresholdDays: null,
    });

    expect(describeRotationEntry(entry)).toEqual({
      key: 'seasonalPlan.rotation.noRestPeriodConfigured',
      args: { family: 'Solanaceae', priorFamily: 'Solanaceae', elapsedDays: 200 },
    });
  });

  it('describes an already-elapsed rest period', () => {
    const entry = rotationEntry({
      priorFamily: 'Solanaceae',
      elapsedDays: 800,
      restPeriodThresholdDays: 730,
    });

    expect(describeRotationEntry(entry)).toEqual({
      key: 'seasonalPlan.rotation.restPeriodElapsed',
      args: {
        family: 'Solanaceae',
        priorFamily: 'Solanaceae',
        elapsedDays: 800,
        restPeriodThresholdDays: 730,
      },
    });
  });
});
