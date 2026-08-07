'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { PlantCandidate, UpdateCandidateDetailsRequest } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useLocalization } from '@/shared/localization/public';
import {
  CheckIcon,
  Button,
  CommandSurface,
  FailureAlert,
  HashIcon,
  PulseIcon,
  Select,
  TagIcon,
  TextField,
  TypeIcon,
} from '@/shared/ui/public';

import { CANDIDATE_PRIORITIES, candidatePriorityLabel } from './labels';
import styles from './candidate-details-form.module.css';
import { useUpdateCandidateDetails } from './queries';
import { TaxonomyReferenceField } from './taxonomy-reference-field';

const NONE_VALUE = '';

const editCandidateFields = z.object({
  displayName: z.string().trim().min(1).max(200),
  varietyLabel: z.string().trim().max(200).optional(),
  quantity: z.string().trim().optional(),
  rationaleNote: z.string().trim().optional(),
  priority: z.union([z.enum(['low', 'medium', 'high']), z.literal(NONE_VALUE)]).optional(),
  priceAmount: z.string().trim().optional(),
  priceCurrency: z.string().trim().max(8).optional(),
  purchaseSource: z.string().trim().max(200).optional(),
});

export function editCandidateSchema(groupingKind: PlantCandidate['groupingKind']) {
  return editCandidateFields.superRefine((values, context) => {
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

type EditCandidateValues = z.infer<typeof editCandidateFields>;

export interface CandidateDetailsFormProps {
  readonly gardenId: string;
  readonly candidate: PlantCandidate;
}

/**
 * Edit form for `UpdateCandidateDetailsRequest`. Every property on the wire
 * is optional, but this form always sends every field it shows, translating
 * "left blank" to an explicit `null` — the same convention
 * `features/plants/plant-details-form.tsx` documents for the identical
 * problem on a real plant. `groupingKind` is immutable (the contract
 * excludes it from `UpdateCandidateDetailsRequest`), so `quantity` is only
 * shown — and only sent — for a candidate created as a row or a group.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `updateCandidateDetails`.
 */
export function CandidateDetailsForm({ gardenId, candidate }: CandidateDetailsFormProps) {
  const { t } = useLocalization();
  const mutation = useUpdateCandidateDetails(gardenId, candidate.id);
  const [taxonomyReferenceId, setTaxonomyReferenceId] = useState<string | null>(
    candidate.taxonomyReferenceId,
  );
  const [savedAnnouncement, setSavedAnnouncement] = useState(false);

  useEffect(() => {
    setTaxonomyReferenceId(candidate.taxonomyReferenceId);
  }, [candidate.taxonomyReferenceId]);

  const { register, handleSubmit, formState } = useForm<EditCandidateValues>({
    resolver: zodResolver(editCandidateSchema(candidate.groupingKind)),
    values: {
      displayName: candidate.displayName,
      varietyLabel: candidate.varietyLabel ?? '',
      quantity: candidate.quantity === null ? '' : String(candidate.quantity),
      rationaleNote: candidate.rationaleNote ?? '',
      priority: candidate.priority ?? NONE_VALUE,
      priceAmount: candidate.priceAmount === null ? '' : String(candidate.priceAmount),
      priceCurrency: candidate.priceCurrency ?? '',
      purchaseSource: candidate.purchaseSource ?? '',
    },
  });

  const onSubmit = handleSubmit((values) => {
    const input: UpdateCandidateDetailsRequest = {
      displayName: values.displayName,
      taxonomyReferenceId,
      varietyLabel:
        values.varietyLabel === undefined || values.varietyLabel === ''
          ? null
          : values.varietyLabel,
      rationaleNote:
        values.rationaleNote === undefined || values.rationaleNote === ''
          ? null
          : values.rationaleNote,
      priority:
        values.priority === undefined || values.priority === NONE_VALUE ? null : values.priority,
      priceAmount:
        values.priceAmount === undefined || values.priceAmount === ''
          ? null
          : Number(values.priceAmount),
      priceCurrency:
        values.priceCurrency === undefined || values.priceCurrency === ''
          ? null
          : values.priceCurrency,
      purchaseSource:
        values.purchaseSource === undefined || values.purchaseSource === ''
          ? null
          : values.purchaseSource,
      ...(candidate.groupingKind === 'individual'
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
      { input, expectedRevision: candidate.revision },
      { onSuccess: () => setSavedAnnouncement(true) },
    );
  });

  return (
    <CommandSurface className={styles['form']} onCommit={() => void onSubmit()}>
      <TextField
        label={t('candidates.displayNameLabel')}
        icon={<TypeIcon />}
        maxLength={200}
        error={
          formState.errors.displayName === undefined
            ? undefined
            : t('candidates.displayNameRequired')
        }
        {...register('displayName')}
      />
      <TaxonomyReferenceField
        gardenId={gardenId}
        value={taxonomyReferenceId}
        initialSelectionLabel={candidate.displayName}
        onChange={setTaxonomyReferenceId}
      />
      <TextField
        label={t('candidates.varietyLabelLabel')}
        icon={<TagIcon />}
        maxLength={200}
        {...register('varietyLabel')}
      />
      {candidate.groupingKind !== 'individual' && (
        <TextField
          label={t('candidates.quantityLabel')}
          icon={<HashIcon />}
          type="number"
          min={1}
          error={
            formState.errors.quantity === undefined ? undefined : t('candidates.quantityInvalid')
          }
          {...register('quantity')}
        />
      )}
      <TextField
        label={t('candidates.rationaleNoteLabel')}
        icon={<PulseIcon />}
        {...register('rationaleNote')}
      />
      <Select
        label={t('candidates.priorityLabel')}
        options={[
          { value: NONE_VALUE, label: t('candidates.priorityNone') },
          ...CANDIDATE_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(candidatePriorityLabel(priority)),
          })),
        ]}
        {...register('priority')}
      />
      <div className={styles['row']}>
        <TextField
          label={t('candidates.priceAmountLabel')}
          type="number"
          min={0}
          step="0.01"
          {...register('priceAmount')}
        />
        <TextField
          label={t('candidates.priceCurrencyLabel')}
          maxLength={8}
          {...register('priceCurrency')}
        />
      </div>
      <TextField
        label={t('candidates.purchaseSourceLabel')}
        maxLength={200}
        {...register('purchaseSource')}
      />
      <Button
        type="submit"
        variant="primary"
        busy={mutation.isPending}
        iconOnly
        aria-label={t('candidates.saveDetails')}
        title={t('candidates.saveDetails')}
      >
        <CheckIcon />
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {savedAnnouncement && !mutation.isError && (
        <p role="status">{t('candidates.detailsSaved')}</p>
      )}
    </CommandSurface>
  );
}
