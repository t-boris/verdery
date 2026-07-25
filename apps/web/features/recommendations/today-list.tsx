'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import styles from './today-list.module.css';
import { useTodayRecommendations } from './queries';
import { TodayCard } from './today-card';

export interface TodayListProps {
  readonly gardenId: string;
}

/**
 * The garden's Today set: the small prioritized list `GetTodayRecommendations`
 * returns, already ordered by the server's re-derived priority score — this
 * component never re-sorts it. Loading, first-load failure, stale-data, and
 * refetch-failure handling mirror `features/tasks/task-list.tsx` exactly.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `getTodayRecommendations`; architecture/web-application-design.md,
 * section "9. Online-First Behavior".
 */
export function TodayList({ gardenId }: TodayListProps) {
  const { t } = useLocalization();
  const query = useTodayRecommendations(gardenId);

  return (
    <div className={styles['panel']}>
      {query.isPending && <p role="status">{t('today.loading')}</p>}

      {/* `isLoadingError`: a failed first load, with no cached data to fall
          back to — the full failure state is all there is to show. A failed
          background refetch (`isRefetchError`) instead falls through to the
          rendering below, `query.data` still holding the last successful
          result, per architecture doc section "9. Online-First Behavior". */}
      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('today.retry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError && query.data !== undefined && query.data.items.length === 0 && (
        <p className={styles['empty']}>{t('today.empty')}</p>
      )}

      {!query.isLoadingError && query.data !== undefined && query.data.items.length > 0 && (
        <ul className={styles['list']}>
          {query.data.items.map((item) => (
            <TodayCard key={item.id} gardenId={gardenId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
