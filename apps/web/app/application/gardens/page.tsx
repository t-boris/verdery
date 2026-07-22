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
      <div>
        <h1 className={styles['title']}>{t('gardens.title')}</h1>
        <p className={styles['description']}>{t('gardens.description')}</p>
      </div>

      <GardenList />

      <div>
        <h2 className={styles['title']}>{t('gardens.createTitle')}</h2>
        <CreateGardenForm />
      </div>
    </div>
  );
}
