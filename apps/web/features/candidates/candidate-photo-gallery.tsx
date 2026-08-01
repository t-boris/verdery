'use client';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert } from '@/shared/ui/public';

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
}

/** One photo's signed-URL resolution — mirrors `plant-photo-gallery.tsx`'s identical `PlantPhotoThumbnail`. */
function CandidatePhotoThumbnail({ gardenId, mediaId, alt }: CandidatePhotoThumbnailProps) {
  const query = useCandidatePhotoAccess(gardenId, mediaId);

  if (query.isPending || query.isError) {
    return <div className={styles['placeholder']} />;
  }

  // A plain `<img>`, not `next/image` — see `plant-photo-gallery.tsx`'s own
  // doc comment: the source is a short-lived signed Cloud Storage URL,
  // re-issued on every fetch, not a build-time-optimizable static asset.
  return <img className={styles['thumbnail']} src={query.data.url} alt={alt} />;
}

/**
 * A candidate's attached photo(s), as a horizontally scrolling row of
 * thumbnails — the read side of `AddCandidateFromPhoto`'s photo attachment
 * (P11-CAND-PHOTO-01), mirroring `plant-photo-gallery.tsx`'s own shape.
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
        />
      ))}
    </div>
  );
}
