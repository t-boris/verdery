'use client';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert } from '@/shared/ui/public';

import styles from './plant-reference-gallery.module.css';
import { usePlantTaxonProfile } from './queries';

export interface PlantReferenceGalleryProps {
  readonly taxonomyReferenceId: string;
}

/**
 * Licensed photographs showing the taxon in representative observations.
 * They deliberately remain separate from the gardener's immutable specimen
 * photos: one answers "what does this species look like?", the other records
 * the history of this exact plant.
 */
export function PlantReferenceGallery({ taxonomyReferenceId }: PlantReferenceGalleryProps) {
  const { t } = useLocalization();
  const query = usePlantTaxonProfile(taxonomyReferenceId);

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
          {query.data.images.map((image) => (
            <li key={image.id} className={styles['item']}>
              <a href={image.sourceUrl} target="_blank" rel="noreferrer">
                <img
                  src={image.sourceUrl}
                  alt={image.organ ?? t('plants.referencePhotosTitle')}
                  loading="lazy"
                />
              </a>
              {image.attribution !== null && (
                <p className={styles['attribution']}>{image.attribution}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
