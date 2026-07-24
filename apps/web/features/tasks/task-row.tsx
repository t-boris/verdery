'use client';

import type { Task } from '@verdery/api-contracts';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill, TextField } from '@/shared/ui/public';

import {
  isTaskMutable,
  targetKindLabel,
  taskStatusLabel,
  taskStatusTone,
  urgencyLabel,
} from './labels';
import { useCompleteTask, useDeleteTask, useDismissTask, useSkipTask } from './queries';
import styles from './task-row.module.css';
import { TaskEditForm } from './task-edit-form';
import { TaskRescheduleForm } from './task-reschedule-form';

export interface TaskRowProps {
  readonly gardenId: string;
  readonly task: Task;
}

type OpenPanel = 'none' | 'edit' | 'reschedule';

/**
 * One task, and every state-transition command the contract allows for it.
 * `Edit`, `Reschedule`, `Complete`, `Dismiss`, `Skip`, and `Delete` are all
 * gated on `isTaskMutable` (`planned`/`suggested` only) — a terminal-status
 * task (`completed`, `skipped`, `dismissed`, `deleted`) offers none of them,
 * matching every one of those operations' own "only legal while `planned`
 * or `suggested`" precondition. "Delete" calls `DeleteTask`, a status
 * transition rather than a real `DELETE`, but is labeled "Delete"
 * regardless — see `core/api/task-gateway.ts`'s module doc comment.
 *
 * `Complete`/`Dismiss`/`Skip`/`Delete` are additionally disabled while the
 * browser is offline (P5-WEB-01 follow-up), the same `disabled={!isOnline}`
 * pattern `create-manual-task-form.tsx` uses: each is a simple
 * state-transition command, not free-text input a user could lose, so a
 * disabled button is sufficient without local-draft persistence — see
 * `map-editor-commit.ts`'s own offline gate for pure state-transition
 * commands for the identical reasoning. The parent `TaskList` already
 * renders a `StaleIndicator` above every row, so no second one is needed
 * here.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Tasks`.
 */
export function TaskRow({ gardenId, task }: TaskRowProps) {
  const { t } = useLocalization();
  const [openPanel, setOpenPanel] = useState<OpenPanel>('none');
  const [completionNote, setCompletionNote] = useState('');
  const [dismissReason, setDismissReason] = useState('');
  const isOnline = useIsOnline();

  const completeMutation = useCompleteTask(gardenId, task.id);
  const dismissMutation = useDismissTask(gardenId, task.id);
  const skipMutation = useSkipTask(gardenId, task.id);
  const deleteMutation = useDeleteTask(gardenId, task.id);

  const mutable = isTaskMutable(task.status);

  const onComplete = () => {
    completeMutation.mutate({
      input: completionNote.trim() === '' ? {} : { completionNote: completionNote.trim() },
      expectedRevision: task.revision,
    });
  };

  const onDismiss = () => {
    dismissMutation.mutate({
      input: dismissReason.trim() === '' ? {} : { reason: dismissReason.trim() },
      expectedRevision: task.revision,
    });
  };

  const onSkip = () => skipMutation.mutate(task.revision);

  const onDelete = () => {
    if (globalThis.confirm(t('tasks.deleteConfirm'))) {
      deleteMutation.mutate(task.revision);
    }
  };

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <span className={styles['title']}>{task.title}</span>
        <StatusPill tone={taskStatusTone(task.status)} label={t(taskStatusLabel(task.status))} />
        <span className={styles['meta']}>{t(urgencyLabel(task.urgency))}</span>
        <span className={styles['meta']}>{t(targetKindLabel(task.targetKind))}</span>
      </div>

      {task.notes !== null && <p className={styles['notes']}>{task.notes}</p>}

      <div className={styles['meta']}>
        {task.dueDate !== null && <span>{t('tasks.dueDateDisplay', { date: task.dueDate })}</span>}
        {task.completedAt !== null && (
          <span>
            {t('tasks.completedAtDisplay', { date: new Date(task.completedAt).toLocaleString() })}
          </span>
        )}
      </div>

      {mutable && (
        <div className={styles['actions']}>
          <Button
            variant="secondary"
            onClick={() => setOpenPanel(openPanel === 'edit' ? 'none' : 'edit')}
          >
            {t('tasks.edit')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setOpenPanel(openPanel === 'reschedule' ? 'none' : 'reschedule')}
          >
            {t('tasks.reschedule')}
          </Button>
          <Button
            variant="secondary"
            busy={skipMutation.isPending}
            disabled={!isOnline}
            onClick={onSkip}
          >
            {t('tasks.skip')}
          </Button>
          <Button
            variant="secondary"
            busy={deleteMutation.isPending}
            disabled={!isOnline}
            onClick={onDelete}
          >
            {t('tasks.delete')}
          </Button>
        </div>
      )}

      {mutable && openPanel === 'edit' && (
        <TaskEditForm gardenId={gardenId} task={task} onDone={() => setOpenPanel('none')} />
      )}
      {mutable && openPanel === 'reschedule' && (
        <TaskRescheduleForm gardenId={gardenId} task={task} onDone={() => setOpenPanel('none')} />
      )}

      {mutable && (
        <div className={styles['completeRow']}>
          <TextField
            label={t('tasks.completionNoteLabel')}
            value={completionNote}
            onChange={(event) => setCompletionNote(event.target.value)}
          />
          <Button
            variant="primary"
            busy={completeMutation.isPending}
            disabled={!isOnline}
            onClick={onComplete}
          >
            {t('tasks.complete')}
          </Button>
        </div>
      )}
      {mutable && (
        <div className={styles['completeRow']}>
          <TextField
            label={t('tasks.dismissReasonLabel')}
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
          />
          <Button
            variant="secondary"
            busy={dismissMutation.isPending}
            disabled={!isOnline}
            onClick={onDismiss}
          >
            {t('tasks.dismiss')}
          </Button>
        </div>
      )}

      {completeMutation.isError && <FailureAlert failure={completeMutation.error.failure} />}
      {dismissMutation.isError && <FailureAlert failure={dismissMutation.error.failure} />}
      {skipMutation.isError && <FailureAlert failure={skipMutation.error.failure} />}
      {deleteMutation.isError && <FailureAlert failure={deleteMutation.error.failure} />}
    </li>
  );
}
