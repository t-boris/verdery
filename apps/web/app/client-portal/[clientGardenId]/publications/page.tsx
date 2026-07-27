import { getRequestTranslator } from '@/shared/localization/server';

import { ClientPublications } from '@/features/client-portal/public';

import styles from './page.module.css';

/**
 * A client garden's published updates, version-grouped, newest first —
 * genuinely distinct from the sibling `timeline` route's flattened,
 * oldest-first view of the same underlying facts. See `ClientTimeline`'s own
 * doc comment for why the two are not the same view rendered twice.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listClientPublications`.
 */
export default async function ClientPublicationsPage({
  params,
}: {
  readonly params: Promise<{ clientGardenId: string }>;
}) {
  const { clientGardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('clientPortal.publicationsTitle')}</h1>
        <p className={styles['description']}>{t('clientPortal.publicationsDescription')}</p>
      </div>
      <ClientPublications clientGardenId={clientGardenId} />
    </div>
  );
}
