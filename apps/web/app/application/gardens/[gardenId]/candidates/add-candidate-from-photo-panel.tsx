'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { CloseIcon, RefreshIcon } from '@/shared/ui/public';

import { useIsOnline } from '@/core/connectivity/public';
import { useAddCandidateFromPhoto } from '@/features/candidates/public';
import {
  formatBytes,
  useMediaUpload,
  uploadFailureReasonLabel,
  uploadPhaseLabel,
} from '@/features/media/public';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, ProgressBar, StaleIndicator } from '@/shared/ui/public';

import styles from './add-candidate-from-photo-panel.module.css';

export interface AddCandidateFromPhotoPanelProps {
  readonly gardenId: string;
}

/** Section 8.1's accepted garden-photo raster types — reused as-is, mirroring `add-plant-from-photo-panel.tsx`'s identical constant. */
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

/**
 * Creates a plant candidate identified from a photo (P11-WEB-01):
 * upload → `AddCandidateFromPhoto` → straight to the candidate's own detail
 * page. Unlike `AddPlantFromPhotoPanel`, there is no suggestion-review step
 * to show here: `AddCandidateFromPhoto` applies the AI's guess directly to
 * the created candidate, so once creation succeeds there is nothing left to
 * confirm — the candidate's own detail page is where a wrong guess gets
 * edited or deleted, like any other candidate field.
 *
 * Lives beside `page.tsx` rather than inside `features/candidates` for the
 * same reason `AddPlantFromPhotoPanel` does: it needs `features/media`'s
 * upload capability directly, which a FEATURE may not import (architecture/
 * web-application-design.md, section "20. Dependency Rules"), but the page
 * layer may compose freely.
 *
 * Source: implementation-plan.md work package P11-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `addCandidateFromPhoto`.
 */
export function AddCandidateFromPhotoPanel({ gardenId }: AddCandidateFromPhotoPanelProps) {
  const { t, locale } = useLocalization();
  const router = useRouter();
  const isOnline = useIsOnline();
  const upload = useMediaUpload(gardenId, 'garden_photo');
  const addFromPhoto = useAddCandidateFromPhoto(gardenId);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputId = useId();

  /* Same gate, same reason as `add-plant-from-photo-panel.tsx` — see its own
     comment: `mediaId` exists from registration, `uploadState === 'available'`
     is the server's actual precondition. */
  const uploadedMediaId = upload.media?.uploadState === 'available' ? upload.mediaId : null;

  useEffect(() => {
    if (uploadedMediaId !== null && addFromPhoto.isIdle) {
      addFromPhoto.mutate(
        { photoMediaId: uploadedMediaId },
        {
          onSuccess: (candidate) => {
            router.push(`/application/gardens/${gardenId}/candidates/${candidate.id}`);
          },
        },
      );
    }
  }, [uploadedMediaId, addFromPhoto, gardenId, router]);

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

  return (
    <div>
      <p className={styles['description']}>{t('candidates.addFromPhotoDescription')}</p>

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
            <Button variant="primary" disabled={!isOnline} onClick={upload.retry}>
              <RefreshIcon />
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
          <CloseIcon />
          {t('media.cancel')}
        </Button>
      )}

      {uploadedMediaId !== null && addFromPhoto.isPending && (
        <p className={styles['statusLine']}>{t('candidates.addFromPhotoCreating')}</p>
      )}
      {addFromPhoto.isError && <FailureAlert failure={addFromPhoto.error.failure} />}
    </div>
  );
}
