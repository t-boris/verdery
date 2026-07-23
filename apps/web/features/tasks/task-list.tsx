'use client';

import type { TaskStatus } from '@verdery/api-contracts';
import { useState } from 'react';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { TASK_STATUSES, taskStatusLabel } from './labels';
import styles from './task-list.module.css';
import { useTasksForGarden } from './queries';
import { TaskRow } from './task-row';

export interface TaskListProps {
  readonly gardenId: string;
}

/**
 * A garden's tasks, filterable by status via `ListTasksForGarden`'s
 * `status` query parameter. An empty filter set means "every status",
 * matching the operation's own "Omit to return every status" contract.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listTasksForGarden`.
 */
export function TaskList({ gardenId }: TaskListProps) {
  const { t } = useLocalization();
  const [selectedStatuses, setSelectedStatuses] = useState<readonly TaskStatus[]>([]);
  const query = useTasksForGarden(
    gardenId,
    selectedStatuses.length === 0 ? null : selectedStatuses,
  );

  const toggleStatus = (status: TaskStatus) => {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
    );
  };

  return (
    <div className={styles['panel']}>
      <fieldset className={styles['filters']}>
        <legend>{t('tasks.filterLegend')}</legend>
        {TASK_STATUSES.map((status) => (
          <label key={status} className={styles['filterOption']}>
            <input
              type="checkbox"
              checked={selectedStatuses.includes(status)}
              onChange={() => toggleStatus(status)}
            />
            {t(taskStatusLabel(status))}
          </label>
        ))}
      </fieldset>

      {query.isPending && <p role="status">{t('tasks.loading')}</p>}

      {/* `isLoadingError`: a failed first load, with no cached data to fall
          back to — the full failure state is all there is to show. A failed
          background refetch (`isRefetchError`) instead falls through to the
          rendering below, `query.data` still holding the last successful
          result, per architecture doc section "9. Online-First Behavior". */}
      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('tasks.retry')}
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
        <p className={styles['empty']}>{t('tasks.empty')}</p>
      )}

      {!query.isLoadingError && query.data !== undefined && query.data.items.length > 0 && (
        <ul className={styles['list']}>
          {query.data.items.map((task) => (
            <TaskRow key={task.id} gardenId={gardenId} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}
