import type {
  ImageAnalysisKind,
  PlantDistributionStatus,
  PlantProfileCompleteness,
  TaxonSeasonalActivity,
} from '@verdery/api-contracts';

import {
  EMPTY_PLANT_ADVANCED_FILTERS,
  type JournalRecencyFilter,
  type PlantAdvancedFilterState,
} from './plant-advanced-filters';

/**
 * The plant list's filters, read from and written to the URL.
 *
 * A filtered list is something people send each other — "look at the three
 * plants nobody has seen since spring" is a link, not a set of instructions
 * for reproducing a form. That is the whole reason this exists, and it is why
 * the state lives in the query string rather than only in React.
 *
 * The pagination cursor is deliberately absent. It encodes a position in the
 * result set it was issued for, so a shared link carrying one would open on a
 * page that means nothing to the recipient — and the list already discards it
 * whenever a filter changes, for the same reason.
 *
 * Every value is validated on the way in. A hand-edited or stale link is
 * ordinary input here, not an error: an unrecognised value falls back to the
 * unfiltered default rather than throwing or filtering by something the
 * server would reject.
 *
 * Source: architecture/web-application-design.md, section "6. State
 * Ownership" ("Route state | Next.js router and URL").
 */

export type IdentifiedFilter = 'all' | 'identified' | 'unidentified';

export interface PlantListFilters {
  readonly searchText: string;
  readonly identified: IdentifiedFilter;
  readonly advanced: PlantAdvancedFilterState;
}

export const EMPTY_PLANT_LIST_FILTERS: PlantListFilters = {
  searchText: '',
  identified: 'all',
  advanced: EMPTY_PLANT_ADVANCED_FILTERS,
};

const IDENTIFIED_VALUES: readonly IdentifiedFilter[] = ['all', 'identified', 'unidentified'];
const JOURNAL_RECENCY_VALUES: readonly JournalRecencyFilter[] = [
  'any',
  'seen_7',
  'seen_30',
  'not_seen_30',
  'not_seen_90',
  'never_seen',
];
const HEALTH_CONCERN_VALUES: readonly (ImageAnalysisKind | 'any')[] = [
  'any',
  'stress',
  'disease',
  'pest',
  'other',
];
const SEASONAL_ACTIVITY_VALUES: readonly (TaxonSeasonalActivity | 'any')[] = [
  'any',
  'sow_indoors',
  'sow_outdoors',
  'transplant',
  'harvest',
];
const DISTRIBUTION_STATUS_VALUES: readonly (PlantDistributionStatus | 'any')[] = [
  'any',
  'native',
  'introduced',
  'invasive',
  'regulated',
];
const PROFILE_COMPLETENESS_VALUES: readonly (PlantProfileCompleteness | 'any')[] = [
  'any',
  'complete',
  'partial',
  'none',
];

/** The parameter names, kept together so reading and writing cannot drift apart. */
const PARAM = {
  query: 'q',
  identified: 'identified',
  journalRecency: 'seen',
  healthConcern: 'health',
  seasonalActivity: 'season',
  seasonalMonth: 'month',
  distributionStatus: 'origin',
  distributionRegion: 'region',
  profileCompleteness: 'knowledge',
} as const;

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function readPlantListFilters(params: URLSearchParams): PlantListFilters {
  const seasonalMonthRaw = Number(params.get(PARAM.seasonalMonth));
  const seasonalMonth =
    Number.isInteger(seasonalMonthRaw) && seasonalMonthRaw >= 1 && seasonalMonthRaw <= 12
      ? seasonalMonthRaw
      : null;

  return {
    searchText: params.get(PARAM.query) ?? '',
    identified: oneOf(params.get(PARAM.identified), IDENTIFIED_VALUES, 'all'),
    advanced: {
      journalRecency: oneOf(params.get(PARAM.journalRecency), JOURNAL_RECENCY_VALUES, 'any'),
      healthConcern: oneOf(params.get(PARAM.healthConcern), HEALTH_CONCERN_VALUES, 'any'),
      seasonalActivity: oneOf(params.get(PARAM.seasonalActivity), SEASONAL_ACTIVITY_VALUES, 'any'),
      seasonalMonth,
      distributionStatus: oneOf(
        params.get(PARAM.distributionStatus),
        DISTRIBUTION_STATUS_VALUES,
        'any',
      ),
      distributionRegion: params.get(PARAM.distributionRegion) ?? '',
      profileCompleteness: oneOf(
        params.get(PARAM.profileCompleteness),
        PROFILE_COMPLETENESS_VALUES,
        'any',
      ),
    },
  };
}

/**
 * The query string for a set of filters. Defaults are omitted rather than
 * spelled out: an unfiltered list should have a clean URL, and `?health=any`
 * would say something the reader never chose.
 */
export function writePlantListFilters(filters: PlantListFilters): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string, fallback: string) => {
    if (value !== fallback) params.set(key, value);
  };

  set(PARAM.query, filters.searchText.trim(), '');
  set(PARAM.identified, filters.identified, 'all');
  set(PARAM.journalRecency, filters.advanced.journalRecency, 'any');
  set(PARAM.healthConcern, filters.advanced.healthConcern, 'any');
  set(PARAM.seasonalActivity, filters.advanced.seasonalActivity, 'any');
  // A month means nothing without the activity it qualifies, and the list
  // already ignores it in that case.
  if (filters.advanced.seasonalActivity !== 'any' && filters.advanced.seasonalMonth !== null) {
    params.set(PARAM.seasonalMonth, String(filters.advanced.seasonalMonth));
  }
  set(PARAM.distributionStatus, filters.advanced.distributionStatus, 'any');
  if (filters.advanced.distributionStatus !== 'any') {
    set(PARAM.distributionRegion, filters.advanced.distributionRegion.trim(), '');
  }
  set(PARAM.profileCompleteness, filters.advanced.profileCompleteness, 'any');

  return params.toString();
}
