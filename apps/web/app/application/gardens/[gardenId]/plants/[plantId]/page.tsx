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
 * The back link stays even though the shell's Plants tab also leads to the
 * list: this page is a drill-down inside the section, and the explicit link
 * is the clearer way out of it.
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

      <section className={styles['panel']}>
        <h2 className={styles['sectionTitle']}>{t('observations.recordTitle')}</h2>
        <RecordObservationForm gardenId={gardenId} fixedPlantId={plantId} />
      </section>

      <div className={styles['section']}>
        <h2 className={styles['sectionTitle']}>{t('observations.historyTitle')}</h2>
        <ObservationTimeline gardenId={gardenId} plantId={plantId} />
      </div>
    </div>
  );
}
