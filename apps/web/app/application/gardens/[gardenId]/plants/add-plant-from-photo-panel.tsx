'use client';

import type { PlantIdentificationSuggestion } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ChangeEvent } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import {
  formatBytes,
  useMediaUpload,
  uploadFailureReasonLabel,
  uploadPhaseLabel,
} from '@/features/media/public';
import {
  lifecycleStageLabel,
  useAddPlantFromPhoto,
  useConfirmPlantIdentification,
  usePlantIdentification,
  useRecordObservationFromIdentification,
} from '@/features/plants/public';
import type { ReactNode } from 'react';

import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  CalendarIcon,
  CloseIcon,
  FailureAlert,
  LightbulbIcon,
  PauseIcon,
  ProgressBar,
  PulseIcon,
  RefreshIcon,
  SproutIcon,
  StaleIndicator,
  TagIcon,
} from '@/shared/ui/public';

import styles from './add-plant-from-photo-panel.module.css';

export interface AddPlantFromPhotoPanelProps {
  readonly gardenId: string;
}

/** Section 8.1's accepted garden-photo raster types — reused as-is: the photo backing an identification is stored the same way a garden photo is (`media_class: 'garden_photo'`). */
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_PHOTO_BYTES = 50 * 1024 * 1024;

const PICKER_PHASES = new Set(['idle', 'processed', 'rejected', 'processingFailed']);
const CANCELLABLE_PHASES = new Set([
  'registering',
  'uploading',
  'paused',
  'completing',
  'processing',
  'uploadFailed',
  'apiFailed',
]);

function percentOf(uploadedBytes: number, totalBytes: number): number {
  return totalBytes <= 0 ? 0 : (uploadedBytes / totalBytes) * 100;
}

/** Scientific name, with the common name parenthesized when known — the same convention `taxonomy-reference-field.tsx`'s own (unexported) `taxonomyReferenceLabel` already establishes for a full `TaxonomyReference`. */
function suggestionLabel(suggestion: PlantIdentificationSuggestion): string {
  return suggestion.commonName === null
    ? suggestion.scientificName
    : `${suggestion.scientificName} (${suggestion.commonName})`;
}

/** The AI's own raw name guess, when it was confident but the catalog had no match for it — mirrors `suggestionLabel`'s own convention, and `plant-detail.tsx`'s own identical (unexported) helper. */
function rawSuggestionLabel(commonName: string, scientificName: string | null): string {
  return scientificName === null ? commonName : `${scientificName} (${commonName})`;
}

/** Icon, label above, value below, with real line height — mirrors `plant-detail.tsx`'s own identical (unexported) `DetailRow` helper. */
function DetailRow({
  icon,
  label,
  value,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className={styles['suggestionDetailRow']}>
      <span className={styles['suggestionDetailIcon']}>{icon}</span>
      <div>
        <span className={styles['suggestionDetailLabel']}>{label}</span>
        <p className={styles['suggestionDetailValue']}>{value}</p>
      </div>
    </div>
  );
}

/**
 * Creates a plant identified from a photo (ADR-0015): upload → `AddPlantFromPhoto`
 * → review the AI's suggestion → confirm it, or decide later — then hand off
 * to the plant's own detail page, the same create-then-navigate pattern
 * `add-plant-form.tsx` uses for the manual path.
 *
 * Lives beside `page.tsx` rather than inside `features/plants` because it
 * needs `features/media`'s upload capability directly: `architecture/
 * web-application-design.md`, section "20. Dependency Rules" restricts a
 * FEATURE to importing only public Core and Shared interfaces, but the page
 * layer itself already composes multiple features as siblings (see
 * `app/application/gardens/[gardenId]/page.tsx`'s own `GardenPhotoUpload`
 * usage) — this file is that same composition, just given its own name for
 * readability instead of being inlined into `page.tsx`.
 *
 * Mirrors `features/media/garden-photo-upload.tsx`'s upload-phase handling
 * for the picking step; the photo is registered under `media_class:
 * 'garden_photo'`, the same class `AttachPlantPhoto`'s own iOS/Android
 * callers use for a plant photo — there is no dedicated `plant_photo` media
 * class in the contract.
 *
 * Source: ADR-0015; implementation-plan.md section 19;
 * packages/api-contracts/openapi.yaml, operations `addPlantFromPhoto`,
 * `getPlantIdentification`, `confirmPlantIdentification`.
 */
