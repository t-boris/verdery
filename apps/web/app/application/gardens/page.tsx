import { getRequestTranslator } from '@/shared/localization/server';

import { CreateGardenForm, GardenList } from '@/features/gardens/public';

import styles from './page.module.css';

/**
 * First-garden vertical slice: list and create.
 *
 * Source: implementation-plan.md work package P2-WEB-01.
 */
export default async function GardensPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('gardens.title')}</h1>
        <p className={styles['description']}>{t('gardens.description')}</p>
      </div>

      <GardenList />

      <section className={styles['createPanel']}>
        <h2 className={styles['sectionTitle']}>{t('gardens.createTitle')}</h2>
        <CreateGardenForm />
      </section>
    </div>
  );
}
