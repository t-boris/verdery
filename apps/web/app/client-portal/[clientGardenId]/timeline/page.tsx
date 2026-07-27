import { getRequestTranslator } from '@/shared/localization/server';

import { ClientTimeline } from '@/features/client-portal/public';

import styles from './page.module.css';

/**
 * A client garden's factual Garden Timeline (P9C-WEB-01, architecture doc
 * section 12.1): every visible fact flattened into one chronological
 * sequence, oldest first — no future Time Machine, which does not exist
 * (that depends on P14 and is explicitly out of this work package's scope).
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getClientTimeline`;
 * architecture/collaboration-and-client-sharing.md, section
 * "12. Garden Timeline and Time Machine".
 */
export default async function ClientTimelinePage({
  params,
}: {
  readonly params: Promise<{ clientGardenId: string }>;
}) {
  const { clientGardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('clientPortal.timelineTitle')}</h1>
        <p className={styles['description']}>{t('clientPortal.timelineDescription')}</p>
      </div>
      <ClientTimeline clientGardenId={clientGardenId} />
    </div>
  );
}
