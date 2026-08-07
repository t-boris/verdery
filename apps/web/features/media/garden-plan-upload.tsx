'use client';

import type { Media } from '@verdery/api-contracts';
import { useState, type ChangeEvent } from 'react';
import { CloseIcon, PauseIcon, RefreshIcon, FilePicker } from '@/shared/ui/public';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  Card,
  FailureAlert,
  PhotoLightbox,
  ProgressBar,
  StaleIndicator,
} from '@/shared/ui/public';

import styles from './garden-plan-upload.module.css';
import { formatBytes, uploadFailureReasonLabel, uploadPhaseLabel } from './labels';
import { useMediaAccess } from './queries';
import { useMediaUpload } from './use-media-upload';

export interface GardenPlanUploadProps {
  readonly gardenId: string;
}

/**
 * Section 8.1's accepted `imported_plan` types: the raster image types plus
 * PDF — mirrors `services/workers/src/validation/validation-policy.ts`'s own
 * `imported_plan` allowlist, checked locally for fast feedback; the worker
 * enforces it authoritatively byte-level.
 */
const ACCEPTED_PLAN_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_PLAN_TYPES.join(',');
/** `validation-policy.ts`'s own `imported_plan` ceiling (50 MiB), checked client-side before any byte uploads. */
const MAX_PLAN_BYTES = 50 * 1024 * 1024;
function percentOf(uploadedBytes: number, totalBytes: number): number {
  return totalBytes <= 0 ? 0 : (uploadedBytes / totalBytes) * 100;
}

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

/**
 * Renders the processed plan's own screen-preview DERIVATIVE (resolved
 * through `Media.derivatives`, P6-PLAN-01) — never the original document:
 * plans are sensitive originals (media-storage-and-processing.md section
 * 11), and the metadata-stripped derivative is the approved display asset.
 * A PDF plan is no longer a special case: the worker renders its first page
 * (ADR-0016), so the same screen-preview derivative exists for a plat and a
 * scan alike. Until that render lands, the ordinary "no preview yet" line
 * covers it, as it does for any image still being processed.
 */
function PlanPreview({ gardenId, media }: { readonly gardenId: string; readonly media: Media }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const derivatives = media.derivatives ?? [];
  const displayDerivative =
    derivatives.find((entry) => entry.derivativeKind === 'screen_preview') ??
    derivatives.find((entry) => entry.derivativeKind === 'thumbnail');
  const accessQuery = useMediaAccess(
    gardenId,
    displayDerivative?.mediaId ?? '',
    displayDerivative !== undefined,
  );

  if (displayDerivative === undefined) {
    return <p className={styles['statusLine']}>{t('media.plan.previewUnavailable')}</p>;
  }
  if (accessQuery.isPending) {
    return <p role="status">{t('media.previewLoading')}</p>;
  }
  if (accessQuery.isError) {
    return <FailureAlert failure={accessQuery.error.failure} />;
  }
  return (
    <>
      <button
        type="button"
        className={styles['previewButton']}
        onClick={() => setOpen(true)}
        aria-label={t('media.previewOpenFullscreen')}
      >
        <img
          className={styles['preview']}
          src={accessQuery.data.url}
          alt={t('media.plan.previewAlt', { filename: media.displayFilename })}
        />
      </button>
      <PhotoLightbox
        photos={[
          {
            id: displayDerivative.mediaId,
            src: accessQuery.data.url,
            alt: t('media.plan.previewAlt', { filename: media.displayFilename }),
            caption: media.displayFilename,
          },
        ]}
        activeIndex={open ? 0 : null}
        dialogLabel={media.displayFilename}
        closeLabel={t('media.previewCloseFullscreen')}
        previousLabel={t('media.previewPrevious')}
        nextLabel={t('media.previewNext')}
        onSelect={() => undefined}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/**
 * Property-plan document upload (P6-PLAN-01): select -> local safety
 * validation (type + 50 MiB cap, mirroring the worker's own
 * `validation-policy.ts` limits for fast feedback) -> private upload via
 * the same `useMediaUpload` machinery `GardenPhotoUpload` established, with
 * `media_class: 'imported_plan'`. Once processing succeeds, the plan is
 * available to the map editor's imported-background panel
 * (`features/map/imported-background-panel.tsx`) to place on the map.
 *
 * Source: architecture/garden-capture-and-scan.md, section "8. Plan Import
 * Flow" (steps: select document -> local preview and safety validation ->
 * register and upload private media); implementation-plan.md work package
 * P6-PLAN-01.
 */
export function GardenPlanUpload({ gardenId }: GardenPlanUploadProps) {
  const { t, locale } = useLocalization();
  const isOnline = useIsOnline();
  const upload = useMediaUpload(gardenId, 'imported_plan');
  const [validationError, setValidationError] = useState<string | null>(null);

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
    if (!(ACCEPTED_PLAN_TYPES as readonly string[]).includes(file.type)) {
      setValidationError(t('media.plan.unsupportedType'));
      return;
    }
    if (file.size > MAX_PLAN_BYTES) {
      setValidationError(t('media.tooLarge', { max: formatBytes(MAX_PLAN_BYTES, locale) }));
      return;
    }
    setValidationError(null);
    upload.startUpload(file);
  };

  return (
    <Card title={t('media.plan.title')}>
      <p className={styles['description']}>{t('media.plan.description')}</p>

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
        <FilePicker
          label={t('media.plan.selectFile')}
          action={t('media.chooseAction')}
          emptyText={t('media.noFileChosen')}
          accept={ACCEPT_ATTRIBUTE}
          disabled={!isOnline}
          onChange={onFileChange}
          {...(validationError === null ? {} : { error: validationError })}
        />
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

      {upload.phase === 'processed' && upload.media !== null && (
        <>
          <p className={styles['statusLine']}>{t('media.plan.readyForMap')}</p>
          <PlanPreview gardenId={gardenId} media={upload.media} />
        </>
      )}
    </Card>
  );
}
