import { getRequestTranslator } from '@/shared/localization/server';

import { ClientGardenList } from '@/features/client-portal/public';

import styles from './page.module.css';

/**
 * The client portal's own root route: every garden the signed-in client
 * currently has an active connection to. A real switcher, not a formality —
 * see `ClientGardenList`'s own doc comment for why a client may hold more
 * than one.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listClientGardens`.
 */
export default async function ClientGardensPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('clientPortal.gardensTitle')}</h1>
        <p className={styles['description']}>{t('clientPortal.gardensDescription')}</p>
      </div>

      <ClientGardenList />
    </div>
  );
}
