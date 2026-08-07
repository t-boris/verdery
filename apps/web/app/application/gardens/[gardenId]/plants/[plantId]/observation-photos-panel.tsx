'use client';

import type {
  ObservationPhotoAttachmentRequest,
  ObservationPhotoPurpose,
} from '@verdery/api-contracts';
import { useState, type ChangeEvent } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useExactDuplicateMedia, useMediaUpload, useSimilarMedia } from '@/features/media/public';
import { OBSERVATION_PHOTO_PURPOSES, photoPurposeLabel } from '@/features/observations/public';
import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  CloseIcon,
  FailureAlert,
  FilePicker,
  PlusIcon,
  ProgressBar,
  Select,
} from '@/shared/ui/public';

import styles from './observation-photos-panel.module.css';

export interface ObservationPhotosPanelProps {
  readonly gardenId: string;
  readonly value: readonly ObservationPhotoAttachmentRequest[];
  readonly onChange: (value: readonly ObservationPhotoAttachmentRequest[]) => void;
}

/** Section 8.1's accepted raster types, the same set `garden-photo-upload.tsx` accepts. */
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

function percentOf(uploadedBytes: number, totalBytes: number): number {
  return totalBytes <= 0 ? 0 : (uploadedBytes / totalBytes) * 100;
}

/**
 * Photo attachment for a new observation, with the purpose label that makes a
 * journal sequence comparable (P11-MEDIA-01, guided capture).
 *
 * Two steps, not one: a photo uploads first, and is attached to the
 * observation only once it has been validated. That is the server's rule, not
 * a preference — `attachObservationPhotos` refuses any media that is not yet
 * `available` — so offering "attach" earlier would only produce a failure the
 * reader cannot act on.
 *
 * The purpose is chosen at attach time rather than defaulted silently. A
 * mislabelled shot is worse than an unlabelled one: it lands in a comparison
 * sequence it does not belong to, and nothing downstream can tell.
 *
 * A photo uploaded and then never submitted leaves a media record behind. That
 * is the media module's own concern — an unattached record is exactly what its
 * retention sweep collects — and not something this form should try to undo on
 * unmount, where a failed cleanup would be invisible anyway.
 *
 * Lives at the route layer, not inside `features/observations`, because it
 * composes two features — the media feature's upload machinery and the
 * observations feature's purpose vocabulary — and features never import each
 * other (architecture/web-application-design.md, section "20. Dependency
 * Rules"). Same placement and same reasoning as
 * `../add-plant-from-photo-panel.tsx`.
 *
 * Source: architecture/media-storage-and-processing.md, sections "6. Upload
 * State Machine" and "7. Upload Flow"; architecture/plant-intelligence-and-visual-journal.md §8.2.
 */
export function ObservationPhotosPanel({ gardenId, value, onChange }: ObservationPhotosPanelProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const upload = useMediaUpload(gardenId, 'garden_photo');
  // Asked once the upload has a checksum, which is also when it has a media id
  // to exclude — a record always matches its own bytes.
  const duplicates = useExactDuplicateMedia(gardenId, upload.checksumSha256, upload.mediaId);
  const similar = useSimilarMedia(gardenId, upload.mediaId);
  const [purpose, setPurpose] = useState<ObservationPhotoPurpose>('whole_plant');

  const percent = percentOf(upload.uploadedBytes, upload.totalBytes);
  const inProgress =
    upload.phase === 'registering' || upload.phase === 'uploading' || upload.phase === 'completing';
  const attachable = upload.phase === 'processed' && upload.mediaId !== null;

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared immediately so picking the SAME file again still fires `onChange`.
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    upload.startUpload(file);
  };

  const attach = () => {
    if (upload.mediaId === null) {
      return;
    }
    onChange([...value, { mediaId: upload.mediaId, purpose }]);
    // Returns the widget to its picker state, so the next photo of this same
    // observation starts from a clean upload rather than the finished one.
    upload.cancel();
  };

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t('observations.photosLegend')}</legend>

      {value.length > 0 && (
        <ul className={styles['attached']}>
          {value.map((photo) => (
            <li className={styles['attachedRow']} key={photo.mediaId}>
              <span>{t(photoPurposeLabel(photo.purpose))}</span>
              <Button
                variant="secondary"
                iconOnly
                aria-label={t('observations.photoRemove')}
                title={t('observations.photoRemove')}
                onClick={() =>
                  onChange(value.filter((existing) => existing.mediaId !== photo.mediaId))
                }
              >
                <CloseIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!attachable && !inProgress && (
        <div className={styles['picker']}>
          <FilePicker
            label={t('observations.photoSelect')}
            action={t('observations.photoSelect')}
            emptyText={t('observations.photoSelect')}
            accept={ACCEPTED_TYPES}
            disabled={!isOnline}
            onChange={onFileChange}
          />
        </div>
      )}

      {inProgress && (
        <ProgressBar
          value={percent}
          label={t('observations.photoUploading', { filename: upload.displayFilename ?? '' })}
        />
      )}

      {upload.phase === 'processing' && (
        <p className={styles['status']}>{t('observations.photoValidating')}</p>
      )}

      {upload.phase === 'rejected' && (
        <p className={styles['error']}>{t('observations.photoRejected')}</p>
      )}

      {upload.phase === 'processingFailed' && (
        <p className={styles['error']}>{t('observations.photoProcessingFailed')}</p>
      )}

      {upload.phase === 'apiFailed' && upload.apiFailure !== null && (
        <FailureAlert failure={upload.apiFailure} />
      )}

      {upload.phase === 'uploadFailed' && (
        <div className={styles['status']}>
          <p className={styles['error']}>{t('observations.photoUploadFailed')}</p>
          {upload.retryable && (
            <Button variant="secondary" disabled={!isOnline} onClick={upload.retry}>
              {t('observations.photoRetry')}
            </Button>
          )}
        </div>
      )}

      {attachable && duplicates.duplicates.length > 0 && (
        // A warning, never a block: the same photograph is sometimes worth
        // attaching twice — to two different observations, or with a different
        // purpose — and only the person who took it knows.
        <p className={styles['status']}>
          {t('observations.photoDuplicate', {
            filename: duplicates.duplicates[0]?.displayFilename ?? '',
          })}
        </p>
      )}

      {attachable && duplicates.duplicates.length === 0 && similar.similar.length > 0 && (
        // Only when the bytes did NOT match: an exact duplicate is already
        // reported above with certainty, and saying "this looks like" about
        // the very same file would understate what is known.
        <p className={styles['status']}>
          {t('observations.photoNearDuplicate', {
            filename: similar.similar[0]?.displayFilename ?? '',
          })}
        </p>
      )}

      {attachable && (
        <div className={styles['attachRow']}>
          <Select
            label={t('observations.photoPurposeLabel')}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value as ObservationPhotoPurpose)}
            options={OBSERVATION_PHOTO_PURPOSES.map((option) => ({
              value: option,
              label: t(photoPurposeLabel(option)),
            }))}
          />
          <Button variant="primary" onClick={attach}>
            <PlusIcon />
            {t('observations.photoAttach')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
