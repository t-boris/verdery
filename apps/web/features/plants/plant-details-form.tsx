'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Plant, UpdatePlantDetailsRequest } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { PLANT_ACQUISITION_DATE_TYPES, acquisitionDateTypeLabel } from './labels';
import styles from './plant-details-form.module.css';
import { useUpdatePlantDetails } from './queries';
import { TaxonomyReferenceField } from './taxonomy-reference-field';

const NONE_VALUE = '';

const editPlantSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  varietyLabel: z.string().trim().max(200).optional(),
  acquisitionDate: z.string().trim().optional(),
  acquisitionDateType: z
    .union([z.enum(['planted', 'sown', 'acquired']), z.literal(NONE_VALUE)])
    .optional(),
  conditionNote: z.string().trim().optional(),
  careGuidanceNote: z.string().trim().optional(),
  quantity: z.string().trim().optional(),
});

type EditPlantValues = z.infer<typeof editPlantSchema>;

export interface PlantDetailsFormProps {
  readonly gardenId: string;
  readonly plant: Plant;
}

/**
 * Edit form for `UpdatePlantDetailsRequest`.
 *
 * Every property on the wire is optional: an omitted one leaves the current
 * value unchanged, while an explicit `null` clears it. This form always
 * sends every field it shows, translating "left blank" to an explicit
 * `null` — otherwise clearing a note or a variety label would silently do
 * nothing. `groupingKind` is immutable and not editable here (the contract
 * excludes it from `UpdatePlantDetailsRequest`), so `quantity` is only shown
 * — and only sent — for a plant that was created as a row or a group.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `updatePlantDetails`.
 */
export function PlantDetailsForm({ gardenId, plant }: PlantDetailsFormProps) {
  const { t } = useLocalization();
  const mutation = useUpdatePlantDetails(gardenId, plant.id);
  const [taxonomyReferenceId, setTaxonomyReferenceId] = useState<string | null>(
    plant.taxonomyReferenceId,
  );
  const [savedAnnouncement, setSavedAnnouncement] = useState(false);

  useEffect(() => {
    setTaxonomyReferenceId(plant.taxonomyReferenceId);
  }, [plant.taxonomyReferenceId]);

  const { register, handleSubmit, formState } = useForm<EditPlantValues>({
    resolver: zodResolver(editPlantSchema),
    values: {
      displayName: plant.displayName,
      varietyLabel: plant.varietyLabel ?? '',
      acquisitionDate: plant.acquisitionDate ?? '',
      acquisitionDateType: plant.acquisitionDateType ?? NONE_VALUE,
      conditionNote: plant.conditionNote ?? '',
      careGuidanceNote: plant.careGuidanceNote ?? '',
      quantity: plant.quantity === null ? '' : String(plant.quantity),
    },
  });

  const onSubmit = handleSubmit((values) => {
    const input: UpdatePlantDetailsRequest = {
      displayName: values.displayName,
      taxonomyReferenceId,
      varietyLabel:
        values.varietyLabel === undefined || values.varietyLabel === ''
          ? null
          : values.varietyLabel,
      acquisitionDate:
        values.acquisitionDate === undefined || values.acquisitionDate === ''
          ? null
          : values.acquisitionDate,
      acquisitionDateType:
        values.acquisitionDateType === undefined || values.acquisitionDateType === NONE_VALUE
          ? null
          : values.acquisitionDateType,
      conditionNote:
        values.conditionNote === undefined || values.conditionNote === ''
          ? null
          : values.conditionNote,
      careGuidanceNote:
        values.careGuidanceNote === undefined || values.careGuidanceNote === ''
          ? null
          : values.careGuidanceNote,
      ...(plant.groupingKind === 'individual'
        ? {}
        : {
            quantity:
              values.quantity === undefined || values.quantity === ''
                ? null
                : Number(values.quantity),
          }),
    };

    setSavedAnnouncement(false);
    mutation.mutate(
      { input, expectedRevision: plant.revision },
      { onSuccess: () => setSavedAnnouncement(true) },
    );
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      <TextField
        label={t('plants.displayNameLabel')}
        maxLength={200}
        error={
          formState.errors.displayName === undefined ? undefined : t('plants.displayNameRequired')
        }
        {...register('displayName')}
      />
      <TaxonomyReferenceField
        gardenId={gardenId}
        value={taxonomyReferenceId}
        onChange={setTaxonomyReferenceId}
      />
      <TextField
        label={t('plants.varietyLabelLabel')}
        maxLength={200}
        {...register('varietyLabel')}
      />
      <div className={styles['row']}>
        <TextField
          label={t('plants.acquisitionDateLabel')}
          type="date"
          {...register('acquisitionDate')}
        />
        <Select
          label={t('plants.acquisitionDateTypeLabel')}
          options={[
            { value: NONE_VALUE, label: t('plants.acquisitionDateTypeNone') },
            ...PLANT_ACQUISITION_DATE_TYPES.map((type) => ({
              value: type,
              label: t(acquisitionDateTypeLabel(type)),
            })),
          ]}
          {...register('acquisitionDateType')}
        />
      </div>
      {plant.groupingKind !== 'individual' && (
        <TextField
          label={t('plants.quantityLabel')}
          type="number"
          min={1}
          {...register('quantity')}
        />
      )}
      <TextField label={t('plants.conditionNoteLabel')} {...register('conditionNote')} />
      <TextField label={t('plants.careGuidanceNoteLabel')} {...register('careGuidanceNote')} />
      <Button type="submit" variant="primary" busy={mutation.isPending}>
        {t('plants.saveDetails')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {savedAnnouncement && !mutation.isError && <p role="status">{t('plants.detailsSaved')}</p>}
    </form>
  );
}
