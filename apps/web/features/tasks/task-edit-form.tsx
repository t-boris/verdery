'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { EditTaskRequest, Task, TaskUrgency } from '@verdery/api-contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { TASK_URGENCIES, urgencyLabel } from './labels';
import styles from './task-edit-form.module.css';
import { useEditTask } from './queries';

const editTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
  timeWindowStart: z.string().trim().optional(),
  timeWindowEnd: z.string().trim().optional(),
  urgency: z.enum(['low', 'normal', 'high', 'urgent']),
  recurrenceRule: z.string().trim().optional(),
});

type EditTaskValues = z.infer<typeof editTaskSchema>;

export interface TaskEditFormProps {
  readonly gardenId: string;
  readonly task: Task;
  readonly onDone: () => void;
}

/** `datetime-local` has no timezone of its own; this trims an ISO timestamp down to what that input accepts. */
function toDateTimeLocalInput(timestamp: string | null): string {
  if (timestamp === null) {
    return '';
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

/**
 * Edit form for `EditTaskRequest`, only ever rendered for a `planned` or
 * `suggested` task — `task-row.tsx` gates the "Edit" action on
 * `isTaskMutable`. Every property is optional on the wire; an omitted one
 * leaves the current value unchanged and an explicit `null` clears it, the
 * same convention `features/plants/plant-details-form.tsx` follows.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `editTask`.
 */
export function TaskEditForm({ gardenId, task, onDone }: TaskEditFormProps) {
  const { t } = useLocalization();
  const mutation = useEditTask(gardenId, task.id);

  const { register, handleSubmit, formState } = useForm<EditTaskValues>({
    resolver: zodResolver(editTaskSchema),
    defaultValues: {
      title: task.title,
      notes: task.notes ?? '',
      dueDate: task.dueDate ?? '',
      timeWindowStart: toDateTimeLocalInput(task.timeWindowStart),
      timeWindowEnd: toDateTimeLocalInput(task.timeWindowEnd),
      urgency: task.urgency,
      recurrenceRule: task.recurrenceRule ?? '',
    },
  });

  const onSubmit = handleSubmit((values) => {
    const input: EditTaskRequest = {
      title: values.title,
      urgency: values.urgency,
      notes: values.notes === undefined || values.notes === '' ? null : values.notes,
      dueDate: values.dueDate === undefined || values.dueDate === '' ? null : values.dueDate,
      timeWindow: {
        start:
          values.timeWindowStart === undefined || values.timeWindowStart === ''
            ? null
            : new Date(values.timeWindowStart).toISOString(),
        end:
          values.timeWindowEnd === undefined || values.timeWindowEnd === ''
            ? null
            : new Date(values.timeWindowEnd).toISOString(),
      },
      recurrenceRule:
        values.recurrenceRule === undefined || values.recurrenceRule === ''
          ? null
          : values.recurrenceRule,
    };

    mutation.mutate({ input, expectedRevision: task.revision }, { onSuccess: () => onDone() });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      <TextField
        label={t('tasks.titleLabel')}
        maxLength={200}
        error={formState.errors.title === undefined ? undefined : t('tasks.titleRequired')}
        {...register('title')}
      />
      <TextField label={t('tasks.notesLabel')} {...register('notes')} />
      <div className={styles['row']}>
        <TextField label={t('tasks.dueDateLabel')} type="date" {...register('dueDate')} />
        <Select
          label={t('tasks.urgencyLabel')}
          options={TASK_URGENCIES.map((urgency: TaskUrgency) => ({
            value: urgency,
            label: t(urgencyLabel(urgency)),
          }))}
          {...register('urgency')}
        />
      </div>
      <div className={styles['row']}>
        <TextField
          label={t('tasks.timeWindowStartLabel')}
          type="datetime-local"
          {...register('timeWindowStart')}
        />
        <TextField
          label={t('tasks.timeWindowEndLabel')}
          type="datetime-local"
          {...register('timeWindowEnd')}
        />
      </div>
      <TextField label={t('tasks.recurrenceRuleLabel')} {...register('recurrenceRule')} />
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" busy={mutation.isPending}>
          {t('tasks.saveEdit')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('tasks.cancelEdit')}
        </Button>
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
