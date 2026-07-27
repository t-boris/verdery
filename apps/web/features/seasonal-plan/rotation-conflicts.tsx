'use client';

import type { SeasonalPlanRotationStatusEntry } from '@verdery/api-contracts';
import { useId, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, StatusPill } from '@/shared/ui/public';

import { describeRotationEntry, resolvedPlantName, type PlantNameLookup } from './labels';
import styles from './rotation-conflicts.module.css';

export interface RotationConflictsProps {
  readonly rotationStatus: readonly SeasonalPlanRotationStatusEntry[];
  readonly plantNames: PlantNameLookup;
}

function entryPlantName(
  entry: SeasonalPlanRotationStatusEntry,
  plantNames: PlantNameLookup,
  fallback: (plantId: string) => string,
): string {
  return resolvedPlantName(plantNames, entry.plantId) ?? fallback(entry.plantId);
}

/**
 * The Rotation sub-view: `SeasonalPlanResult.rotationStatus` split into the
 * "conflicts" this package's brief names (`withinRestPeriod: true`, shown
 * prominently with a caution pill) and every other tracked bed (available
 * behind a disclosure, never alarmed over — no warning styling on those).
 *
 * The disclosure mirrors `today-card.tsx`'s own expand/collapse pattern
 * (`aria-expanded`/`aria-controls`, the panel container always present so
 * the reference always resolves) rather than a new toggle shape.
 *
 * Source: tasks/todo.md, "P9D-UX-01 design decisions";
 * packages/api-contracts/src/seasonal-plan.ts.
 */
export function RotationConflicts({ rotationStatus, plantNames }: RotationConflictsProps) {
  const { t } = useLocalization();
  const othersPanelId = useId();
  const [othersOpen, setOthersOpen] = useState(false);

  const conflicts = rotationStatus.filter((entry) => entry.withinRestPeriod);
  const others = rotationStatus.filter((entry) => !entry.withinRestPeriod);

  const fallbackName = (plantId: string) => t('seasonalPlan.plantFallback', { plantId });

  return (
    <Card title={t('seasonalPlan.rotation.title')}>
      {conflicts.length === 0 ? (
        <p className={styles['empty']}>{t('seasonalPlan.rotation.conflictsEmpty')}</p>
      ) : (
        <ul className={styles['list']}>
          {conflicts.map((entry) => (
            <li key={entry.plantId} className={styles['conflictRow']}>
              <div className={styles['rowHeader']}>
                <span className={styles['plantName']}>
                  {entryPlantName(entry, plantNames, fallbackName)}
                </span>
                <StatusPill tone="negative" label={t('seasonalPlan.rotation.conflictBadge')} />
              </div>
              <p>{t(describeRotationEntry(entry).key, describeRotationEntry(entry).args)}</p>
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <div className={styles['othersSection']}>
          <Button
            variant="secondary"
            aria-expanded={othersOpen}
            aria-controls={othersPanelId}
            onClick={() => setOthersOpen(!othersOpen)}
          >
            {t(
              othersOpen ? 'seasonalPlan.rotation.hideOthers' : 'seasonalPlan.rotation.showOthers',
            )}
          </Button>
          <div id={othersPanelId}>
            {othersOpen &&
              (others.length === 0 ? (
                <p className={styles['empty']}>{t('seasonalPlan.rotation.othersEmpty')}</p>
              ) : (
                <ul className={styles['list']}>
                  {others.map((entry) => (
                    <li key={entry.plantId} className={styles['otherRow']}>
                      <span className={styles['plantName']}>
                        {entryPlantName(entry, plantNames, fallbackName)}
                      </span>
                      <p>
                        {t(describeRotationEntry(entry).key, describeRotationEntry(entry).args)}
                      </p>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </div>
      )}
    </Card>
  );
}
