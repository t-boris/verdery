'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateManualTaskRequest, TaskTargetKind } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useIsOnline } from '@/core/connectivity/public';
import { useRecoverableDraft } from '@/core/drafts/public';
import { useLocalization } from '@/shared/localization/public';
import {
  PlusIcon,
  CalendarIcon,
  Button,
  CommandSurface,
  FailureAlert,
  RecoveredDraftNotice,
  MapIcon,
  TagIcon,
  StaleIndicator,
  TextField,
} from '@/shared/ui/public';

import styles from './create-manual-task-form.module.css';
import { TASK_TARGET_KINDS, TASK_URGENCIES, targetKindLabel, urgencyLabel } from './labels';
import { useCreateManualTask } from './queries';

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().optional(),
    targetKind: z.enum(['garden', 'garden_area', 'plant']),
    targetId: z.string().trim().optional(),
    dueDate: z.string().trim().optional(),
    timeWindowStart: z.string().trim().optional(),
    timeWindowEnd: z.string().trim().optional(),
    urgency: z.enum(['low', 'normal', 'high', 'urgent']),
    originObservationId: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.targetKind !== 'garden' && (values.targetId ?? '') === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'required for this target kind',
      });
    }
  });

type CreateTaskValues = z.infer<typeof createTaskSchema>;

const DEFAULT_VALUES: CreateTaskValues = { title: '', targetKind: 'garden', urgency: 'normal' };

/**
 * Local-draft schema version for this form — see
 * `core/drafts/local-draft-store.ts`'s doc comment for the versioning
 * convention.
 */
const CREATE_MANUAL_TASK_DRAFT_SCHEMA_VERSION = 1;

function buildTarget(values: CreateTaskValues): CreateManualTaskRequest['target'] {
  if (values.targetKind === 'garden') {
    return { kind: 'garden' };
  }
  const targetId = values.targetId ?? '';
  return values.targetKind === 'garden_area'
    ? { kind: 'garden_area', gardenAreaMapObjectId: targetId }
    : { kind: 'plant', plantId: targetId };
}

function buildTimeWindow(values: CreateTaskValues): CreateManualTaskRequest['timeWindow'] {
  if (values.timeWindowStart === '' && values.timeWindowEnd === '') {
    return undefined;
  }
  return {
    ...(values.timeWindowStart === undefined || values.timeWindowStart === ''
      ? {}
      : { start: new Date(values.timeWindowStart).toISOString() }),
    ...(values.timeWindowEnd === undefined || values.timeWindowEnd === ''
      ? {}
      : { end: new Date(values.timeWindowEnd).toISOString() }),
  };
}

/**
 * Creates a `source: 'manual'` task — the only kind this API creates.
 *
 * `targetId` (`gardenAreaMapObjectId`/`plantId` depending on `targetKind`)
 * is a plain text id field, the same documented map-object-picker fallback
 * `features/plants/add-plant-form.tsx` uses and for the same reason: a
 * feature reaching into `features/map` for a real picker would violate
 * `architecture/web-application-design.md`, section "20. Dependency Rules".
 *
 * Wired to `core/drafts`' recoverable-draft mechanism (P5-WEB-01): field
 * values are persisted locally while the form is dirty and restored on a
 * later mount, e.g. after an accidental reload. Submission is disabled
 * while the browser is offline rather than queued — see
 * `core/drafts/use-recoverable-draft.ts`'s and
 * `shared/ui/stale-indicator.tsx`'s doc comments for the reasoning.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `createManualTask`.
 */
