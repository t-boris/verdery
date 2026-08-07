'use client';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert } from '@/shared/ui/public';

import styles from './plant-reference-gallery.module.css';
import { usePlantTaxonProfile } from './queries';

export interface PlantReferenceGalleryProps {
  readonly taxonomyReferenceId: string;
}

/** Licensed provider imagery for the species, kept visually and semantically separate from this specimen's photos. */
export function PlantReferenceGallery({ taxonomyReferenceId }: PlantReferenceGalleryProps) {
  const { t } = useLocalization();
  const query = usePlantTaxonProfile(taxonomyReferenceId);

  if (query.isPending) return <p role="status">{t('plants.referencePhotosLoading')}</p>;
  if (query.isError) return <FailureAlert failure={query.error.failure} />;

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
          {query.data.images.map((image) => (
            <li className={styles['image']} key={image.id}>
              <img src={image.sourceUrl} alt={t('plants.referencePhotosTitle')} loading="lazy" />
              {image.attribution !== null && <small>{image.attribution}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
