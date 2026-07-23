'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { RecordObservationRequest } from '@verdery/api-contracts';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useIsOnline } from '@/core/connectivity/public';
import { useRecoverableDraft } from '@/core/drafts/public';
import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  FailureAlert,
  RecoveredDraftNotice,
  StaleIndicator,
  TextField,
} from '@/shared/ui/public';

import styles from './record-observation-form.module.css';
import { useRecordObservation } from './queries';

const recordObservationSchema = z
  .object({
    noteText: z.string().trim().max(4000).optional(),
    conditionSummary: z.string().trim().max(4000).optional(),
    plantId: z.string().trim().optional(),
    gardenObjectId: z.string().trim().optional(),
    observedAt: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
    const hasNote = (values.noteText ?? '') !== '';
    const hasSummary = (values.conditionSummary ?? '') !== '';
    if (!hasNote && !hasSummary) {
      ctx.addIssue({
        code: 'custom',
        path: ['noteText'],
        message: 'a note or a condition summary is required',
      });
    }
  });

type RecordObservationValues = z.infer<typeof recordObservationSchema>;

const DEFAULT_VALUES: RecordObservationValues = {
  noteText: '',
  conditionSummary: '',
  plantId: '',
  gardenObjectId: '',
  observedAt: '',
};

/**
 * Local-draft schema version for this form — see
 * `core/drafts/local-draft-store.ts`'s doc comment for the versioning
 * convention.
 */
const RECORD_OBSERVATION_DRAFT_SCHEMA_VERSION = 1;

export interface RecordObservationFormProps {
  readonly gardenId: string;
  /**
   * When set, the observation is always recorded against this plant and no
   * `plantId` field is shown — the form is embedded on that plant's own
   * detail page. When omitted, `plantId` is a plain, optional text field
   * (the contract has no plant picker; see `features/plants/add-plant-form.tsx`'s
   * doc comment for why this codebase does not build one this pass).
   */
  readonly fixedPlantId?: string;
}

/**
 * `RecordObservationRequest` without photo support: this codebase has no
 * upload flow yet (the same gap `features/plants` documents), and the
 * contract already allows a note and/or a condition summary with no photo
 * at all — at least one of `noteText`, `conditionSummary`, or a photo is
 * required, and this form always supplies one of the first two.
 *
 * Wired to `core/drafts`' recoverable-draft mechanism (P5-WEB-01): field
 * values are persisted locally while the form is dirty and restored on a
 * later mount, e.g. after an accidental reload. Submission is disabled
 * while the browser is offline rather than queued — see
 * `core/drafts/use-recoverable-draft.ts`'s and
 * `shared/ui/stale-indicator.tsx`'s doc comments for the reasoning.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `recordObservation`.
 */
export function RecordObservationForm({ gardenId, fixedPlantId }: RecordObservationFormProps) {
  const { t } = useLocalization();
  const mutation = useRecordObservation(gardenId);
  const isOnline = useIsOnline();

  const { register, handleSubmit, formState, reset, watch } = useForm<RecordObservationValues>({
    resolver: zodResolver(recordObservationSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const draft = useRecoverableDraft<RecordObservationValues>({
    draftType: 'observations.recordObservation',
    // A garden-wide draft and a plant-fixed draft are distinct sessions —
    // both can legitimately be open at once in different tabs.
    scopeKey: `${gardenId}:${fixedPlantId ?? 'garden'}`,
    schemaVersion: RECORD_OBSERVATION_DRAFT_SCHEMA_VERSION,
    payload: watch(),
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

  const onSubmit = handleSubmit((values) => {
    const input: RecordObservationRequest = {
      // No photo-upload flow exists yet (see this component's doc comment);
      // `photoMediaIds` carries a schema `default: []`, which the generated
      // type surfaces as required rather than optional.
      photoMediaIds: [],
      ...(values.noteText === undefined || values.noteText === ''
        ? {}
        : { noteText: values.noteText }),
      ...(values.conditionSummary === undefined || values.conditionSummary === ''
        ? {}
        : { conditionSummary: values.conditionSummary }),
      ...(fixedPlantId === undefined
        ? values.plantId === undefined || values.plantId === ''
          ? {}
          : { plantId: values.plantId }
        : { plantId: fixedPlantId }),
      ...(values.gardenObjectId === undefined || values.gardenObjectId === ''
        ? {}
        : { gardenObjectId: values.gardenObjectId }),
      ...(values.observedAt === undefined || values.observedAt === ''
        ? {}
        : { observedAt: new Date(values.observedAt).toISOString() }),
    };

    mutation.mutate(input, {
      onSuccess: () => {
        reset();
        draft.clearDraft();
      },
    });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      {draft.recovered && <RecoveredDraftNotice onDiscard={discardRecoveredDraft} />}
      <TextField
        label={t('observations.noteTextLabel')}
        error={
          formState.errors.noteText === undefined
            ? undefined
            : t('observations.noteOrSummaryRequired')
        }
        {...register('noteText')}
      />
      <TextField
        label={t('observations.conditionSummaryLabel')}
        {...register('conditionSummary')}
      />
      {fixedPlantId === undefined && (
        <TextField label={t('observations.plantIdLabel')} {...register('plantId')} />
      )}
      <TextField label={t('observations.gardenObjectIdLabel')} {...register('gardenObjectId')} />
      <TextField
        label={t('observations.observedAtLabel')}
        type="datetime-local"
        {...register('observedAt')}
      />
      <p className={styles['hint']}>{t('observations.mediaGapHint')}</p>
      <StaleIndicator />
      <Button type="submit" variant="primary" busy={mutation.isPending} disabled={!isOnline}>
        {t('observations.recordSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
