import Link from 'next/link';

import { PlantDetail } from '@/features/plants/public';
import { ObservationTimeline, RecordObservationForm } from '@/features/observations/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * A single plant's detail page, composing `features/plants` with
 * `features/observations` at the route layer — the intended seam for
 * combining two features (see `features/observations/observation-timeline.tsx`'s
 * doc comment for why neither feature imports the other directly).
 *
 * Source: implementation-plan.md work package P4-WEB-01.
 */
export default async function PlantDetailPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string; plantId: string }>;
}) {
  const { gardenId, plantId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <Link className={styles['back']} href={`/application/gardens/${gardenId}/plants`}>
        {t('plants.backToPlants')}
      </Link>

      <PlantDetail gardenId={gardenId} plantId={plantId} />

      <div>
        <h2 className={styles['sectionTitle']}>{t('observations.recordTitle')}</h2>
        <RecordObservationForm gardenId={gardenId} fixedPlantId={plantId} />
      </div>

      <div>
        <h2 className={styles['sectionTitle']}>{t('observations.historyTitle')}</h2>
        <ObservationTimeline gardenId={gardenId} plantId={plantId} />
      </div>
    </div>
  );
}
