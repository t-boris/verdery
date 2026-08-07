'use client';

import { useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { CloseIcon, FailureAlert } from '@/shared/ui/public';

import { useCandidatePhotoAccess } from './candidate-media-queries';
import styles from './candidate-photo-gallery.module.css';
import { useCandidatePhotos } from './queries';

export interface CandidatePhotoGalleryProps {
  readonly gardenId: string;
  readonly candidateId: string;
}

interface CandidatePhotoThumbnailProps {
  readonly gardenId: string;
  readonly mediaId: string;
  readonly alt: string;
  readonly openLabel: string;
  readonly closeLabel: string;
}

/** One photo's signed-URL resolution — mirrors `plant-photo-gallery.tsx`'s identical `PlantPhotoThumbnail`. */
function CandidatePhotoThumbnail({
  gardenId,
  mediaId,
  alt,
  openLabel,
  closeLabel,
}: CandidatePhotoThumbnailProps) {
  const query = useCandidatePhotoAccess(gardenId, mediaId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

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
    <>
      <button
        type="button"
        className={styles['thumbnailButton']}
        onClick={() => setOpen(true)}
        aria-label={openLabel}
      >
        <img className={styles['thumbnail']} src={query.data.url} alt={alt} />
      </button>
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
    </>
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

  if (query.isPending) {
    return null;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  if (query.data.length === 0) {
    return null;
  }

  return (
    <div className={styles['gallery']}>
      {query.data.map((photo) => (
        <CandidatePhotoThumbnail
          key={photo.id}
          gardenId={gardenId}
          mediaId={photo.mediaId}
          alt={t('candidates.photoGalleryTitle')}
          openLabel={t('candidates.photoOpenFullscreen')}
          closeLabel={t('candidates.photoCloseFullscreen')}
        />
      ))}
    </div>
  );
}
