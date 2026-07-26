'use client';

import { formatCalendarDay, formatInstant, useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert } from '@/shared/ui/public';

import { taskActivityCommandLabel, taskStatusLabel } from './labels';
import styles from './task-activity-view.module.css';
import { useTaskActivity } from './queries';

export interface TaskActivityViewProps {
  readonly gardenId: string;
  readonly taskId: string;
}

/**
 * A task's shared activity history (P9A-TASK-01, `GetTaskActivity`) —
 * "who did what," oldest first, read verbatim from `TaskActivityEntry`
 * without inventing any field the endpoint does not return: no display
 * name (`actorProfileId`/`assignedProfileId` are raw ids — see
 * `task-assign-form.tsx`'s doc comment for why), and `status`/`dueDate` are
 * shown only for the entries that actually carry them, per the schema's own
 * "Populated only for the entries that changed ..." description.
 *
 * Only ever mounted while its toggle panel is open in `task-row.tsx` — the
 * same mount-on-demand pattern `TaskEditForm`/`TaskRescheduleForm` already
 * use — so the fetch happens only when a reader actually opens it.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listTaskActivity`.
 */
export function TaskActivityView({ gardenId, taskId }: TaskActivityViewProps) {
  const { t, locale } = useLocalization();
  const query = useTaskActivity(gardenId, taskId);

  return (
    <div className={styles['panel']}>
      {query.isPending && <p role="status">{t('tasks.activity.loading')}</p>}

      {query.isError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('tasks.retry')}
          </Button>
        </div>
      )}

      {query.data !== undefined && query.data.items.length === 0 && (
        <p className={styles['empty']}>{t('tasks.activity.empty')}</p>
      )}

      {query.data !== undefined && query.data.items.length > 0 && (
        <ol className={styles['timeline']}>
          {query.data.items.map((entry) => (
            <li key={entry.revision} className={styles['entry']}>
              <div className={styles['entryHeader']}>
                <span>{t(taskActivityCommandLabel(entry.commandType))}</span>
                <span className={styles['entryDate']}>
                  {formatInstant(entry.recordedAt, locale)}
                </span>
              </div>
              <div className={styles['entryMeta']}>
                <span>{t('tasks.activity.actorDisplay', { profileId: entry.actorProfileId })}</span>
                {entry.status !== null && (
                  <span>
                    {t('tasks.activity.statusDisplay', {
                      status: t(taskStatusLabel(entry.status)),
                    })}
                  </span>
                )}
                {entry.dueDate !== null && (
                  <span>
                    {t('tasks.activity.dueDateDisplay', {
                      date: formatCalendarDay(entry.dueDate, locale),
                    })}
                  </span>
                )}
                {entry.commandType === 'assignTask' &&
                  (entry.assignedProfileId === null ? (
                    <span>{t('tasks.activity.unassignedDisplay')}</span>
                  ) : (
                    <span>
                      {t('tasks.activity.assignedDisplay', { profileId: entry.assignedProfileId })}
                    </span>
                  ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
