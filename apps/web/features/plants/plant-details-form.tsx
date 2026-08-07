'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Plant, UpdatePlantDetailsRequest } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useLocalization } from '@/shared/localization/public';
import {
  CalendarIcon,
  Button,
  FailureAlert,
  HashIcon,
  LightbulbIcon,
  PulseIcon,
  SproutIcon,
  TagIcon,
  TypeIcon,
} from '@/shared/ui/public';

import { PLANT_ACQUISITION_DATE_TYPES, acquisitionDateTypeLabel } from './labels';
import styles from './plant-details-form.module.css';
import { useUpdatePlantDetails } from './queries';
import { TaxonomyReferenceField } from './taxonomy-reference-field';

const NONE_VALUE = '';
const ACQUISITION_CHOICES = [NONE_VALUE, ...PLANT_ACQUISITION_DATE_TYPES] as const;

const editPlantFields = z.object({
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

export function editPlantSchema(groupingKind: Plant['groupingKind']) {
  return editPlantFields.superRefine((values, context) => {
    if (groupingKind === 'individual') return;

    const quantity =
      values.quantity === undefined || values.quantity === '' ? NaN : Number(values.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      context.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'positive quantity required',
      });
    }
  });
}

type EditPlantValues = z.infer<typeof editPlantFields>;

export interface PlantDetailsFormProps {
  readonly gardenId: string;
  readonly plant: Plant;
}

/**
 * Inline attribute board for `UpdatePlantDetailsRequest`.
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

  const { register, handleSubmit, formState, setValue, watch } = useForm<EditPlantValues>({
    resolver: zodResolver(editPlantSchema(plant.groupingKind)),
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

  const saveValues = (values: EditPlantValues, nextTaxonomyReferenceId: string | null) => {
    const input: UpdatePlantDetailsRequest = {
      displayName: values.displayName,
      taxonomyReferenceId: nextTaxonomyReferenceId,
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
  };

  const save = (nextTaxonomyReferenceId = taxonomyReferenceId) => {
    if (mutation.isPending) return;
    void handleSubmit((values) => saveValues(values, nextTaxonomyReferenceId))();
  };

  const displayNameField = register('displayName');
  const varietyField = register('varietyLabel');
  const acquisitionDateField = register('acquisitionDate');
  const acquisitionType = watch('acquisitionDateType') ?? NONE_VALUE;
  const quantityField = register('quantity');
  const conditionField = register('conditionNote');
  const guidanceField = register('careGuidanceNote');

  return (
    <div className={styles['board']}>
      <label className={`${styles['property']} ${styles['propertyName']}`}>
        <span className={styles['propertyLabel']}>
          <TypeIcon />
          {t('plants.displayNameLabel')}
        </span>
        <input
          className={styles['propertyValue']}
          maxLength={200}
          {...displayNameField}
          onBlur={(event) => {
            void displayNameField.onBlur(event);
            save();
          }}
        />
        {formState.errors.displayName !== undefined && (
          <span className={styles['propertyError']}>{t('plants.displayNameRequired')}</span>
        )}
      </label>

      <details className={`${styles['property']} ${styles['propertyTaxonomy']}`}>
        <summary>
          <span className={styles['propertyLabel']}>
            <SproutIcon />
            {t('plants.taxonomySelectLabel')}
          </span>
          <strong className={styles['summaryValue']}>
            {taxonomyReferenceId === null ? t('plants.taxonomyNone') : plant.displayName}
          </strong>
        </summary>
        <div className={styles['picker']}>
          <TaxonomyReferenceField
            gardenId={gardenId}
            value={taxonomyReferenceId}
            initialSelectionLabel={plant.displayName}
            onChange={(nextValue) => {
              setTaxonomyReferenceId(nextValue);
              save(nextValue);
            }}
          />
        </div>
      </details>

      <label className={styles['property']}>
        <span className={styles['propertyLabel']}>
          <TagIcon />
          {t('plants.varietyLabelLabel')}
        </span>
        <input
          className={styles['propertyValue']}
          placeholder="—"
          maxLength={200}
          {...varietyField}
          onBlur={(event) => {
            void varietyField.onBlur(event);
            save();
          }}
        />
      </label>

      <label className={styles['property']}>
        <span className={styles['propertyLabel']}>
          <CalendarIcon />
          {t('plants.acquisitionDateLabel')}
        </span>
        <input
          className={styles['propertyValue']}
          type="date"
          {...acquisitionDateField}
          onBlur={(event) => {
            void acquisitionDateField.onBlur(event);
            save();
          }}
        />
      </label>

      <details className={styles['property']}>
        <summary>
          <span className={styles['propertyLabel']}>
            <CalendarIcon />
            {t('plants.acquisitionDateTypeLabel')}
          </span>
          <strong className={styles['summaryValue']}>
            {acquisitionType === NONE_VALUE
              ? t('plants.acquisitionDateTypeNone')
              : t(acquisitionDateTypeLabel(acquisitionType))}
          </strong>
        </summary>
        <div className={styles['choices']}>
          {ACQUISITION_CHOICES.map((type) => (
            <Button
              key={type || 'none'}
              variant={type === acquisitionType ? 'primary' : 'secondary'}
              aria-pressed={type === acquisitionType}
              onClick={() => {
                setValue('acquisitionDateType', type, { shouldDirty: true });
                queueMicrotask(() => save());
              }}
            >
              {type === NONE_VALUE
                ? t('plants.acquisitionDateTypeNone')
                : t(acquisitionDateTypeLabel(type))}
            </Button>
          ))}
        </div>
      </details>

      {plant.groupingKind !== 'individual' && (
        <label className={styles['property']}>
          <span className={styles['propertyLabel']}>
            <HashIcon />
            {t('plants.quantityLabel')}
          </span>
          <input
            className={styles['propertyValue']}
            type="number"
            min={1}
            {...quantityField}
            onBlur={(event) => {
              void quantityField.onBlur(event);
              save();
            }}
          />
        </label>
      )}

      <label className={`${styles['property']} ${styles['propertyNote']}`}>
        <span className={styles['propertyLabel']}>
          <PulseIcon />
          {t('plants.conditionNoteLabel')}
        </span>
        <input
          className={styles['propertyValue']}
          placeholder="—"
          {...conditionField}
          onBlur={(event) => {
            void conditionField.onBlur(event);
            save();
          }}
        />
      </label>

      <label className={`${styles['property']} ${styles['propertyNote']}`}>
        <span className={styles['propertyLabel']}>
          <LightbulbIcon />
          {t('plants.careGuidanceNoteLabel')}
        </span>
        <input
          className={styles['propertyValue']}
          placeholder="—"
          {...guidanceField}
          onBlur={(event) => {
            void guidanceField.onBlur(event);
            save();
          }}
        />
      </label>

      <p className={styles['saveState']} role="status">
        {mutation.isPending
          ? t('plants.detailsSaving')
          : savedAnnouncement
            ? t('plants.detailsSaved')
            : t('plants.detailsAutoSave')}
      </p>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </div>
  );
}
