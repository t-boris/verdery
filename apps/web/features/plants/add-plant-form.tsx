'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AddPlantRequest, PlantGroupingKind } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useIsOnline } from '@/core/connectivity/public';
import { useRecoverableDraft } from '@/core/drafts/public';
import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  FailureAlert,
  RecoveredDraftNotice,
  Select,
  StaleIndicator,
  TextField,
} from '@/shared/ui/public';

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

const DEFAULT_VALUES: AddPlantValues = { displayName: '', groupingKind: 'individual' };

interface AddPlantDraftPayload extends AddPlantValues {
  readonly taxonomyReferenceId: string | null;
}

/**
 * Local-draft schema version for this form. Increment whenever
 * `AddPlantDraftPayload`'s shape changes in a way an old stored draft could
 * not be blindly reapplied under — see `core/drafts/local-draft-store.ts`'s
 * doc comment for the full convention.
 */
const ADD_PLANT_DRAFT_SCHEMA_VERSION = 1;

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
 * Wired to `core/drafts`' recoverable-draft mechanism (P5-WEB-01): every
 * field, plus `taxonomyReferenceId` (which React Hook Form does not own —
 * `TaxonomyReferenceField` is a controlled component backed by plain
 * `useState`), is persisted locally while the form is dirty and restored on
 * a later mount, e.g. after an accidental reload. Submission is disabled
 * while the browser is offline instead of being queued — see
 * `core/drafts/use-recoverable-draft.ts`'s and
 * `shared/ui/stale-indicator.tsx`'s doc comments for the reasoning.
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `addPlant`.
 */
export function AddPlantForm({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const router = useRouter();
  const mutation = useAddPlant(gardenId);
  const isOnline = useIsOnline();
  const [taxonomyReferenceId, setTaxonomyReferenceId] = useState<string | null>(null);

  const { register, handleSubmit, formState, watch, reset } = useForm<AddPlantValues>({
    resolver: zodResolver(addPlantSchema),
    defaultValues: DEFAULT_VALUES,
    // `quantity` is conditionally rendered on `groupingKind`; unregistering it
    // on unmount is what makes switching back to `individual` clear a
    // previously typed value instead of leaving a hidden, unfixable error.
    shouldUnregister: true,
  });

  const groupingKind = watch('groupingKind');
  const currentValues = watch();

  const draft = useRecoverableDraft<AddPlantDraftPayload>({
    draftType: 'plants.addPlant',
    scopeKey: gardenId,
    schemaVersion: ADD_PLANT_DRAFT_SCHEMA_VERSION,
    payload: { ...currentValues, taxonomyReferenceId },
    hasUnsavedInput: formState.isDirty || taxonomyReferenceId !== null,
  });

  useEffect(() => {
    if (draft.recoveredPayload === null) {
      return;
    }
    const { taxonomyReferenceId: recoveredTaxonomyReferenceId, ...recoveredValues } =
      draft.recoveredPayload;
    reset(recoveredValues);
    setTaxonomyReferenceId(recoveredTaxonomyReferenceId);
    draft.acknowledgeRecovered();
    // Runs exactly once, when `draft.recoveredPayload` transitions from `null`
    // to a real value right after mount — see `useRecoverableDraft`'s own
    // doc comment for why this "apply, then acknowledge" split exists.
    // `reset`/`draft.acknowledgeRecovered` are deliberately not listed:
    // `reset` is a fresh function identity from React Hook Form on every
    // render, and `acknowledgeRecovered` is what clears the one dependency
    // this effect actually reacts to.
  }, [draft.recoveredPayload]);

  const discardRecoveredDraft = () => {
    draft.dismissRecovered();
    reset(DEFAULT_VALUES);
    setTaxonomyReferenceId(null);
  };

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
        draft.clearDraft();
        router.push(`/application/gardens/${gardenId}/plants/${plant.id}`);
      },
    });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      {draft.recovered && <RecoveredDraftNotice onDiscard={discardRecoveredDraft} />}
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

      <StaleIndicator />
      <Button type="submit" variant="primary" busy={mutation.isPending} disabled={!isOnline}>
        {t('plants.addSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
