import { describe, expect, it } from 'vitest';

import { EMPTY_PLANT_ADVANCED_FILTERS } from './plant-advanced-filters';
import {
  EMPTY_PLANT_LIST_FILTERS,
  readPlantListFilters,
  writePlantListFilters,
} from './plant-list-url-state';

describe('plant list URL state', () => {
  it('reads an unfiltered list from an empty query string', () => {
    expect(readPlantListFilters(new URLSearchParams(''))).toEqual(EMPTY_PLANT_LIST_FILTERS);
  });

  it('round-trips every filter it writes', () => {
    const filters = {
      searchText: 'tomato',
      identified: 'unidentified' as const,
      advanced: {
        journalRecency: 'not_seen_90' as const,
        healthConcern: 'pest' as const,
        seasonalActivity: 'transplant' as const,
        seasonalMonth: 5,
        distributionStatus: 'invasive' as const,
        distributionRegion: 'US-CA',
        profileCompleteness: 'partial' as const,
      },
    };

    expect(readPlantListFilters(new URLSearchParams(writePlantListFilters(filters)))).toEqual(
      filters,
    );
  });

  it('omits defaults so an unfiltered list keeps a clean URL', () => {
    expect(writePlantListFilters(EMPTY_PLANT_LIST_FILTERS)).toBe('');
  });

  it.each([
    ['identified', 'perhaps'],
    ['seen', 'last_tuesday'],
    ['health', 'sunburn'],
    ['season', 'sow'],
    ['origin', 'noxious'],
    ['knowledge', 'missing'],
  ])('falls back to unfiltered for a %s value the contract never defined', (key, value) => {
    // A hand-edited or stale link is ordinary input. Filtering by a value the
    // server would reject turns someone else's typo into an error page.
    const filters = readPlantListFilters(new URLSearchParams(`${key}=${value}`));

    expect(filters).toEqual(EMPTY_PLANT_LIST_FILTERS);
  });

  it.each(['0', '13', 'may', '5.5'])('ignores %s as a seasonal month', (month) => {
    const filters = readPlantListFilters(new URLSearchParams(`season=harvest&month=${month}`));

    expect(filters.advanced.seasonalMonth).toBeNull();
  });

  it('drops a month with no activity to qualify it', () => {
    // The list ignores the month in that case, so carrying it in the URL would
    // describe a filter that is not being applied.
    const written = writePlantListFilters({
      ...EMPTY_PLANT_LIST_FILTERS,
      advanced: { ...EMPTY_PLANT_ADVANCED_FILTERS, seasonalMonth: 5 },
    });

    expect(written).toBe('');
  });

  it('drops a region with no distribution status to qualify it', () => {
    const written = writePlantListFilters({
      ...EMPTY_PLANT_LIST_FILTERS,
      advanced: { ...EMPTY_PLANT_ADVANCED_FILTERS, distributionRegion: 'US-CA' },
    });

    expect(written).toBe('');
  });
});
