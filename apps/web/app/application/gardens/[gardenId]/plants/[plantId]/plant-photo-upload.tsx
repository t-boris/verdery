'use client';

import { useState, type ChangeEvent } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { formatBytes, useMediaUpload } from '@/features/media/public';
import { useAttachPlantPhoto } from '@/features/plants/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, FilePicker, ProgressBar } from '@/shared/ui/public';

import styles from './plant-photo-upload.module.css';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_PHOTO_BYTES = 50 * 1024 * 1024;

export interface PlantPhotoUploadProps {
  readonly gardenId: string;
  readonly plantId: string;
}

function percentOf(uploadedBytes: number, totalBytes: number): number {
  return totalBytes <= 0 ? 0 : (uploadedBytes / totalBytes) * 100;
}

/** Uploads a validated garden photo, then explicitly attaches that media record to an existing plant. */
export function PlantPhotoUpload({ gardenId, plantId }: PlantPhotoUploadProps) {
  const { t, locale } = useLocalization();
  const isOnline = useIsOnline();
  const upload = useMediaUpload(gardenId, 'garden_photo');
  const attach = useAttachPlantPhoto(gardenId, plantId);
  const [validationError, setValidationError] = useState<string | null>(null);

  const inProgress =
    upload.phase === 'registering' || upload.phase === 'uploading' || upload.phase === 'completing';
  const attachable = upload.mediaId !== null && upload.media?.uploadState === 'available';

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setValidationError(t('media.tooLarge', { max: formatBytes(MAX_PHOTO_BYTES, locale) }));
      return;
    }
    setValidationError(null);
    attach.reset();
    upload.startUpload(file);
  };

  const attachPhoto = () => {
    if (upload.mediaId === null) return;
    attach.mutate(
      { mediaId: upload.mediaId },
      {
        onSuccess: () => upload.cancel(),
      },
    );
  };

  return (
    <div className={styles['panel']}>
      {!attachable && !inProgress && upload.phase !== 'processing' && (
        <FilePicker
          label={t('media.selectFile')}
          action={t('media.chooseAction')}
          emptyText={t('media.noFileChosen')}
          accept={ACCEPTED_TYPES}
          disabled={!isOnline}
          onChange={onFileChange}
          {...(validationError === null ? {} : { error: validationError })}
        />
      )}

      {inProgress && (
        <ProgressBar
          value={percentOf(upload.uploadedBytes, upload.totalBytes)}
          label={t('media.progressLabel', {
            filename: upload.displayFilename ?? '',
            uploaded: formatBytes(upload.uploadedBytes, locale),
            total: formatBytes(upload.totalBytes, locale),
          })}
        />
      )}

      {upload.phase === 'processing' && !attachable && (
        <p role="status">{t('plants.photoValidating')}</p>
      )}
      {upload.phase === 'rejected' && <p role="alert">{t('media.rejectedDescription')}</p>}
      {upload.phase === 'processingFailed' && (
        <p role="alert">{t('media.processingFailedDescription')}</p>
      )}
      {upload.phase === 'apiFailed' && upload.apiFailure !== null && (
        <FailureAlert failure={upload.apiFailure} />
      )}
      {upload.phase === 'uploadFailed' && (
        <div className={styles['actions']}>
          <p role="alert">{t('plants.photoUploadFailed')}</p>
          {upload.retryable && (
            <Button variant="secondary" disabled={!isOnline} onClick={upload.retry}>
              {t('media.retry')}
            </Button>
          )}
        </div>
      )}

      {attachable && (
        <div className={styles['actions']}>
          <span>{upload.displayFilename}</span>
          <Button variant="primary" busy={attach.isPending} onClick={attachPhoto}>
            {t('plants.photoAttach')}
          </Button>
          <Button variant="secondary" disabled={attach.isPending} onClick={upload.cancel}>
            {t('media.cancel')}
          </Button>
        </div>
      )}

      {attach.isSuccess && <p role="status">{t('plants.photoAttached')}</p>}
      {attach.isError && <FailureAlert failure={attach.error.failure} />}
    </div>
  );
}
