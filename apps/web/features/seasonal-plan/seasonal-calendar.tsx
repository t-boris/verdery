'use client';

import type { Hemisphere, SeasonalPlanPlantEntry } from '@verdery/api-contracts';
import Link from 'next/link';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Card } from '@/shared/ui/public';

import { resolvedPlantName, timingRows, type PlantNameLookup } from './labels';
import styles from './seasonal-calendar.module.css';

export interface SeasonalCalendarProps {
  readonly gardenId: string;
  readonly hemisphere: Hemisphere | null;
  readonly plants: readonly SeasonalPlanPlantEntry[];
  readonly plantNames: PlantNameLookup;
}

/**
 * The Calendar sub-view: every active plant's configured sow/transplant/
 * harvest windows, or its explicit `noSeasonalData` marker, per
 * `SeasonalPlanResult.plants` — never a plant silently dropped, matching
 * that field's own "never omitted" contract guarantee.
 *
 * The hemisphere-unknown empty state lives HERE, not in the parent view:
 * `hemisphere: null` only ever suppresses reviewed seasonal-fact lookups
 * (`gatherTaxonomyFacts` needs a hemisphere to resolve `seasonalFact` at
 * all), which is exactly this sub-view's own data — the Rotation sub-view's
 * `family`/`priorFamily` come from the taxonomy reference itself, not from
 * a hemisphere-scoped lookup, so it keeps working and renders independently
 * of this state. Source: this package's own design decision
 * (tasks/todo.md, "P9D-UX-01 design decisions"), read against
 * `get-garden-seasonal-plan.ts`'s own header, section "HEMISPHERE".
 */
export function SeasonalCalendar({
  gardenId,
  hemisphere,
  plants,
  plantNames,
}: SeasonalCalendarProps) {
  const { t, locale } = useLocalization();

  if (hemisphere === null) {
    return (
      <Card title={t('seasonalPlan.calendar.title')}>
        <Alert tone="info" title={t('seasonalPlan.hemisphereUnknownTitle')}>
          <p>{t('seasonalPlan.hemisphereUnknownDescription')}</p>
          <p>
            <Link
              className={styles['calibrationLink']}
              href={`/application/gardens/${gardenId}/map`}
            >
              {t('seasonalPlan.hemisphereUnknownLink')}
            </Link>
          </p>
        </Alert>
      </Card>
    );
  }

  if (plants.length === 0) {
    return (
      <Card title={t('seasonalPlan.calendar.title')}>
        <p className={styles['empty']}>{t('seasonalPlan.calendar.empty')}</p>
      </Card>
    );
  }

  return (
    <Card title={t('seasonalPlan.calendar.title')}>
      <ul className={styles['list']}>
        {plants.map((plant) => {
          const name =
            resolvedPlantName(plantNames, plant.plantId) ??
            t('seasonalPlan.plantFallback', { plantId: plant.plantId });

          if (plant.seasonalFact.status === 'noSeasonalData') {
            return (
              <li key={plant.plantId} className={styles['plantRow']} data-deemphasized="true">
                <span className={styles['plantName']}>{name}</span>
                <span className={styles['note']}>{t('seasonalPlan.calendar.noSeasonalData')}</span>
              </li>
            );
          }

          const rows = timingRows(plant.seasonalFact.timing, locale);

          return (
            <li key={plant.plantId} className={styles['plantRow']}>
              <span className={styles['plantName']}>{name}</span>
              {rows.length === 0 ? (
                <span className={styles['note']}>
                  {t('seasonalPlan.calendar.noWindowsConfigured')}
                </span>
              ) : (
                <ul className={styles['windowList']}>
                  {rows.map((row) => (
                    <li key={row.labelKey} className={styles['windowRow']}>
                      <span className={styles['windowLabel']}>{t(row.labelKey)}</span>
                      <span>{t(row.rangeKey, row.rangeArgs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
