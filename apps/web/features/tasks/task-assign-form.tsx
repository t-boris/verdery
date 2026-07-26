'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AssignTaskRequest, Task } from '@verdery/api-contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select } from '@/shared/ui/public';

import { useAssignableMembers } from './assignable-members';
import { assignableMemberRoleLabel } from './labels';
import styles from './task-assign-form.module.css';
import { useAssignTask } from './queries';

/** The Select option value standing in for `assigneeProfileId: null` — a real profileId is never empty. */
const UNASSIGNED_VALUE = '';

const assignTaskSchema = z.object({
  assigneeProfileId: z.string().trim(),
});

type AssignTaskValues = z.infer<typeof assignTaskSchema>;

export interface TaskAssignFormProps {
  readonly gardenId: string;
  readonly task: Task;
  readonly onDone: () => void;
}

/**
 * Assign/reassign/unassign form for `AssignTaskRequest`, only ever rendered
 * for a `planned` or `suggested` task — `task-row.tsx` gates the "Assign"
 * action on `isTaskMutable`, the same precondition `assignTask` itself
 * shares with every other task mutation.
 *
 * The picker lists only active `editGardenContent`-holding members
 * (`useAssignableMembers`, filtered by `selectAssignableMembers`), because
 * the server rejects any other target as an invalid parameter rather than a
 * permission failure — see `assign-task.ts`'s `ineligibleAssigneeError`. A
 * stale `expectedRevision` surfaces through the same generic
 * `FailureAlert`/`error.staleRevision` path `task-edit-form.tsx` and
 * `task-reschedule-form.tsx` already use for their own revision conflicts —
 * no special-cased conflict UI here either.
 *
 * There is no display name to show for a member: `GardenMember` carries only
 * `profileId` and `role` (`GardenMember`'s own schema doc explains why), so
 * each option is labeled by role and the raw profile id, the same
 * raw-identifier convention `FailureAlert` already uses for a correlation id.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `assignTask`.
 */
export function TaskAssignForm({ gardenId, task, onDone }: TaskAssignFormProps) {
  const { t } = useLocalization();
  const membersQuery = useAssignableMembers(gardenId);
  const mutation = useAssignTask(gardenId, task.id);

  const { register, handleSubmit } = useForm<AssignTaskValues>({
    resolver: zodResolver(assignTaskSchema),
    defaultValues: { assigneeProfileId: task.assignedProfileId ?? UNASSIGNED_VALUE },
  });

  const onSubmit = handleSubmit((values) => {
    const input: AssignTaskRequest = {
      assigneeProfileId:
        values.assigneeProfileId === UNASSIGNED_VALUE ? null : values.assigneeProfileId,
    };
    mutation.mutate({ input, expectedRevision: task.revision }, { onSuccess: () => onDone() });
  });

  const options = [
    { value: UNASSIGNED_VALUE, label: t('tasks.assign.noneOption') },
    ...(membersQuery.data ?? []).map((member) => ({
      value: member.profileId,
      label: t('tasks.assign.optionLabel', {
        role: t(assignableMemberRoleLabel(member.role)),
        profileId: member.profileId,
      }),
    })),
  ];

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      {membersQuery.isPending && <p role="status">{t('tasks.assign.loadingMembers')}</p>}
      {membersQuery.isError && <FailureAlert failure={membersQuery.error.failure} />}
      {membersQuery.data !== undefined && (
        <Select
          label={t('tasks.assign.memberLabel')}
          options={options}
          {...register('assigneeProfileId')}
        />
      )}
      <div className={styles['actions']}>
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={membersQuery.data === undefined}
        >
          {t('tasks.assign.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('tasks.cancelEdit')}
        </Button>
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
