'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { ObservationEntry } from './observation-entry';
import styles from './observation-timeline.module.css';
import { useObservationsForGarden, useObservationsForPlant } from './queries';

export interface ObservationTimelineProps {
  readonly gardenId: string;
  /** Scopes the timeline to one plant's history when given; the garden's full history otherwise. */
  readonly plantId?: string;
}

/**
 * Chronological observation history — either a garden's full history
 * (`ListObservationsForGarden`) or one plant's (`ListObservationsForPlant`),
 * both already ordered most-recently-observed-first by the API. Reused by
 * both `app/application/gardens/[gardenId]/observations/page.tsx` and
 * `app/application/gardens/[gardenId]/plants/[plantId]/page.tsx`, which
 * compose it alongside `features/plants`' own exports — a route composing
 * two features is the intended seam; a feature importing another feature is
 * not (`architecture/web-application-design.md`, section "20. Dependency Rules").
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, operations
 * `listObservationsForGarden`, `listObservationsForPlant`.
 */
export function ObservationTimeline({ gardenId, plantId }: ObservationTimelineProps) {
  const { t } = useLocalization();
  const gardenQuery = useObservationsForGarden(gardenId, { enabled: plantId === undefined });
  const plantQuery = useObservationsForPlant(gardenId, plantId ?? '', {
    enabled: plantId !== undefined,
  });
  const query = plantId === undefined ? gardenQuery : plantQuery;

  if (query.isPending) {
    return <p role="status">{t('observations.loading')}</p>;
  }

  // `isLoadingError`: a failed first load, with no cached data to fall back
  // to — the full failure state is all there is to show. A failed
  // background refetch (`isRefetchError`) instead falls through to the
  // rendering below, `query.data` still holding the last successful result,
  // per architecture doc section "9. Online-First Behavior" ("Existing
  // loaded data remains visible with a stale indicator").
  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('observations.retry')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      {query.data.items.length === 0 ? (
        <p className={styles['empty']}>{t('observations.empty')}</p>
      ) : (
        <ul className={styles['list']}>
          {query.data.items.map((observation) => (
            <ObservationEntry
              key={observation.id}
              gardenId={gardenId}
              plantId={plantId ?? null}
              observation={observation}
            />
          ))}
        </ul>
      )}
    </>
  );
}
