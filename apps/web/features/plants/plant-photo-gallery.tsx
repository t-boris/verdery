'use client';

import type { PlantPhoto } from '@verdery/api-contracts';
import { useCallback, useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, PhotoLightbox } from '@/shared/ui/public';

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
  readonly makePrimaryLabel: string;
  readonly onSetPrimary: (photoId: string) => void;
  readonly settingPrimary: boolean;
  readonly onOpen: (photoId: string) => void;
  readonly onResolved: (photoId: string, url: string) => void;
}

/** One photo's signed-URL resolution, the same per-item pattern `features/media/media-preview.tsx` establishes for a media record's display. */
function PlantPhotoThumbnail({
  gardenId,
  photo,
  alt,
  openLabel,
  makePrimaryLabel,
  onSetPrimary,
  settingPrimary,
  onOpen,
  onResolved,
}: PlantPhotoThumbnailProps) {
  const query = usePlantPhotoAccess(gardenId, photo.mediaId);

  useEffect(() => {
    if (query.data !== undefined) onResolved(photo.id, query.data.url);
  }, [onResolved, photo.id, query.data]);

  // `data` is absent both while the photo is still being validated and when
  // the read failed; the placeholder covers each, and the status poll behind
  // the hook swaps in the image once it is ready.
  if (query.data === undefined) {
    return <div className={styles['placeholder']} />;
  }

  // A plain `<img>`, not `next/image` — see `media-preview.tsx`'s own doc
  // comment: the source is a short-lived signed Cloud Storage URL, re-issued
  // on every fetch, not a build-time-optimizable static asset.
  return (
    <div className={styles['photo']}>
      <button
        type="button"
        className={styles['thumbnailButton']}
        onClick={() => onOpen(photo.id)}
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
    </div>
  );
}

/**
 * A plant's attached photos, as a horizontally scrolling row of thumbnails —
 * the read side of `AddPlantFromPhoto`'s existing photo attachment
 * (ADR-0015). Renders nothing while the list is empty: an empty gallery is
 * not an error state, just nothing to show yet — the same "real, working
 * affordance or nothing" posture `plant-detail.tsx`'s own media-gap alert
 * already establishes for the still-missing "attach more photos" action.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listPlantPhotos`.
 */
export function PlantPhotoGallery({ gardenId, plantId }: PlantPhotoGalleryProps) {
  const { t } = useLocalization();
  const query = usePlantPhotos(gardenId, plantId);
  const setPrimary = useSetPrimaryPlantPhoto(gardenId, plantId);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const onResolved = useCallback((photoId: string, url: string) => {
    setResolvedUrls((current) =>
      current[photoId] === url ? current : { ...current, [photoId]: url },
    );
  }, []);

  if (query.isPending) {
    return null;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  if (query.data.length === 0) {
    return null;
  }

  const lightboxPhotos = query.data.flatMap((photo, index) => {
    const url = resolvedUrls[photo.id];
    const alt = photo.isPrimary
      ? t('plants.photoPrimary')
      : t('plants.photoAlt', { number: index + 1 });
    return url === undefined ? [] : [{ id: photo.id, src: url, alt, caption: alt }];
  });
  const activeIndex =
    activePhotoId === null ? null : lightboxPhotos.findIndex((photo) => photo.id === activePhotoId);

  return (
    <>
      <div className={styles['gallery']}>
        {query.data.map((photo, index) => (
          <PlantPhotoThumbnail
            key={photo.id}
            gardenId={gardenId}
            photo={photo}
            alt={
              photo.isPrimary
                ? t('plants.photoPrimary')
                : t('plants.photoAlt', { number: index + 1 })
            }
            openLabel={t('plants.photoOpenFullscreen')}
            makePrimaryLabel={t('plants.photoMakePrimary')}
            onSetPrimary={(plantPhotoId) => setPrimary.mutate({ plantPhotoId })}
            settingPrimary={setPrimary.isPending}
            onOpen={setActivePhotoId}
            onResolved={onResolved}
          />
        ))}
        {setPrimary.isError && <FailureAlert failure={setPrimary.error.failure} />}
      </div>
      <PhotoLightbox
        photos={lightboxPhotos}
        activeIndex={activeIndex === -1 ? null : activeIndex}
        dialogLabel={t('plants.photoGalleryTitle')}
        closeLabel={t('plants.photoCloseFullscreen')}
        previousLabel={t('plants.photoPrevious')}
        nextLabel={t('plants.photoNext')}
        onSelect={(index) => setActivePhotoId(lightboxPhotos[index]?.id ?? null)}
        onClose={() => setActivePhotoId(null)}
      />
    </>
  );
}
