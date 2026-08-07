'use client';

import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert, PhotoLightbox } from '@/shared/ui/public';

import styles from './plant-reference-gallery.module.css';
import { usePlantTaxonProfile } from './queries';

export interface PlantReferenceGalleryProps {
  readonly taxonomyReferenceId: string;
}

/** Licensed provider imagery for the species, kept visually and semantically separate from this specimen's photos. */
export function PlantReferenceGallery({ taxonomyReferenceId }: PlantReferenceGalleryProps) {
  const { t } = useLocalization();
  const query = usePlantTaxonProfile(taxonomyReferenceId);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);

  if (query.isPending) return <p role="status">{t('plants.referencePhotosLoading')}</p>;
  if (query.isError) return <FailureAlert failure={query.error.failure} />;

  const lightboxPhotos = query.data.images.map((image, index) => ({
    id: image.id,
    src: image.sourceUrl,
    alt: t('plants.referencePhotoAlt', { number: index + 1 }),
    caption: image.attribution ?? undefined,
  }));

  return (
    <section className={styles['section']} aria-labelledby="plant-reference-photos-title">
      <div>
        <h2 id="plant-reference-photos-title" className={styles['title']}>
          {t('plants.referencePhotosTitle')}
        </h2>
        <p className={styles['description']}>{t('plants.referencePhotosDescription')}</p>
      </div>
      {query.data.images.length === 0 ? (
        <p>{t('plants.referencePhotosEmpty')}</p>
      ) : (
        <ul className={styles['gallery']}>
          {query.data.images.map((image, index) => (
            <li className={styles['image']} key={image.id}>
              <button
                type="button"
                className={styles['imageButton']}
                onClick={() => setActiveImageIndex(index)}
                aria-label={t('plants.photoOpenFullscreen')}
              >
                <img
                  src={image.sourceUrl}
                  alt={t('plants.referencePhotoAlt', { number: index + 1 })}
                  loading="eager"
                  decoding="async"
                />
              </button>
              {image.attribution !== null && <small>{image.attribution}</small>}
            </li>
          ))}
        </ul>
      )}
      <PhotoLightbox
        photos={lightboxPhotos}
        activeIndex={activeImageIndex}
        dialogLabel={t('plants.referencePhotosTitle')}
        closeLabel={t('plants.photoCloseFullscreen')}
        previousLabel={t('plants.photoPrevious')}
        nextLabel={t('plants.photoNext')}
        onSelect={setActiveImageIndex}
        onClose={() => setActiveImageIndex(null)}
      />
    </section>
  );
}
