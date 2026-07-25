import { ObservationTimeline, RecordObservationForm } from '@/features/observations/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * The garden-wide observation history: record a new one, and see the full
 * chronological timeline (`ListObservationsForGarden`).
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Observations`.
 */
export default async function ObservationsPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('observations.pageTitle')}</h1>
        <p className={styles['description']}>{t('observations.pageDescription')}</p>
      </div>

      <section className={styles['panel']}>
        <h2 className={styles['sectionTitle']}>{t('observations.recordTitle')}</h2>
        <RecordObservationForm gardenId={gardenId} />
      </section>

      <div className={styles['section']}>
        <h2 className={styles['sectionTitle']}>{t('observations.historyTitle')}</h2>
        <ObservationTimeline gardenId={gardenId} />
      </div>
    </div>
  );
}
