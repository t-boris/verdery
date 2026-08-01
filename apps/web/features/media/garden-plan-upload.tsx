'use client';

import type { Media } from '@verdery/api-contracts';
import { useId, useState, type ChangeEvent } from 'react';
import { CloseIcon, RefreshIcon } from '@/shared/ui/public';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, ProgressBar, StaleIndicator } from '@/shared/ui/public';

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
const PDF_CONTENT_TYPE = 'application/pdf';

function percentOf(uploadedBytes: number, totalBytes: number): number {
  return totalBytes <= 0 ? 0 : (uploadedBytes / totalBytes) * 100;
}

function isPdf(media: Media): boolean {
  return (media.verifiedContentType ?? media.declaredContentType) === PDF_CONTENT_TYPE;
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
 * A PDF plan has no derivative yet (P6-WORKER-02's documented deferral), so
 * it gets an honest notice instead of a broken image.
 */
function PlanPreview({ gardenId, media }: { readonly gardenId: string; readonly media: Media }) {
  const { t } = useLocalization();
  const derivatives = media.derivatives ?? [];
  const displayDerivative =
    derivatives.find((entry) => entry.derivativeKind === 'screen_preview') ??
    derivatives.find((entry) => entry.derivativeKind === 'thumbnail');
  const accessQuery = useMediaAccess(
    gardenId,
    displayDerivative?.mediaId ?? '',
    displayDerivative !== undefined,
  );

  if (isPdf(media)) {
    return <p className={styles['pdfNotice']}>{t('media.plan.pdfNoPreview')}</p>;
  }
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
    <img
      className={styles['preview']}
      src={accessQuery.data.url}
      alt={t('media.plan.previewAlt', { filename: media.displayFilename })}
    />
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
  const inputId = useId();

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
            <Button variant="primary" disabled={!isOnline} onClick={upload.resumeRecovered}>
              {t('media.resumeRecovered')}
            </Button>
            <Button variant="secondary" onClick={upload.discardRecovered}>
              {t('media.discardRecovered')}
            </Button>
          </div>
        </div>
      )}

      {PICKER_PHASES.has(upload.phase) && (
        <div className={styles['picker']}>
          <label className={styles['fileLabel']} htmlFor={inputId}>
            {t('media.plan.selectFile')}
          </label>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
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
        <Button variant="secondary" onClick={upload.pause}>
          {t('media.pause')}
        </Button>
      )}

      {upload.phase === 'paused' && (
        <div className={styles['actions']}>
          <Button variant="primary" disabled={!isOnline} onClick={upload.retry}>
            {t('media.resume')}
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
