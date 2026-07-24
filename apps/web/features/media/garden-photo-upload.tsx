'use client';

import { useId, useState, type ChangeEvent } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, ProgressBar, StaleIndicator } from '@/shared/ui/public';

import styles from './garden-photo-upload.module.css';
import { uploadFailureReasonLabel, uploadPhaseLabel } from './labels';
import { MediaPreview } from './media-preview';
import { useMediaUpload } from './use-media-upload';

export interface GardenPhotoUploadProps {
  readonly gardenId: string;
}

/** Section 8.1's accepted garden-photo raster types. */
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
/** Section 8.1's declared garden-photo ceiling — checked client-side for fast feedback; the server enforces it authoritatively. */
const MAX_GARDEN_PHOTO_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(0)} KiB`;
  }
  return `${(kib / 1024).toFixed(1)} MiB`;
}

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
 * Real garden-photo upload: `media_class: 'garden_photo'`, the
 * architecturally simplest attachment point this work package targets. A
 * garden photo needs no further "attach" command the way a plant photo
 * does (`AttachPlantPhoto`) — registering the upload against `gardenId`
 * with `mediaClass: 'garden_photo'` already IS the attachment.
 *
 * There is no `ListMedia`-shaped endpoint anywhere in this contract (the
 * `Media` tag exposes exactly `register`/`getStatus`/`complete`/`getAccess`
 * — checked directly against `packages/api-contracts/openapi.yaml`): a
 * garden's uploaded photos cannot be listed back from the server. This
 * widget therefore shows the ONE most recent upload it drove itself (this
 * session's own `useMediaUpload` state, plus a same-session recovered
 * record after a reload) — not a gallery of a garden's whole photo history.
 * Building a client-side-only "gallery" by remembering every id this
 * browser has ever seen would be a fragile, easily-lost illusion of a
 * feature the backend does not actually provide; a real gallery needs a
 * real list endpoint, out of this work package's scope.
 *
 * Source: architecture/media-storage-and-processing.md, sections "6. Upload
 * State Machine", "7. Upload Flow", "12. Download Flow";
 * implementation-plan.md work package P6-WEB-01.
 */
export function GardenPhotoUpload({ gardenId }: GardenPhotoUploadProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const upload = useMediaUpload(gardenId, 'garden_photo');
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
    if (file.size > MAX_GARDEN_PHOTO_BYTES) {
      setValidationError(t('media.tooLarge', { max: formatBytes(MAX_GARDEN_PHOTO_BYTES) }));
      return;
    }
    setValidationError(null);
    upload.startUpload(file);
  };

  return (
    <Card title={t('gardens.photosTitle')}>
      <p className={styles['description']}>{t('gardens.photosDescription')}</p>

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
            uploaded: formatBytes(upload.uploadedBytes),
            total: formatBytes(upload.totalBytes),
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
            <Button variant="primary" disabled={!isOnline} onClick={upload.retry}>
              {t('media.retry')}
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
        <Button variant="secondary" onClick={upload.cancel}>
          {t('media.cancel')}
        </Button>
      )}

      {upload.mediaId !== null && (
        <MediaPreview
          gardenId={gardenId}
          mediaId={upload.mediaId}
          processingState={upload.media?.processingState ?? null}
          displayFilename={upload.displayFilename ?? ''}
        />
      )}
    </Card>
  );
}