export function CreateManualTaskForm({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const mutation = useCreateManualTask(gardenId);
  const isOnline = useIsOnline();
  const [activePart, setActivePart] = useState<string | null>(null);

  const { register, handleSubmit, formState, watch, reset, setValue } = useForm<CreateTaskValues>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: DEFAULT_VALUES,
    shouldUnregister: true,
  });

  const targetKind = watch('targetKind');
  const currentValues = watch();

  const draft = useRecoverableDraft<CreateTaskValues>({
    draftType: 'tasks.createManualTask',
    scopeKey: gardenId,
    schemaVersion: CREATE_MANUAL_TASK_DRAFT_SCHEMA_VERSION,
    payload: currentValues,
    hasUnsavedInput: formState.isDirty,
  });

  useEffect(() => {
    if (draft.recoveredPayload === null) {
      return;
    }
    reset(draft.recoveredPayload);
    draft.acknowledgeRecovered();
    // Runs once, when `draft.recoveredPayload` transitions from `null` to a
    // real value right after mount — `reset`/`acknowledgeRecovered` are
    // intentionally not listed; see `add-plant-form.tsx`'s identical effect
    // for the full reasoning.
  }, [draft.recoveredPayload]);

  const discardRecoveredDraft = () => {
    draft.dismissRecovered();
    reset(DEFAULT_VALUES);
  };

  const togglePart = (part: string) => {
    setActivePart((current) => (current === part ? null : part));
  };

  const onSubmit = handleSubmit((values) => {
    const timeWindow = buildTimeWindow(values);
    const input: CreateManualTaskRequest = {
      target: buildTarget(values),
      title: values.title,
      urgency: values.urgency,
      ...(values.notes === undefined || values.notes === '' ? {} : { notes: values.notes }),
      ...(values.dueDate === undefined || values.dueDate === '' ? {} : { dueDate: values.dueDate }),
      ...(timeWindow === undefined ? {} : { timeWindow }),
      ...(values.originObservationId === undefined || values.originObservationId === ''
        ? {}
        : { originObservationId: values.originObservationId }),
    };

    mutation.mutate(input, {
      onSuccess: () => {
        reset();
        draft.clearDraft();
      },
    });
  });

  return (
    <CommandSurface className={styles['form']} onCommit={() => void onSubmit()}>
      {draft.recovered && <RecoveredDraftNotice onDiscard={discardRecoveredDraft} />}
      <div className={styles['commandRow']}>
        <TextField
          label={t('tasks.titleLabel')}
          maxLength={200}
          error={formState.errors.title === undefined ? undefined : t('tasks.titleRequired')}
          {...register('title')}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={!isOnline}
          iconOnly
          aria-label={t('tasks.createSubmit')}
          title={t('tasks.createSubmit')}
        >
          <PlusIcon />
        </Button>
      </div>

      <div className={styles['quickActions']}>
        <Button
          variant="secondary"
          aria-pressed={activePart === 'target'}
          onClick={() => togglePart('target')}
        >
          <MapIcon />
          {t('tasks.targetKindLabel')}
        </Button>
        <Button
          variant="secondary"
          aria-pressed={activePart === 'timing'}
          onClick={() => togglePart('timing')}
        >
          <CalendarIcon />
          {t('tasks.dueDateLabel')}
        </Button>
        <Button
          variant="secondary"
          aria-pressed={activePart === 'notes'}
          onClick={() => togglePart('notes')}
        >
          <TagIcon />
          {t('tasks.notesLabel')}
        </Button>
      </div>

      <div className={styles['canvas']}>
        {activePart === 'target' && (
          <div className={styles['editorGrid']}>
            <div className={styles['choiceField']}>
              <span>{t('tasks.targetKindLabel')}</span>
              <div className={styles['choices']}>
                {TASK_TARGET_KINDS.map((kind: TaskTargetKind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={targetKind === kind}
                    onClick={() => setValue('targetKind', kind, { shouldDirty: true })}
                  >
                    {t(targetKindLabel(kind))}
                  </button>
                ))}
              </div>
            </div>
            {targetKind !== 'garden' && (
              <TextField
                label={
                  targetKind === 'plant'
                    ? t('tasks.targetPlantIdLabel')
                    : t('tasks.targetGardenAreaIdLabel')
                }
                error={
                  formState.errors.targetId === undefined ? undefined : t('tasks.targetIdRequired')
                }
                {...register('targetId')}
              />
            )}
          </div>
        )}
        {activePart === 'timing' && (
          <div className={styles['editorGrid']}>
            <TextField label={t('tasks.dueDateLabel')} type="date" {...register('dueDate')} />
            <div className={styles['choiceField']}>
              <span>{t('tasks.urgencyLabel')}</span>
              <div className={styles['choices']}>
                {TASK_URGENCIES.map((urgency) => (
                  <button
                    key={urgency}
                    type="button"
                    aria-pressed={currentValues.urgency === urgency}
                    onClick={() => setValue('urgency', urgency, { shouldDirty: true })}
                  >
                    {t(urgencyLabel(urgency))}
                  </button>
                ))}
              </div>
            </div>
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
        )}
        {activePart === 'notes' && (
          <div className={styles['editorGrid']}>
            <TextField label={t('tasks.notesLabel')} {...register('notes')} />
            <TextField
              label={t('tasks.originObservationIdLabel')}
              {...register('originObservationId')}
            />
          </div>
        )}
      </div>

      <StaleIndicator />
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </CommandSurface>
  );
}
