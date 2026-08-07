'use client';

import type { Task } from '@verdery/api-contracts';
import { useId, useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { formatCalendarDay, formatInstant, useLocalization } from '@/shared/localization/public';
import {
  Button,
  CheckIcon,
  CloseIcon,
  FailureAlert,
  StatusPill,
  TextField,
  TrashIcon,
} from '@/shared/ui/public';

import {
  isTaskMutable,
  targetKindLabel,
  taskStatusLabel,
  taskStatusTone,
  urgencyLabel,
} from './labels';
import { useCompleteTask, useDeleteTask, useDismissTask, useSkipTask } from './queries';
import styles from './task-row.module.css';
import { TaskActivityView } from './task-activity-view';
import { TaskAssignForm } from './task-assign-form';
import { TaskEditForm } from './task-edit-form';
import { TaskRescheduleForm } from './task-reschedule-form';

export interface TaskRowProps {
  readonly gardenId: string;
  readonly task: Task;
}

type OpenPanel = 'none' | 'edit' | 'reschedule' | 'assign' | 'activity' | 'complete' | 'dismiss';

/**
 * One task, and every state-transition command the contract allows for it.
 * `Edit`, `Reschedule`, `Assign`, `Complete`, `Dismiss`, `Skip`, and `Delete`
 * are all gated on `isTaskMutable` (`planned`/`suggested` only) — a
 * terminal-status task (`completed`, `skipped`, `dismissed`, `deleted`)
 * offers none of them, matching every one of those operations' own "only
 * legal while `planned` or `suggested`" precondition. "Delete" calls
 * `DeleteTask`, a status transition rather than a real `DELETE`, but is
 * labeled "Delete" regardless — see `core/api/task-gateway.ts`'s module doc
 * comment.
 *
 * "Activity" (P9A-TASK-01) is the one toggle NOT gated on `isTaskMutable`:
 * the shared activity history is a read, open to every garden role
 * regardless of the task's status — see `listTaskActivity`'s own contract
 * description.
 *
 * Current assignment (`assignedProfileId`) is always shown, regardless of
 * status — "Unassigned" is itself informative, not just an assigned target.
 * Completion attribution (`completedByProfileId`) is shown only when it
 * usefully differs from the assignee — see the `completedBy` block below.
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
  const { t, locale } = useLocalization();
  const editPanelId = useId();
  const reschedulePanelId = useId();
  const assignPanelId = useId();
  const activityPanelId = useId();
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
        <h2 className={styles['title']}>{task.title}</h2>
        <StatusPill tone={taskStatusTone(task.status)} label={t(taskStatusLabel(task.status))} />
        <span className={styles['meta']}>{t(urgencyLabel(task.urgency))}</span>
        <span className={styles['meta']}>{t(targetKindLabel(task.targetKind))}</span>
      </div>

      {task.notes !== null && <p className={styles['notes']}>{task.notes}</p>}

      <div className={styles['meta']}>
        {/* The outcome-history linkage (P7-WEB-01): a `suggested` task carries
            the recommendation candidate it was converted from, so the tasks
            list is where a converted Today item's trail continues. */}
        {task.originRecommendationId !== null && <span>{t('tasks.fromRecommendation')}</span>}
        {task.dueDate !== null && (
          <span>
            {t('tasks.dueDateDisplay', { date: formatCalendarDay(task.dueDate, locale) })}
          </span>
        )}
        {task.completedAt !== null && (
          <span>
            {t('tasks.completedAtDisplay', { date: formatInstant(task.completedAt, locale) })}
          </span>
        )}
        <span>
          {task.assignedProfileId === null
            ? t('tasks.unassigned')
            : t('tasks.assignedToDisplay', { profileId: task.assignedProfileId })}
        </span>
        {/* Shown only when it usefully differs from the assignee — including
            when the task was never assigned at all (`assignedProfileId` is
            `null`, `completedByProfileId` is not), the same `!==` comparison
            catching both cases. */}
        {task.completedByProfileId !== null &&
          task.completedByProfileId !== task.assignedProfileId && (
            <span>{t('tasks.completedByDisplay', { profileId: task.completedByProfileId })}</span>
          )}
      </div>

      {mutable && (
        <div className={styles['actions']}>
          <Button
            variant="secondary"
            aria-expanded={openPanel === 'edit'}
            aria-controls={editPanelId}
            onClick={() => setOpenPanel(openPanel === 'edit' ? 'none' : 'edit')}
          >
            {t('tasks.edit')}
          </Button>
          <Button
            variant="secondary"
            aria-expanded={openPanel === 'reschedule'}
            aria-controls={reschedulePanelId}
            onClick={() => setOpenPanel(openPanel === 'reschedule' ? 'none' : 'reschedule')}
          >
            {t('tasks.reschedule')}
          </Button>
          <Button
            variant="secondary"
            aria-expanded={openPanel === 'assign'}
            aria-controls={assignPanelId}
            onClick={() => setOpenPanel(openPanel === 'assign' ? 'none' : 'assign')}
          >
            {t('tasks.assign')}
          </Button>
          <Button
            variant="primary"
            aria-expanded={openPanel === 'complete'}
            disabled={!isOnline}
            onClick={() => setOpenPanel(openPanel === 'complete' ? 'none' : 'complete')}
          >
            <CheckIcon />
            {t('tasks.complete')}
          </Button>
          <Button
            variant="secondary"
            aria-expanded={openPanel === 'dismiss'}
            disabled={!isOnline}
            onClick={() => setOpenPanel(openPanel === 'dismiss' ? 'none' : 'dismiss')}
          >
            <CloseIcon />
            {t('tasks.dismiss')}
          </Button>
          <Button
            variant="secondary"
            busy={skipMutation.isPending}
            disabled={!isOnline}
            onClick={onSkip}
          >
            {t('tasks.skip')}
          </Button>
        </div>
      )}

      <div className={styles['actions']}>
        <Button
          variant="secondary"
          aria-expanded={openPanel === 'activity'}
          aria-controls={activityPanelId}
          onClick={() => setOpenPanel(openPanel === 'activity' ? 'none' : 'activity')}
        >
          {t('tasks.activity.toggle')}
        </Button>
      </div>

      <div id={editPanelId}>
        {mutable && openPanel === 'edit' && (
          <TaskEditForm gardenId={gardenId} task={task} onDone={() => setOpenPanel('none')} />
        )}
      </div>
      <div id={reschedulePanelId}>
        {mutable && openPanel === 'reschedule' && (
          <TaskRescheduleForm gardenId={gardenId} task={task} onDone={() => setOpenPanel('none')} />
        )}
      </div>
      <div id={assignPanelId}>
        {mutable && openPanel === 'assign' && (
          <TaskAssignForm gardenId={gardenId} task={task} onDone={() => setOpenPanel('none')} />
        )}
      </div>
      <div id={activityPanelId}>
        {openPanel === 'activity' && <TaskActivityView gardenId={gardenId} taskId={task.id} />}
      </div>

      {mutable && openPanel === 'complete' && (
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
            <CheckIcon />
            {t('tasks.complete')}
          </Button>
        </div>
      )}
      {mutable && openPanel === 'dismiss' && (
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
            <CloseIcon />
            {t('tasks.dismiss')}
          </Button>
        </div>
      )}

      {completeMutation.isError && <FailureAlert failure={completeMutation.error.failure} />}
      {dismissMutation.isError && <FailureAlert failure={dismissMutation.error.failure} />}
      {skipMutation.isError && <FailureAlert failure={skipMutation.error.failure} />}
      {deleteMutation.isError && <FailureAlert failure={deleteMutation.error.failure} />}
      {mutable && (
        <div className={styles['dangerZone']}>
          <Button
            variant="destructive"
            busy={deleteMutation.isPending}
            disabled={!isOnline}
            onClick={onDelete}
          >
            <TrashIcon />
            {t('tasks.delete')}
          </Button>
        </div>
      )}
    </li>
  );
}
