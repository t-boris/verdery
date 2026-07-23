'use client';

import type { TaskStatus } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert } from '@/shared/ui/public';

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

      {query.isError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('tasks.retry')}
          </Button>
        </div>
      )}

      {query.isSuccess && query.data.items.length === 0 && (
        <p className={styles['empty']}>{t('tasks.empty')}</p>
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <ul className={styles['list']}>
          {query.data.items.map((task) => (
            <TaskRow key={task.id} gardenId={gardenId} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}
