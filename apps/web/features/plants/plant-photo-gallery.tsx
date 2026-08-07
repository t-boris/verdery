'use client';

import type { PlantPhoto } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, CloseIcon, FailureAlert } from '@/shared/ui/public';

import { usePlantPhotoAccess } from './plant-media-queries';
import styles from './plant-photo-gallery.module.css';
import { usePlantPhotos, useSetPrimaryPlantPhoto } from './queries';

export interface PlantPhotoGalleryProps {
  readonly gardenId: string;
  readonly plantId: string;
}

interface PlantPhotoThumbnailProps {
  readonly gardenId: string;
  readonly photo: PlantPhoto;
  readonly alt: string;
  readonly openLabel: string;
  readonly closeLabel: string;
  readonly makePrimaryLabel: string;
  readonly onSetPrimary: (photoId: string) => void;
  readonly settingPrimary: boolean;
}

/** One photo with signed-URL resolution, primary selection, and a screen-fitting lightbox. */
function PlantPhotoThumbnail({
  gardenId,
  photo,
  alt,
  openLabel,
  closeLabel,
  makePrimaryLabel,
  onSetPrimary,
  settingPrimary,
}: PlantPhotoThumbnailProps) {
  const query = usePlantPhotoAccess(gardenId, photo.mediaId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (query.data === undefined) {
    return <div className={styles['placeholder']} />;
  }

  return (
    <div className={styles['photo']}>
      <button
        type="button"
        className={styles['thumbnailButton']}
        onClick={() => setOpen(true)}
        aria-label={openLabel}
      >
        <img className={styles['thumbnail']} src={query.data.url} alt={alt} />
      </button>
      {photo.isPrimary ? (
        <span className={styles['primaryLabel']}>{alt}</span>
      ) : (
        <Button variant="secondary" busy={settingPrimary} onClick={() => onSetPrimary(photo.id)}>
          {makePrimaryLabel}
        </Button>
      )}
      {open && (
        <div
          className={styles['lightbox']}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <button
            type="button"
            className={styles['close']}
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <CloseIcon />
          </button>
          <img className={styles['fullImage']} src={query.data.url} alt={alt} />
        </div>
      )}
    </div>
  );
}

/** A plant's specimen photos, with full-screen viewing and primary-photo selection. */
export function PlantPhotoGallery({ gardenId, plantId }: PlantPhotoGalleryProps) {
  const { t } = useLocalization();
  const query = usePlantPhotos(gardenId, plantId);
  const setPrimary = useSetPrimaryPlantPhoto(gardenId, plantId);

  if (query.isPending) return null;
  if (query.isError) return <FailureAlert failure={query.error.failure} />;
  if (query.data.length === 0) return null;

  return (
    <div className={styles['gallery']}>
      {query.data.map((photo) => (
        <PlantPhotoThumbnail
          key={photo.id}
          gardenId={gardenId}
          photo={photo}
          alt={photo.isPrimary ? t('plants.photoPrimary') : t('plants.photoGalleryTitle')}
          openLabel={t('plants.photoOpenFullscreen')}
          closeLabel={t('plants.photoCloseFullscreen')}
          makePrimaryLabel={t('plants.photoMakePrimary')}
          onSetPrimary={(plantPhotoId) => setPrimary.mutate({ plantPhotoId })}
          settingPrimary={setPrimary.isPending}
        />
      ))}
      {setPrimary.isError && <FailureAlert failure={setPrimary.error.failure} />}
    </div>
  );
}
