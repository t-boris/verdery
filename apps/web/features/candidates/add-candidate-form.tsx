'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AddCandidateRequest, PlantGroupingKind } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useIsOnline } from '@/core/connectivity/public';
import { useRecoverableDraft } from '@/core/drafts/public';
import { useLocalization } from '@/shared/localization/public';
import {
  MapIcon,
  PlusIcon,
  Button,
  CommandSurface,
  FailureAlert,
  LightbulbIcon,
  RecoveredDraftNotice,
  SproutIcon,
  StaleIndicator,
  TagIcon,
  TextField,
} from '@/shared/ui/public';

import { useAddCandidate } from './queries';
import {
  CANDIDATE_GROUPING_KINDS,
  CANDIDATE_PRIORITIES,
  candidateGroupingKindLabel,
  candidatePriorityLabel,
} from './labels';
import styles from './add-candidate-form.module.css';
import { useGardenMapObjects } from './map-object-queries';
import { TaxonomyReferenceField } from './taxonomy-reference-field';

const NONE_VALUE = '';
const PRIORITY_CHOICES = [NONE_VALUE, ...CANDIDATE_PRIORITIES] as const;

const addCandidateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    varietyLabel: z.string().trim().max(200).optional(),
    groupingKind: z.enum(['individual', 'row', 'group']),
    quantity: z.string().trim().optional(),
    rationaleNote: z.string().trim().optional(),
    priority: z.union([z.enum(['low', 'medium', 'high']), z.literal(NONE_VALUE)]).optional(),
    priceAmount: z.string().trim().optional(),
    priceCurrency: z.string().trim().max(8).optional(),
    purchaseSource: z.string().trim().max(200).optional(),
    proposedGardenAreaMapObjectId: z.string().trim().optional(),
    proposedPlacementMapObjectId: z.string().trim().optional(),
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

type AddCandidateValues = z.infer<typeof addCandidateSchema>;

const DEFAULT_VALUES: AddCandidateValues = { displayName: '', groupingKind: 'individual' };

interface AddCandidateDraftPayload extends AddCandidateValues {
  readonly taxonomyReferenceId: string | null;
}

/**
 * Local-draft schema version for this form. Increment whenever
 * `AddCandidateDraftPayload`'s shape changes in a way an old stored draft
 * could not be blindly reapplied under — see
 * `core/drafts/local-draft-store.ts`'s doc comment for the full convention.
 */
const ADD_CANDIDATE_DRAFT_SCHEMA_VERSION = 1;

/**
 * Adds a plant candidate — a plant under consideration for this garden, not
 * yet planted — then hands off to its own detail page, the same
 * create-then-navigate pattern `features/plants/add-plant-form.tsx` uses.
 *
 * `alternativeToCandidateId` (`AddCandidateRequest`'s one self-reference
 * field, "this candidate is an alternative to that one") is deliberately
 * left out of this first pass: it needs a candidate picker this pass does
 * not build. `proposedGardenAreaMapObjectId`/`proposedPlacementMapObjectId`
 * reuse the identical `Select`-over-`useGardenMapObjects` treatment
 * `add-plant-form.tsx` gives the equivalent fields on a real plant — see
 * `map-object-queries.ts`'s own doc comment for why this feature rebuilds
 * that query rather than importing `features/plants`.
 *
 * Wired to `core/drafts`' recoverable-draft mechanism, mirroring
 * `add-plant-form.tsx` exactly — see that component's doc comment for the
 * full reasoning.
 *
 * Source: implementation-plan.md work package P11-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `addCandidate`.
 */
