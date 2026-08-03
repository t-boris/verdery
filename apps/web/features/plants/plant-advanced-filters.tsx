'use client';

import type {
  ImageAnalysisKind,
  PlantDistributionStatus,
  PlantProfileCompleteness,
  TaxonSeasonalActivity,
} from '@verdery/api-contracts';
import { useId, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { ChevronDownIcon, Select, TextField } from '@/shared/ui/public';

import styles from './plant-advanced-filters.module.css';

/**
 * P11-SEARCH-01's six joined filters, as one disclosure beside the identity
 * strip.
 *
 * BEHIND A DISCLOSURE, not in the strip. The identity segments answer the
 * question a reader has on nearly every visit; these answer occasional ones,
 * and putting nine more controls on the permanent bar would cost the list its
 * own space to make room for filters most sessions never touch. The disclosure
 * reports how many are active in its own label, so a filtered list can never
 * look like an unfiltered one that simply found less.
 *
 * JOURNAL RECENCY IS ONE CONTROL, NOT TWO. The API takes independent
 * `observedWithinDays` and `notObservedForDays` bounds, but a reader wants
 * "recently seen" or "neglected", never both at once — offering two number
 * fields would invite a combination that returns nothing and reads as a bug.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `searchPlants`;
 * implementation-plan.md work package P11-SEARCH-01 and P11-WEB-01.
 */

export type JournalRecencyFilter =
  'any' | 'seen_7' | 'seen_30' | 'not_seen_30' | 'not_seen_90' | 'never_seen';

export interface PlantAdvancedFilterState {
  readonly journalRecency: JournalRecencyFilter;
  readonly healthConcern: ImageAnalysisKind | 'any';
  readonly seasonalActivity: TaxonSeasonalActivity | 'any';
  readonly seasonalMonth: number | null;
  readonly distributionStatus: PlantDistributionStatus | 'any';
  readonly distributionRegion: string;
  readonly profileCompleteness: PlantProfileCompleteness | 'any';
}

export const EMPTY_PLANT_ADVANCED_FILTERS: PlantAdvancedFilterState = {
  journalRecency: 'any',
  healthConcern: 'any',
  seasonalActivity: 'any',
  seasonalMonth: null,
  distributionStatus: 'any',
  distributionRegion: '',
  profileCompleteness: 'any',
};

/** Translates the single recency control back into the two independent bounds the API takes. `never_seen` is `notObservedForDays` at its maximum: a plant with no observation at all matches every such bound, and no other value expresses "none, ever". */
export function toRecencyParams(filter: JournalRecencyFilter): {
  observedWithinDays: number | null;
  notObservedForDays: number | null;
} {
  switch (filter) {
    case 'seen_7':
      return { observedWithinDays: 7, notObservedForDays: null };
    case 'seen_30':
      return { observedWithinDays: 30, notObservedForDays: null };
    case 'not_seen_30':
      return { observedWithinDays: null, notObservedForDays: 30 };
    case 'not_seen_90':
      return { observedWithinDays: null, notObservedForDays: 90 };
    case 'never_seen':
      return { observedWithinDays: null, notObservedForDays: 3650 };
    case 'any':
      return { observedWithinDays: null, notObservedForDays: null };
  }
}

/** How many of the six are narrowing the result set — shown on the disclosure so a filtered list never passes for an empty one. */
export function countActiveFilters(state: PlantAdvancedFilterState): number {
  return [
    state.journalRecency !== 'any',
    state.healthConcern !== 'any',
    state.seasonalActivity !== 'any',
    state.distributionStatus !== 'any',
    state.distributionRegion.trim() !== '',
    state.profileCompleteness !== 'any',
  ].filter(Boolean).length;
}

export interface PlantAdvancedFiltersProps {
  readonly value: PlantAdvancedFilterState;
  readonly onChange: (next: PlantAdvancedFilterState) => void;
}

export function PlantAdvancedFilters({ value, onChange }: PlantAdvancedFiltersProps) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const activeCount = countActiveFilters(value);
  const set = <K extends keyof PlantAdvancedFilterState>(
    key: K,
    next: PlantAdvancedFilterState[K],
  ) => onChange({ ...value, [key]: next });

  const anyOption = { value: 'any', label: t('plants.filterAny') };

  return (
    <div className={styles['panel']}>
      <button
        type="button"
        className={styles['disclosure']}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <ChevronDownIcon />
        {activeCount === 0
          ? t('plants.moreFilters')
          : t('plants.moreFiltersActive', { count: String(activeCount) })}
      </button>

      {open && (
        <div id={panelId} className={styles['fields']}>
          <Select
            label={t('plants.journalRecencyLabel')}
            value={value.journalRecency}
            onChange={(event) => set('journalRecency', event.target.value as JournalRecencyFilter)}
            options={[
              anyOption,
              { value: 'seen_7', label: t('plants.recencySeen7') },
              { value: 'seen_30', label: t('plants.recencySeen30') },
              { value: 'not_seen_30', label: t('plants.recencyNotSeen30') },
              { value: 'not_seen_90', label: t('plants.recencyNotSeen90') },
              { value: 'never_seen', label: t('plants.recencyNeverSeen') },
            ]}
          />

          <Select
            label={t('plants.healthConcernLabel')}
            value={value.healthConcern}
            onChange={(event) =>
              set('healthConcern', event.target.value as ImageAnalysisKind | 'any')
            }
            options={[
              anyOption,
              { value: 'stress', label: t('plants.healthStress') },
              { value: 'disease', label: t('plants.healthDisease') },
              { value: 'pest', label: t('plants.healthPest') },
              { value: 'other', label: t('plants.healthOther') },
            ]}
          />

          <Select
            label={t('plants.seasonalActivityLabel')}
            value={value.seasonalActivity}
            onChange={(event) =>
              set('seasonalActivity', event.target.value as TaxonSeasonalActivity | 'any')
            }
            options={[
              anyOption,
              { value: 'sow_indoors', label: t('plants.seasonSowIndoors') },
              { value: 'sow_outdoors', label: t('plants.seasonSowOutdoors') },
              { value: 'transplant', label: t('plants.seasonTransplant') },
              { value: 'harvest', label: t('plants.seasonHarvest') },
            ]}
          />

          <Select
            label={t('plants.seasonalMonthLabel')}
            value={value.seasonalMonth === null ? '' : String(value.seasonalMonth)}
            disabled={value.seasonalActivity === 'any'}
            onChange={(event) =>
              set('seasonalMonth', event.target.value === '' ? null : Number(event.target.value))
            }
            options={[
              { value: '', label: t('plants.filterAnyMonth') },
              ...MONTH_LABEL_KEYS.map((key, index) => ({
                value: String(index + 1),
                label: t(key),
              })),
            ]}
          />

          <Select
            label={t('plants.distributionStatusLabel')}
            value={value.distributionStatus}
            onChange={(event) =>
              set('distributionStatus', event.target.value as PlantDistributionStatus | 'any')
            }
            options={[
              anyOption,
              { value: 'native', label: t('plants.distributionNative') },
              { value: 'introduced', label: t('plants.distributionIntroduced') },
              { value: 'invasive', label: t('plants.distributionInvasive') },
              { value: 'regulated', label: t('plants.distributionRegulated') },
            ]}
          />

          <TextField
            label={t('plants.distributionRegionLabel')}
            value={value.distributionRegion}
            disabled={value.distributionStatus === 'any'}
            onChange={(event) => set('distributionRegion', event.target.value)}
          />

          <Select
            label={t('plants.profileCompletenessLabel')}
            value={value.profileCompleteness}
            onChange={(event) =>
              set('profileCompleteness', event.target.value as PlantProfileCompleteness | 'any')
            }
            options={[
              anyOption,
              { value: 'complete', label: t('plants.completenessComplete') },
              { value: 'partial', label: t('plants.completenessPartial') },
              { value: 'none', label: t('plants.completenessNone') },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** Listed rather than built from a template literal: `t` is keyed by a union of literal strings, and a computed key is not a member of it. */
const MONTH_LABEL_KEYS = [
  'plants.month1',
  'plants.month2',
  'plants.month3',
  'plants.month4',
  'plants.month5',
  'plants.month6',
  'plants.month7',
  'plants.month8',
  'plants.month9',
  'plants.month10',
  'plants.month11',
  'plants.month12',
] as const;