export function AddPlantFromPhotoPanel({ gardenId }: AddPlantFromPhotoPanelProps) {
  const { t, locale } = useLocalization();
  const router = useRouter();
  const isOnline = useIsOnline();
  const upload = useMediaUpload(gardenId, 'garden_photo');
  const addFromPhoto = useAddPlantFromPhoto(gardenId);
  const confirmIdentification = useConfirmPlantIdentification(gardenId);
  const recordObservation = useRecordObservationFromIdentification(gardenId);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputId = useId();

  const plant = addFromPhoto.data ?? null;
  const identification = usePlantIdentification(gardenId, plant?.id ?? '', plant !== null);

  /*
   * The id alone is NOT the signal to create the plant. `mediaId` is set the
   * moment the upload is REGISTERED — before a single byte is stored — so
   * firing on it called `AddPlantFromPhoto` against a media record that was
   * still `pending`, and the server correctly refused it with
   * `plants_inventory.plant.media_not_available`. Observed in production as a
   * 400 arriving 93ms after the registration's own 201.
   *
   * `uploadState === 'available'` is the server's own precondition, so gating
   * on the same value is what makes the two agree. Deliberately not
   * `phase === 'processed'`: derivative processing is irrelevant to
   * identifying a plant, and in development it can stay `processing`
   * indefinitely, which would strand the flow.
   */
  const uploadedMediaId = upload.media?.uploadState === 'available' ? upload.mediaId : null;

  useEffect(() => {
    if (uploadedMediaId !== null && plant === null && addFromPhoto.isIdle) {
      addFromPhoto.mutate({ photoMediaId: uploadedMediaId });
    }
  }, [uploadedMediaId, plant, addFromPhoto]);

  const percent = percentOf(upload.uploadedBytes, upload.totalBytes);
  const inProgress =
    upload.phase === 'registering' || upload.phase === 'uploading' || upload.phase === 'completing';

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared immediately so selecting the SAME file again still fires `onChange`.
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setValidationError(t('media.tooLarge', { max: formatBytes(MAX_PHOTO_BYTES, locale) }));
      return;
    }
    setValidationError(null);
    upload.startUpload(file);
  };

  const goToPlant = () => {
    if (plant !== null) {
      router.push(`/application/gardens/${gardenId}/plants/${plant.id}`);
    }
  };

  const onConfirm = () => {
    if (plant === null || identification.data === null || identification.data === undefined) {
      return;
    }
    confirmIdentification.mutate(
      {
        plantId: plant.id,
        identificationId: identification.data.id,
        expectedRevision: plant.revision,
      },
      { onSuccess: goToPlant },
    );
  };

  const onRecordObservation = () => {
    if (plant === null || identification.data === null || identification.data === undefined) {
      return;
    }
    recordObservation.mutate({ plantId: plant.id, identificationId: identification.data.id });
  };

  if (plant !== null) {
    // `undefined` before the query resolves, `null` once resolved with
    // nothing pending (already confirmed, or no row at all — an unexpected
    // edge case immediately after creation, treated the same honest way:
    // nothing left to review here).
    const suggestedTaxonomy = identification.data?.suggestedTaxonomy ?? null;
    const rawSuggestedCommonName = identification.data?.suggestedCommonName ?? null;
    const hasConfirmableSuggestion = suggestedTaxonomy !== null || rawSuggestedCommonName !== null;
    const suggestedVarietyLabel = identification.data?.suggestedVarietyLabel ?? null;
    const suggestedLifecycleStage = identification.data?.suggestedLifecycleStage ?? null;
    const suggestedConditionNote = identification.data?.suggestedConditionNote ?? null;
    const suggestedCareGuidanceNote = identification.data?.suggestedCareGuidanceNote ?? null;
    const suggestedAcquisitionDate = identification.data?.suggestedAcquisitionDate ?? null;

    return (
      <div>
        <p className={styles['description']}>{t('plants.addFromPhotoDescription')}</p>

        {identification.isPending && (
          <p className={styles['statusLine']}>{t('plants.identificationLoading')}</p>
        )}

        {identification.isError && <FailureAlert failure={identification.error.failure} />}

        {identification.isSuccess && (
          <>
            <div className={styles['suggestion']}>
              <p className={styles['suggestionName']}>
                {suggestedTaxonomy !== null
                  ? suggestionLabel(suggestedTaxonomy)
                  : rawSuggestedCommonName !== null
                    ? rawSuggestionLabel(
                        rawSuggestedCommonName,
                        identification.data?.suggestedScientificName ?? null,
                      )
                    : t('plants.identificationNoConfidentMatch')}
              </p>
              {suggestedTaxonomy === null && rawSuggestedCommonName !== null && (
                <p className={styles['suggestionConfidence']}>
                  {t('plants.identificationUnlistedNote')}
                </p>
              )}
              {hasConfirmableSuggestion && identification.data !== null && (
                <p className={styles['suggestionConfidence']}>
                  {`${t('plants.identificationConfidenceLabel')}: ${t('plants.identificationConfidenceValue', { percent: Math.round(identification.data.confidenceScore * 100) })}`}
                </p>
              )}
              <div className={styles['suggestionDetails']}>
                {suggestedVarietyLabel !== null && (
                  <DetailRow
                    icon={<TagIcon />}
                    label={t('plants.identificationVarietyLabel')}
                    value={suggestedVarietyLabel}
                  />
                )}
                {suggestedLifecycleStage !== null && (
                  <DetailRow
                    icon={<SproutIcon />}
                    label={t('plants.identificationGrowthStageLabel')}
                    value={t(lifecycleStageLabel(suggestedLifecycleStage))}
                  />
                )}
                {suggestedConditionNote !== null && (
                  <DetailRow
                    icon={<PulseIcon />}
                    label={t('plants.identificationConditionLabel')}
                    value={suggestedConditionNote}
                  />
                )}
                {suggestedCareGuidanceNote !== null && (
                  <DetailRow
                    icon={<LightbulbIcon />}
                    label={t('plants.identificationCareGuidanceLabel')}
                    value={suggestedCareGuidanceNote}
                  />
                )}
                {suggestedAcquisitionDate !== null && (
                  <DetailRow
                    icon={<CalendarIcon />}
                    label={t('plants.identificationAcquisitionDateLabel')}
                    value={suggestedAcquisitionDate}
                  />
                )}
              </div>
            </div>

            <div className={styles['actions']}>
              {hasConfirmableSuggestion && (
                <Button
                  variant="primary"
                  busy={confirmIdentification.isPending}
                  onClick={onConfirm}
                >
                  {t('plants.identificationConfirm')}
                </Button>
              )}
              {suggestedConditionNote !== null && (
                <Button
                  variant="secondary"
                  busy={recordObservation.isPending}
                  onClick={onRecordObservation}
                >
                  {t('plants.identificationRecordObservationButton')}
                </Button>
              )}
              <Button variant="secondary" onClick={goToPlant}>
                {t('plants.identificationLater')}
              </Button>
            </div>
            {confirmIdentification.isError && (
              <FailureAlert failure={confirmIdentification.error.failure} />
            )}
            {recordObservation.isSuccess && (
              <p role="status">{t('plants.identificationObservationRecordedMessage')}</p>
            )}
            {recordObservation.isError && (
              <FailureAlert failure={recordObservation.error.failure} />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className={styles['description']}>{t('plants.addFromPhotoDescription')}</p>

      {upload.phase === 'recoverable' && (
        <div className={styles['recoverable']}>
          <p>
            {t('media.recoverableDescription', {
              filename: upload.displayFilename ?? '',
              percent: Math.round(percent),
            })}
          </p>
          <div className={styles['actions']}>
            <Button
              variant="primary"
              disabled={!isOnline}
              onClick={upload.resumeRecovered}
              iconOnly
              aria-label={t('media.resumeRecovered')}
              title={t('media.resumeRecovered')}
            >
              <RefreshIcon />
            </Button>
            <Button
              variant="secondary"
              onClick={upload.discardRecovered}
              iconOnly
              aria-label={t('media.discardRecovered')}
              title={t('media.discardRecovered')}
            >
              <CloseIcon />
            </Button>
          </div>
        </div>
      )}

      {PICKER_PHASES.has(upload.phase) && (
        <div className={styles['picker']}>
          <label className={styles['fileLabel']} htmlFor={inputId}>
            {t('media.selectFile')}
          </label>
          <input
            id={inputId}
            type="file"
            accept={ACCEPTED_TYPES}
            disabled={!isOnline}
            onChange={onFileChange}
          />
          {validationError !== null && (
            <p className={styles['validationError']}>{validationError}</p>
          )}
        </div>
      )}

      {inProgress && (
        <ProgressBar
          value={percent}
          label={t('media.progressLabel', {
            filename: upload.displayFilename ?? '',
            uploaded: formatBytes(upload.uploadedBytes, locale),
            total: formatBytes(upload.totalBytes, locale),
          })}
        />
      )}
      {(inProgress || upload.phase === 'paused') && (
        <p className={styles['statusLine']}>{t(uploadPhaseLabel(upload.phase))}</p>
      )}

      {upload.phase === 'uploading' && (
        <Button
          variant="secondary"
          onClick={upload.pause}
          iconOnly
          aria-label={t('media.pause')}
          title={t('media.pause')}
        >
          <PauseIcon />
        </Button>
      )}

      {upload.phase === 'paused' && (
        <div className={styles['actions']}>
          <Button
            variant="primary"
            disabled={!isOnline}
            onClick={upload.retry}
            iconOnly
            aria-label={t('media.resume')}
            title={t('media.resume')}
          >
            <RefreshIcon />
          </Button>
        </div>
      )}

      {upload.phase === 'processing' && (
        <>
          <p className={styles['statusLine']}>{t(uploadPhaseLabel(upload.phase))}</p>
          <StaleIndicator failure={upload.pollFailure} />
        </>
      )}

      {upload.phase === 'sessionExpired' && (
        <p className={styles['statusLine']}>{t('media.phase.sessionExpired')}</p>
      )}

      {upload.phase === 'uploadFailed' && upload.uploadFailureReason !== null && (
        <div className={styles['failure']}>
          <p className={styles['statusLine']}>
            {t(uploadFailureReasonLabel(upload.uploadFailureReason))}
          </p>
          {upload.retryable && (
            <Button
              variant="primary"
              disabled={!isOnline}
              onClick={upload.retry}
              iconOnly
              aria-label={t('media.retry')}
              title={t('media.retry')}
            >
              <RefreshIcon />
            </Button>
          )}
        </div>
      )}

      {upload.phase === 'apiFailed' && upload.apiFailure !== null && (
        <div className={styles['failure']}>
          <FailureAlert failure={upload.apiFailure} />
          <Button variant="primary" disabled={!isOnline} onClick={upload.retry}>
            {t('media.retry')}
          </Button>
        </div>
      )}

      {upload.phase === 'rejected' && (
        <p className={styles['statusLine']}>{t('media.rejectedDescription')}</p>
      )}

      {upload.phase === 'processingFailed' && (
        <p className={styles['statusLine']}>{t('media.processingFailedDescription')}</p>
      )}

      {CANCELLABLE_PHASES.has(upload.phase) && (
        <Button
          variant="secondary"
          onClick={upload.cancel}
          iconOnly
          aria-label={t('media.cancel')}
          title={t('media.cancel')}
        >
          <CloseIcon />
        </Button>
      )}

      {uploadedMediaId !== null && addFromPhoto.isPending && (
        <p className={styles['statusLine']}>{t('plants.addFromPhotoCreating')}</p>
      )}
      {addFromPhoto.isError && <FailureAlert failure={addFromPhoto.error.failure} />}
    </div>
  );
}
