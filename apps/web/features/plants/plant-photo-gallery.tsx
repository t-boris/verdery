'use client';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert } from '@/shared/ui/public';

import { usePlantPhotoAccess } from './plant-media-queries';
import styles from './plant-photo-gallery.module.css';
import { usePlantPhotos } from './queries';

export interface PlantPhotoGalleryProps {
  readonly gardenId: string;
  readonly plantId: string;
}

interface PlantPhotoThumbnailProps {
  readonly gardenId: string;
  readonly mediaId: string;
  readonly alt: string;
}

/** One photo's signed-URL resolution, the same per-item pattern `features/media/media-preview.tsx` establishes for a media record's display. */
function PlantPhotoThumbnail({ gardenId, mediaId, alt }: PlantPhotoThumbnailProps) {
  const query = usePlantPhotoAccess(gardenId, mediaId);

  // `data` is absent both while the photo is still being validated and when
  // the read failed; the placeholder covers each, and the status poll behind
  // the hook swaps in the image once it is ready.
  if (query.data === undefined) {
    return <div className={styles['placeholder']} />;
  }

  // A plain `<img>`, not `next/image` — see `media-preview.tsx`'s own doc
  // comment: the source is a short-lived signed Cloud Storage URL, re-issued
  // on every fetch, not a build-time-optimizable static asset.
  return <img className={styles['thumbnail']} src={query.data.url} alt={alt} />;
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
        <PlantPhotoThumbnail
          key={photo.id}
          gardenId={gardenId}
          mediaId={photo.mediaId}
          alt={t('plants.photoGalleryTitle')}
        />
      ))}
    </div>
  );
}
