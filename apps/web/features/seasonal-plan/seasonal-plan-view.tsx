'use client';

import { useMemo } from 'react';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { plantNameLookup } from './labels';
import { useActivePlantNamesLookup, useSeasonalPlan } from './queries';
import { RotationConflicts } from './rotation-conflicts';
import { SeasonalCalendar } from './seasonal-calendar';
import styles from './seasonal-plan-view.module.css';

export interface SeasonalPlanViewProps {
  readonly gardenId: string;
}

/**
 * The Seasonal plan section's root: `GetGardenSeasonalPlan`'s loading,
 * first-load-failure, stale-data, and refetch-failure handling mirrors
 * `features/recommendations/today-list.tsx` exactly, per this package's own
 * "do not invent a new one" instruction. Once data is available, composes
 * the Calendar and Rotation sub-views as two always-visible sections rather
 * than a switchable tab pair — this codebase has no existing in-page tab
 * widget to mirror (only top-level route tabs, `application-shell.tsx`'s
 * own `<nav>`), and inventing one would be exactly the kind of new
 * interaction pattern the brief's ground rules ask this package to avoid.
 * Two labeled `Card` sections is the more conservative, already-established
 * shape (`app/application/gardens/[gardenId]/page.tsx`'s own stack of
 * sibling sections).
 *
 * The active-plant-name lookup is fetched alongside the plan itself and
 * passed down read-only — `SeasonalPlanResult` carries no display name of
 * its own (see `queries.ts`'s own header) — but its loading/error state is
 * never allowed to blank the page: a plant whose name has not resolved yet
 * simply falls back to `seasonalPlan.plantFallback` inside the child
 * components, the same "never a dead end" posture the hemisphere-unknown
 * state takes.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `SeasonalPlan`;
 * architecture/web-application-design.md, section "9. Online-First Behavior".
 */
export function SeasonalPlanView({ gardenId }: SeasonalPlanViewProps) {
  const { t } = useLocalization();
  const query = useSeasonalPlan(gardenId);
  const plantNamesQuery = useActivePlantNamesLookup(gardenId);
  const plantNames = useMemo(() => plantNameLookup(plantNamesQuery.data), [plantNamesQuery.data]);

  return (
    <div className={styles['panel']}>
      {query.isPending && <p role="status">{t('seasonalPlan.loading')}</p>}

      {/* `isLoadingError`: a failed first load, with no cached data to fall
          back to — the full failure state is all there is to show. A failed
          background refetch (`isRefetchError`) instead falls through to the
          rendering below, `query.data` still holding the last successful
          result, per architecture doc section "9. Online-First Behavior". */}
      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('seasonalPlan.retry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError && query.data !== undefined && (
        <>
          <SeasonalCalendar
            gardenId={gardenId}
            hemisphere={query.data.hemisphere}
            plants={query.data.plants}
            plantNames={plantNames}
          />
          <RotationConflicts rotationStatus={query.data.rotationStatus} plantNames={plantNames} />
        </>
      )}
    </div>
  );
}
