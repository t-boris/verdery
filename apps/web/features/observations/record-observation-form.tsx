'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type {
  ObservationMeasurementInput,
  ObservationPhotoAttachmentRequest,
  ObservationSymptomInput,
  RecordObservationRequest,
} from '@verdery/api-contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useIsOnline } from '@/core/connectivity/public';
import { useRecoverableDraft } from '@/core/drafts/public';
import { useLocalization } from '@/shared/localization/public';
import {
  PlusIcon,
  Button,
  FailureAlert,
  RecoveredDraftNotice,
  StaleIndicator,
  TextField,
} from '@/shared/ui/public';

import { ObservationMeasurementsField } from './observation-measurements-field';
import { ObservationSymptomsField } from './observation-symptoms-field';
import styles from './record-observation-form.module.css';
import { useRecordObservation } from './queries';

const observationFields = z.object({
  noteText: z.string().trim().max(4000).optional(),
  conditionSummary: z.string().trim().max(4000).optional(),
  plantId: z.string().trim().optional(),
  gardenObjectId: z.string().trim().optional(),
  observedAt: z.string().trim().optional(),
});

type RecordObservationValues = z.infer<typeof observationFields>;

/**
 * The contract's own rule: at least one of `noteText`, `conditionSummary`, or
 * a photo. A purpose-labelled photograph with no words is a complete journal
 * entry (P11-MEDIA-01), so the requirement is checked against what is actually
 * attached rather than assuming the text fields are the only content.
 *
 * `hasPhotos` is read through a getter rather than captured: the schema is
 * built once, and a schema rebuilt on every attachment would be a new resolver
 * identity on every render.
 */
function recordObservationSchema(hasPhotos: () => boolean) {
  return observationFields.superRefine((values, ctx) => {
    const hasNote = (values.noteText ?? '') !== '';
    const hasSummary = (values.conditionSummary ?? '') !== '';
    if (!hasNote && !hasSummary && !hasPhotos()) {
      ctx.addIssue({
        code: 'custom',
        path: ['noteText'],
        message: 'a note, a condition summary, or a photo is required',
      });
    }
  });
}

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
  /**
   * Photographs already uploaded and labelled, ready to attach to this
   * observation. Owned outside the form because uploading needs
   * `features/media` and one feature never imports another — the route layer
   * composes the two (see this route's own `observation-photos-panel.tsx`).
   */
  readonly photos?: readonly ObservationPhotoAttachmentRequest[];
  /** Called after a successful record, so whoever owns `photos` can clear the list this observation just consumed. */
  readonly onRecorded?: () => void;
}

/**
 * A journal entry: a note and/or a condition summary, typed measurements, and
 * purpose-labelled photographs (P11-MEDIA-01, guided capture).
 *
 * The photographs arrive as a prop rather than being uploaded here. Uploading
 * needs `features/media`, and a feature never imports another feature, so the
 * route layer owns that composition — the same seam
 * `add-plant-from-photo-panel.tsx` already uses. Measurements have no such
 * dependency and are owned here.
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
export function RecordObservationForm({
  gardenId,
  fixedPlantId,
  photos,
  onRecorded,
}: RecordObservationFormProps) {
  const { t } = useLocalization();
  const mutation = useRecordObservation(gardenId);
  const isOnline = useIsOnline();
  const [measurements, setMeasurements] = useState<readonly ObservationMeasurementInput[]>([]);
  const [symptoms, setSymptoms] = useState<readonly ObservationSymptomInput[]>([]);

  // Read at validation time, so attaching a photo satisfies the
  // note-or-summary-or-photo rule without rebuilding the resolver.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const { register, handleSubmit, formState, reset, watch } = useForm<RecordObservationValues>({
    resolver: zodResolver(
      useMemo(() => recordObservationSchema(() => (photosRef.current?.length ?? 0) > 0), []),
    ),
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
      // Both carry a schema `default: []`, which the generated type surfaces
      // as required rather than optional — so they are always sent, empty or
      // not.
      photos: [...(photos ?? [])],
      // A row the reader added and then left at zero with no unit is not a
      // measurement; sending it would fail the schema's own `minLength` on
      // `unit` and lose the whole observation over a stray row.
      measurements: measurements.filter((measurement) => measurement.unit.trim() !== ''),
      symptoms: [...symptoms],
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
        setMeasurements([]);
        setSymptoms([]);
        draft.clearDraft();
        onRecorded?.();
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
            : t('observations.noteSummaryOrPhotoRequired')
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
      <ObservationSymptomsField value={symptoms} onChange={setSymptoms} />
      <ObservationMeasurementsField value={measurements} onChange={setMeasurements} />
      {/*
        The recoverable draft carries the text fields only. Measurements and
        attached photographs are not restored after a reload: a media id
        restored into a form whose upload widget has been re-created would
        claim an attachment the reader can no longer see or remove, and one
        they cannot verify is worse than one they re-add.
      */}
      <StaleIndicator />
      <Button type="submit" variant="primary" busy={mutation.isPending} disabled={!isOnline}>
        <PlusIcon />
        {t('observations.recordSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
