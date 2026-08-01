'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ConvertCandidateRequest, PlantCandidate } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { candidateAcquisitionDateTypeLabel, CANDIDATE_ACQUISITION_DATE_TYPES } from './labels';
import styles from './candidate-convert-form.module.css';
import { useConvertCandidate } from './queries';

const NONE_VALUE = '';

const convertCandidateSchema = z.object({
  acquisitionDate: z.string().trim().optional(),
  acquisitionDateType: z
    .union([z.enum(['planted', 'sown', 'acquired']), z.literal(NONE_VALUE)])
    .optional(),
});

type ConvertCandidateValues = z.infer<typeof convertCandidateSchema>;

export interface CandidateConvertFormProps {
  readonly gardenId: string;
  readonly candidate: PlantCandidate;
}

/**
 * `ConvertCandidate` — creates a real plant from this candidate and marks
 * the candidate `converted`. Irreversible, so it goes through the same
 * `globalThis.confirm` gate `plant-delete-section.tsx`/`garden-settings.tsx`
 * already use for their own irreversible actions.
 *
 * `gardenAreaMapObjectId`/`placementMapObjectId` are left unset here — both
 * default to the candidate's own proposed placement when omitted (the
 * operation's own contract description), so no placement picker is shown; a
 * caller who wants a different placement can move the resulting plant
 * afterward with `plant-move-form.tsx`. Only `acquisitionDate`/
 * `acquisitionDateType` are collected, mirroring the equivalent fields on
 * `add-plant-form.tsx`.
 *
 * On success, navigates to the new plant's own detail page — the created
 * plant, not the now-converted candidate, is what the caller wants to see
 * next.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `convertCandidate`.
 */
export function CandidateConvertForm({ gardenId, candidate }: CandidateConvertFormProps) {
  const { t } = useLocalization();
  const router = useRouter();
  const mutation = useConvertCandidate(gardenId, candidate.id);
  const isOnline = useIsOnline();

  const { register, handleSubmit } = useForm<ConvertCandidateValues>({
    resolver: zodResolver(convertCandidateSchema),
    defaultValues: {},
  });

  const onSubmit = handleSubmit((values) => {
    if (!globalThis.confirm(t('candidates.convertConfirm'))) {
      return;
    }

    const input: ConvertCandidateRequest = {
      ...(values.acquisitionDate === undefined || values.acquisitionDate === ''
        ? {}
        : { acquisitionDate: values.acquisitionDate }),
      ...(values.acquisitionDateType === undefined || values.acquisitionDateType === NONE_VALUE
        ? {}
        : { acquisitionDateType: values.acquisitionDateType }),
    };

    mutation.mutate(
      { input, expectedRevision: candidate.revision },
      {
        onSuccess: (result) => {
          router.push(`/application/gardens/${gardenId}/plants/${result.plant.id}`);
        },
      },
    );
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      <p className={styles['description']}>{t('candidates.convertDescription')}</p>

      <div className={styles['row']}>
        <TextField
          label={t('candidates.convertAcquisitionDateLabel')}
          type="date"
          {...register('acquisitionDate')}
        />
        <Select
          label={t('candidates.convertAcquisitionDateTypeLabel')}
          options={[
            { value: NONE_VALUE, label: t('candidates.convertAcquisitionDateTypeNone') },
            ...CANDIDATE_ACQUISITION_DATE_TYPES.map((type) => ({
              value: type,
              label: t(candidateAcquisitionDateTypeLabel(type)),
            })),
          ]}
          {...register('acquisitionDateType')}
        />
      </div>

      <Button type="submit" variant="primary" busy={mutation.isPending} disabled={!isOnline}>
        {t('candidates.convertSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
