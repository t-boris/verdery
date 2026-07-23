'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { RecordObservationRequest } from '@verdery/api-contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextField } from '@/shared/ui/public';

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
 * Source: packages/api-contracts/openapi.yaml, operation `recordObservation`.
 */
export function RecordObservationForm({ gardenId, fixedPlantId }: RecordObservationFormProps) {
  const { t } = useLocalization();
  const mutation = useRecordObservation(gardenId);

  const { register, handleSubmit, formState, reset } = useForm<RecordObservationValues>({
    resolver: zodResolver(recordObservationSchema),
    defaultValues: {
      noteText: '',
      conditionSummary: '',
      plantId: '',
      gardenObjectId: '',
      observedAt: '',
    },
  });

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

    mutation.mutate(input, { onSuccess: () => reset() });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
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
      <Button type="submit" variant="primary" busy={mutation.isPending}>
        {t('observations.recordSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
