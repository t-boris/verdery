'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AddPlantRequest, PlantGroupingKind } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import {
  PLANT_ACQUISITION_DATE_TYPES,
  PLANT_GROUPING_KINDS,
  acquisitionDateTypeLabel,
  groupingKindLabel,
} from './labels';
import { useAddPlant } from './queries';
import styles from './add-plant-form.module.css';
import { TaxonomyReferenceField } from './taxonomy-reference-field';

const NONE_VALUE = '';

const addPlantSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    varietyLabel: z.string().trim().max(200).optional(),
    acquisitionDate: z.string().trim().optional(),
    acquisitionDateType: z
      .union([z.enum(['planted', 'sown', 'acquired']), z.literal(NONE_VALUE)])
      .optional(),
    groupingKind: z.enum(['individual', 'row', 'group']),
    quantity: z.string().trim().optional(),
    gardenAreaMapObjectId: z.string().trim().optional(),
    placementMapObjectId: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
    const hasQuantity = (values.quantity ?? '') !== '';
    if (values.groupingKind === 'individual' && hasQuantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'not allowed for individual plants',
      });
    }
    if (values.groupingKind !== 'individual' && !hasQuantity) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'required for a row or group' });
    }
  });

type AddPlantValues = z.infer<typeof addPlantSchema>;

/**
 * Creates a plant instance, row, or group, then hands off to the plant's own
 * detail page — the same create-then-navigate pattern
 * `features/gardens/create-garden-form.tsx` uses.
 *
 * `gardenAreaMapObjectId`/`placementMapObjectId` are plain map-object-id text
 * fields rather than a picker: `features/map` exposes `useGardenMap` that
 * could read the garden's objects, but a feature importing another feature
 * violates `architecture/web-application-design.md`, section "20. Dependency
 * Rules" ("Features import public Core and Shared interfaces only"), so this
 * pass leaves the field as a documented, honest fallback rather than
 * reaching across that boundary.
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `addPlant`.
 */
export function AddPlantForm({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const router = useRouter();
  const mutation = useAddPlant(gardenId);
  const [taxonomyReferenceId, setTaxonomyReferenceId] = useState<string | null>(null);

  const { register, handleSubmit, formState, watch, reset } = useForm<AddPlantValues>({
    resolver: zodResolver(addPlantSchema),
    defaultValues: { displayName: '', groupingKind: 'individual' },
    // `quantity` is conditionally rendered on `groupingKind`; unregistering it
    // on unmount is what makes switching back to `individual` clear a
    // previously typed value instead of leaving a hidden, unfixable error.
    shouldUnregister: true,
  });

  const groupingKind = watch('groupingKind');

  const onSubmit = handleSubmit((values) => {
    const input: AddPlantRequest = {
      displayName: values.displayName,
      groupingKind: values.groupingKind,
      ...(taxonomyReferenceId === null ? {} : { taxonomyReferenceId }),
      ...(values.varietyLabel === undefined || values.varietyLabel === ''
        ? {}
        : { varietyLabel: values.varietyLabel }),
      ...(values.acquisitionDate === undefined || values.acquisitionDate === ''
        ? {}
        : { acquisitionDate: values.acquisitionDate }),
      ...(values.acquisitionDateType === undefined || values.acquisitionDateType === NONE_VALUE
        ? {}
        : { acquisitionDateType: values.acquisitionDateType }),
      ...(values.quantity === undefined || values.quantity === ''
        ? {}
        : { quantity: Number(values.quantity) }),
      ...(values.gardenAreaMapObjectId === undefined || values.gardenAreaMapObjectId === ''
        ? {}
        : { gardenAreaMapObjectId: values.gardenAreaMapObjectId }),
      ...(values.placementMapObjectId === undefined || values.placementMapObjectId === ''
        ? {}
        : { placementMapObjectId: values.placementMapObjectId }),
    };

    mutation.mutate(input, {
      onSuccess: (plant) => {
        reset();
        setTaxonomyReferenceId(null);
        router.push(`/application/gardens/${gardenId}/plants/${plant.id}`);
      },
    });
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

      <Select
        label={t('plants.groupingKindLabel')}
        options={PLANT_GROUPING_KINDS.map((kind: PlantGroupingKind) => ({
          value: kind,
          label: t(groupingKindLabel(kind)),
        }))}
        {...register('groupingKind')}
      />

      {groupingKind !== 'individual' && (
        <TextField
          label={t('plants.quantityLabel')}
          type="number"
          min={1}
          error={formState.errors.quantity === undefined ? undefined : t('plants.quantityInvalid')}
          {...register('quantity')}
        />
      )}

      <TextField
        label={t('plants.gardenAreaMapObjectIdLabel')}
        {...register('gardenAreaMapObjectId')}
        aria-describedby="add-plant-map-object-hint"
      />
      <TextField
        label={t('plants.placementMapObjectIdLabel')}
        {...register('placementMapObjectId')}
      />
      <p id="add-plant-map-object-hint" className={styles['hint']}>
        {t('plants.mapObjectIdHint')}
      </p>

      <Button type="submit" variant="primary" busy={mutation.isPending}>
        {t('plants.addSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
