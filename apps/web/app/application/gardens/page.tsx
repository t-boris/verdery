import { getRequestTranslator } from '@/shared/localization/server';

import { IncomingOwnershipTransfers } from '@/features/collaboration/public';
import { CreateGardenForm, GardenList } from '@/features/gardens/public';

import styles from './page.module.css';

/**
 * First-garden vertical slice: list and create.
 *
 * `IncomingOwnershipTransfers` sits above `GardenList` — every pending
 * ownership offer addressed to the caller, across every garden, is more
 * urgent than the list of gardens they already own or collaborate on. See
 * its own module comment for why it is composed here rather than imported
 * by `features/gardens` itself.
 *
 * Source: implementation-plan.md work package P2-WEB-01, P9A-OWNER-02.
 */
export default async function GardensPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('gardens.title')}</h1>
        <p className={styles['description']}>{t('gardens.description')}</p>
      </div>

      <IncomingOwnershipTransfers />

      <GardenList />

      <section className={styles['createPanel']}>
        <h2 className={styles['sectionTitle']}>{t('gardens.createTitle')}</h2>
        <CreateGardenForm />
      </section>
    </div>
  );
}