export function AddCandidateForm({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const router = useRouter();
  const mutation = useAddCandidate(gardenId);
  const isOnline = useIsOnline();
  const [taxonomyReferenceId, setTaxonomyReferenceId] = useState<string | null>(null);
  const [activePart, setActivePart] = useState<string | null>(null);
  const mapObjectsQuery = useGardenMapObjects(gardenId);
  const mapObjectOptions = [
    { value: NONE_VALUE, label: t('candidates.mapObjectNone') },
    ...(mapObjectsQuery.data ?? []).map((object) => ({
      value: object.id,
      label: object.label ? `${object.label} (${object.category})` : object.category,
    })),
  ];

  const { register, handleSubmit, formState, watch, reset, setValue } = useForm<AddCandidateValues>(
    {
      resolver: zodResolver(addCandidateSchema),
      defaultValues: DEFAULT_VALUES,
      // `quantity` is conditionally rendered on `groupingKind`; unregistering it
      // on unmount is what makes switching back to `individual` clear a
      // previously typed value instead of leaving a hidden, unfixable error.
      shouldUnregister: true,
    },
  );

  const groupingKind = watch('groupingKind');
  const currentValues = watch();

  const draft = useRecoverableDraft<AddCandidateDraftPayload>({
    draftType: 'candidates.addCandidate',
    scopeKey: gardenId,
    schemaVersion: ADD_CANDIDATE_DRAFT_SCHEMA_VERSION,
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
    // to a real value right after mount — see `useRecoverableDraft`'s own doc
    // comment, and `add-plant-form.tsx`'s identical effect, for why `reset`/
    // `acknowledgeRecovered` are deliberately not listed as dependencies.
  }, [draft.recoveredPayload]);

  const discardRecoveredDraft = () => {
    draft.dismissRecovered();
    reset(DEFAULT_VALUES);
    setTaxonomyReferenceId(null);
  };

  const togglePart = (part: string) => {
    setActivePart((current) => (current === part ? null : part));
  };

  const onSubmit = handleSubmit((values) => {
    const input: AddCandidateRequest = {
      displayName: values.displayName,
      groupingKind: values.groupingKind,
      ...(taxonomyReferenceId === null ? {} : { taxonomyReferenceId }),
      ...(values.varietyLabel === undefined || values.varietyLabel === ''
        ? {}
        : { varietyLabel: values.varietyLabel }),
      ...(values.quantity === undefined || values.quantity === ''
        ? {}
        : { quantity: Number(values.quantity) }),
      ...(values.rationaleNote === undefined || values.rationaleNote === ''
        ? {}
        : { rationaleNote: values.rationaleNote }),
      ...(values.priority === undefined || values.priority === NONE_VALUE
        ? {}
        : { priority: values.priority }),
      ...(values.priceAmount === undefined || values.priceAmount === ''
        ? {}
        : { priceAmount: Number(values.priceAmount) }),
      ...(values.priceCurrency === undefined || values.priceCurrency === ''
        ? {}
        : { priceCurrency: values.priceCurrency }),
      ...(values.purchaseSource === undefined || values.purchaseSource === ''
        ? {}
        : { purchaseSource: values.purchaseSource }),
      ...(values.proposedGardenAreaMapObjectId === undefined ||
      values.proposedGardenAreaMapObjectId === ''
        ? {}
        : { proposedGardenAreaMapObjectId: values.proposedGardenAreaMapObjectId }),
      ...(values.proposedPlacementMapObjectId === undefined ||
      values.proposedPlacementMapObjectId === ''
        ? {}
        : { proposedPlacementMapObjectId: values.proposedPlacementMapObjectId }),
    };

    mutation.mutate(input, {
      onSuccess: (candidate) => {
        reset();
        setTaxonomyReferenceId(null);
        draft.clearDraft();
        router.push(`/application/gardens/${gardenId}/candidates/${candidate.id}`);
      },
    });
  });

  return (
    <CommandSurface className={styles['form']} onCommit={() => void onSubmit()}>
      {draft.recovered && <RecoveredDraftNotice onDiscard={discardRecoveredDraft} />}
      <div className={styles['commandRow']}>
        <TextField
          label={t('candidates.displayNameLabel')}
          maxLength={200}
          error={
            formState.errors.displayName === undefined
              ? undefined
              : t('candidates.displayNameRequired')
          }
          {...register('displayName')}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={!isOnline}
          iconOnly
          aria-label={t('candidates.addSubmit')}
          title={t('candidates.addSubmit')}
        >
          <PlusIcon />
        </Button>
      </div>

      <div className={styles['quickActions']}>
        {[
          {
            part: 'taxonomy',
            icon: <SproutIcon key="icon" />,
            label: t('candidates.taxonomySelectLabel'),
          },
          {
            part: 'variety',
            icon: <TagIcon key="icon" />,
            label: t('candidates.varietyLabelLabel'),
          },
          {
            part: 'grouping',
            icon: <PlusIcon key="icon" />,
            label: t('candidates.groupingKindLabel'),
          },
          {
            part: 'planning',
            icon: <LightbulbIcon key="icon" />,
            label: t('candidates.priorityLabel'),
          },
          {
            part: 'location',
            icon: <MapIcon key="icon" />,
            label: t('candidates.proposedGardenAreaMapObjectIdLabel'),
          },
        ].map(({ part, icon, label }) => (
          <Button
            key={part}
            variant="secondary"
            aria-pressed={activePart === part}
            onClick={() => togglePart(part)}
          >
            {icon}
            {label}
          </Button>
        ))}
      </div>

      <div className={styles['canvas']}>
        {activePart === 'taxonomy' && (
          <TaxonomyReferenceField
            gardenId={gardenId}
            value={taxonomyReferenceId}
            onChange={setTaxonomyReferenceId}
          />
        )}
        {activePart === 'variety' && (
          <TextField
            label={t('candidates.varietyLabelLabel')}
            maxLength={200}
            {...register('varietyLabel')}
          />
        )}
        {activePart === 'grouping' && (
          <div className={styles['row']}>
            <div className={styles['choiceField']}>
              <span>{t('candidates.groupingKindLabel')}</span>
              <div className={styles['choices']}>
                {CANDIDATE_GROUPING_KINDS.map((kind: PlantGroupingKind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={groupingKind === kind}
                    onClick={() => setValue('groupingKind', kind, { shouldDirty: true })}
                  >
                    {t(candidateGroupingKindLabel(kind))}
                  </button>
                ))}
              </div>
            </div>
            {groupingKind !== 'individual' && (
              <TextField
                label={t('candidates.quantityLabel')}
                type="number"
                min={1}
                error={
                  formState.errors.quantity === undefined
                    ? undefined
                    : t('candidates.quantityInvalid')
                }
                {...register('quantity')}
              />
            )}
          </div>
        )}
        {activePart === 'planning' && (
          <div className={styles['planningGrid']}>
            <div className={styles['choiceField']}>
              <span>{t('candidates.priorityLabel')}</span>
              <div className={styles['choices']}>
                {PRIORITY_CHOICES.map((priority) => (
                  <button
                    key={priority || 'none'}
                    type="button"
                    aria-pressed={(currentValues.priority ?? NONE_VALUE) === priority}
                    onClick={() => setValue('priority', priority, { shouldDirty: true })}
                  >
                    {priority === NONE_VALUE
                      ? t('candidates.priorityNone')
                      : t(candidatePriorityLabel(priority))}
                  </button>
                ))}
              </div>
            </div>
            <TextField label={t('candidates.rationaleNoteLabel')} {...register('rationaleNote')} />
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
            <TextField
              label={t('candidates.purchaseSourceLabel')}
              maxLength={200}
              {...register('purchaseSource')}
            />
          </div>
        )}
        {activePart === 'location' && (
          <div className={styles['row']}>
            {(['proposedGardenAreaMapObjectId', 'proposedPlacementMapObjectId'] as const).map(
              (fieldName) => (
                <div className={styles['choiceField']} key={fieldName}>
                  <span>
                    {t(
                      fieldName === 'proposedGardenAreaMapObjectId'
                        ? 'candidates.proposedGardenAreaMapObjectIdLabel'
                        : 'candidates.proposedPlacementMapObjectIdLabel',
                    )}
                  </span>
                  <div className={styles['choices']}>
                    {mapObjectOptions.map((option) => (
                      <button
                        key={option.value || 'none'}
                        type="button"
                        aria-pressed={(currentValues[fieldName] ?? NONE_VALUE) === option.value}
                        onClick={() => setValue(fieldName, option.value, { shouldDirty: true })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <StaleIndicator />
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </CommandSurface>
  );
}
