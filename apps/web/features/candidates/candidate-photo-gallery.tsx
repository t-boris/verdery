'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert, PhotoLightbox } from '@/shared/ui/public';

import { useCandidatePhotoAccess } from './candidate-media-queries';
import styles from './candidate-photo-gallery.module.css';
import { useCandidatePhotos } from './queries';

export interface CandidatePhotoGalleryProps {
  readonly gardenId: string;
  readonly candidateId: string;
}

interface CandidatePhotoThumbnailProps {
  readonly gardenId: string;
  readonly photoId: string;
  readonly mediaId: string;
  readonly alt: string;
  readonly openLabel: string;
  readonly onOpen: (photoId: string) => void;
  readonly onResolved: (photoId: string, url: string) => void;
}

/** One photo's signed-URL resolution — mirrors `plant-photo-gallery.tsx`'s identical `PlantPhotoThumbnail`. */
function CandidatePhotoThumbnail({
  gardenId,
  photoId,
  mediaId,
  alt,
  openLabel,
  onOpen,
  onResolved,
}: CandidatePhotoThumbnailProps) {
  const query = useCandidatePhotoAccess(gardenId, mediaId);

  useEffect(() => {
    if (query.data !== undefined) onResolved(photoId, query.data.url);
  }, [onResolved, photoId, query.data]);

  // `data` is absent both while the photo is still being validated and when
  // the read failed; the placeholder covers each, and the status poll behind
  // the hook swaps in the image once it is ready.
  if (query.data === undefined) {
    return <div className={styles['placeholder']} />;
  }

  // A plain `<img>`, not `next/image` — see `plant-photo-gallery.tsx`'s own
  // doc comment: the source is a short-lived signed Cloud Storage URL,
  // re-issued on every fetch, not a build-time-optimizable static asset.
  return (
    <button
      type="button"
      className={styles['thumbnailButton']}
      onClick={() => onOpen(photoId)}
      aria-label={openLabel}
    >
      <img className={styles['thumbnail']} src={query.data.url} alt={alt} />
    </button>
  );
}

/**
 * A candidate's attached photo(s), as a horizontally scrolling row of
 * thumbnails — the read side of `AddCandidateFromPhoto`'s photo attachment
 * (P11-WEB-01), mirroring `plant-photo-gallery.tsx`'s own shape.
 * Renders nothing while the list is empty: an empty gallery is not an error
 * state, just nothing to show yet — a manually added candidate has none.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listCandidatePhotos`.
 */
export function CandidatePhotoGallery({ gardenId, candidateId }: CandidatePhotoGalleryProps) {
  const { t } = useLocalization();
  const query = useCandidatePhotos(gardenId, candidateId);
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
    return url === undefined
      ? []
      : [
          {
            id: photo.id,
            src: url,
            alt: t('candidates.photoAlt', { number: index + 1 }),
            caption: t('candidates.photoAlt', { number: index + 1 }),
          },
        ];
  });
  const activeIndex =
    activePhotoId === null ? null : lightboxPhotos.findIndex((photo) => photo.id === activePhotoId);

  return (
    <>
      <div className={styles['gallery']}>
        {query.data.map((photo, index) => (
          <CandidatePhotoThumbnail
            key={photo.id}
            gardenId={gardenId}
            photoId={photo.id}
            mediaId={photo.mediaId}
            alt={t('candidates.photoAlt', { number: index + 1 })}
            openLabel={t('candidates.photoOpenFullscreen')}
            onOpen={setActivePhotoId}
            onResolved={onResolved}
          />
        ))}
      </div>
      <PhotoLightbox
        photos={lightboxPhotos}
        activeIndex={activeIndex === -1 ? null : activeIndex}
        dialogLabel={t('candidates.photoGalleryTitle')}
        closeLabel={t('candidates.photoCloseFullscreen')}
        previousLabel={t('candidates.photoPrevious')}
        nextLabel={t('candidates.photoNext')}
        onSelect={(index) => setActivePhotoId(lightboxPhotos[index]?.id ?? null)}
        onClose={() => setActivePhotoId(null)}
      />
    </>
  );
}
