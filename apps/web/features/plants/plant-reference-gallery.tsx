'use client';

import { useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { CloseIcon, FailureAlert } from '@/shared/ui/public';

import styles from './plant-reference-gallery.module.css';
import { usePlantTaxonProfile } from './queries';

export interface PlantReferenceGalleryProps {
  readonly taxonomyReferenceId: string;
  readonly displayName: string;
}

/**
 * Licensed photographs showing the taxon in representative observations.
 * They deliberately remain separate from the gardener's immutable specimen
 * photos: one answers "what does this species look like?", the other records
 * the history of this exact plant.
 */
export function PlantReferenceGallery({
  taxonomyReferenceId,
  displayName,
}: PlantReferenceGalleryProps) {
  const { t } = useLocalization();
  const query = usePlantTaxonProfile(taxonomyReferenceId);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const selectedImageIndex =
    query.data?.images.findIndex((image) => image.id === selectedImageId) ?? -1;
  const selectedImage =
    selectedImageIndex < 0 ? null : (query.data?.images[selectedImageIndex] ?? null);

  useEffect(() => {
    if (selectedImage === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedImageId(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [selectedImage]);

  return (
    <section className={styles['section']} aria-labelledby="plant-reference-photos-title">
      <div className={styles['heading']}>
        <h2 id="plant-reference-photos-title">{t('plants.referencePhotosTitle')}</h2>
        <p>{t('plants.referencePhotosDescription')}</p>
      </div>

      {query.isPending && <p role="status">{t('plants.referencePhotosLoading')}</p>}
      {query.isError && <FailureAlert failure={query.error.failure} />}
      {query.data !== undefined && query.data.images.length === 0 && (
        <p>{t('plants.referencePhotosEmpty')}</p>
      )}
      {query.data !== undefined && query.data.images.length > 0 && (
        <ul className={styles['gallery']}>
          {query.data.images.map((image, index) => {
            const alt = t('plants.referencePhotoAlt', {
              plant: displayName,
              number: index + 1,
            });
            return (
              <li key={image.id} className={styles['item']}>
                <button
                  type="button"
                  className={styles['imageButton']}
                  onClick={() => setSelectedImageId(image.id)}
                  aria-label={alt}
                >
                  <img src={image.sourceUrl} alt={alt} loading="lazy" />
                </button>
                {image.attribution !== null && (
                  <p className={styles['attribution']}>{image.attribution}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {selectedImage !== null && (
        <div
          className={styles['lightbox']}
          role="dialog"
          aria-modal="true"
          aria-label={t('plants.referencePhotosTitle')}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedImageId(null);
          }}
        >
          <button
            type="button"
            className={styles['close']}
            onClick={() => setSelectedImageId(null)}
            aria-label={t('plants.photoCloseFullscreen')}
          >
            <CloseIcon />
          </button>
          <img
            className={styles['fullImage']}
            src={selectedImage.sourceUrl}
            alt={t('plants.referencePhotoAlt', {
              plant: displayName,
              number: selectedImageIndex + 1,
            })}
          />
          {selectedImage.attribution !== null && (
            <p className={styles['lightboxAttribution']}>{selectedImage.attribution}</p>
          )}
        </div>
      )}
    </section>
  );
}
