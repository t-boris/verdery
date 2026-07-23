'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { RescheduleTaskRequest, Task } from '@verdery/api-contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextField } from '@/shared/ui/public';

import styles from './task-reschedule-form.module.css';
import { useRescheduleTask } from './queries';

const rescheduleSchema = z.object({
  dueDate: z.string().trim().optional(),
  timeWindowStart: z.string().trim().optional(),
  timeWindowEnd: z.string().trim().optional(),
});

type RescheduleValues = z.infer<typeof rescheduleSchema>;

export interface TaskRescheduleFormProps {
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
 * Updates only `dueDate`/`timeWindow`, sharing `EditTask`'s underlying
 * update but kept a distinct command because rescheduling is a distinct
 * first-class user action — see the contract's own `rescheduleTask`
 * description. Only ever rendered for a `planned` or `suggested` task.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `rescheduleTask`.
 */
export function TaskRescheduleForm({ gardenId, task, onDone }: TaskRescheduleFormProps) {
  const { t } = useLocalization();
  const mutation = useRescheduleTask(gardenId, task.id);

  const { register, handleSubmit } = useForm<RescheduleValues>({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      dueDate: task.dueDate ?? '',
      timeWindowStart: toDateTimeLocalInput(task.timeWindowStart),
      timeWindowEnd: toDateTimeLocalInput(task.timeWindowEnd),
    },
  });

  const onSubmit = handleSubmit((values) => {
    const input: RescheduleTaskRequest = {
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
    };

    mutation.mutate({ input, expectedRevision: task.revision }, { onSuccess: () => onDone() });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      <TextField label={t('tasks.dueDateLabel')} type="date" {...register('dueDate')} />
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
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" busy={mutation.isPending}>
          {t('tasks.saveReschedule')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('tasks.cancelEdit')}
        </Button>
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
