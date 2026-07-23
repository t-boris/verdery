'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CorrectObservationRequest, ObservationCorrectionKind } from '@verdery/api-contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { OBSERVATION_CORRECTION_KINDS, correctionKindLabel } from './labels';
import styles from './observation-correction-form.module.css';
import { useCorrectObservation } from './queries';

const correctionSchema = z.object({
  correctionKind: z.enum(['amendment', 'supersede']),
  noteText: z.string().trim().max(4000).optional(),
  conditionSummary: z.string().trim().max(4000).optional(),
});

type CorrectionValues = z.infer<typeof correctionSchema>;

export interface ObservationCorrectionFormProps {
  readonly gardenId: string;
  readonly plantId: string | null;
  readonly observationId: string;
  readonly onDone: () => void;
}

/**
 * Records a correction — a brand-new `Observation` row pointing backward at
 * the one it corrects. The original observation is never edited or hidden:
 * this form only ever adds a new timeline entry, matching
 * `Observation.correctionKind`'s own append-only contract.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `correctObservation`.
 */
export function ObservationCorrectionForm({
  gardenId,
  plantId,
  observationId,
  onDone,
}: ObservationCorrectionFormProps) {
  const { t } = useLocalization();
  const mutation = useCorrectObservation(gardenId, plantId);

  const { register, handleSubmit } = useForm<CorrectionValues>({
    resolver: zodResolver(correctionSchema),
    defaultValues: { correctionKind: 'amendment', noteText: '', conditionSummary: '' },
  });

  const onSubmit = handleSubmit((values) => {
    const input: CorrectObservationRequest = {
      correctionKind: values.correctionKind,
      // No photo-upload flow exists yet; `photoMediaIds` carries a schema
      // `default: []`, which the generated type surfaces as required.
      photoMediaIds: [],
      ...(values.noteText === undefined || values.noteText === ''
        ? {}
        : { noteText: values.noteText }),
      ...(values.conditionSummary === undefined || values.conditionSummary === ''
        ? {}
        : { conditionSummary: values.conditionSummary }),
    };

    mutation.mutate({ observationId, input }, { onSuccess: () => onDone() });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      <p className={styles['hint']}>{t('observations.correctionExplanation')}</p>
      <Select
        label={t('observations.correctionKindLabel')}
        options={OBSERVATION_CORRECTION_KINDS.map((kind: ObservationCorrectionKind) => ({
          value: kind,
          label: t(correctionKindLabel(kind)),
        }))}
        {...register('correctionKind')}
      />
      <TextField label={t('observations.noteTextLabel')} {...register('noteText')} />
      <TextField
        label={t('observations.conditionSummaryLabel')}
        {...register('conditionSummary')}
      />
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" busy={mutation.isPending}>
          {t('observations.correctionSubmit')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('observations.correctionCancel')}
        </Button>
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
