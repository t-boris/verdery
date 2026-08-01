import Link from 'next/link';

import { ClientUpdateDetail } from '@/features/publications/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * A single client update's own detail page — content, staged items, and
 * lifecycle controls, per `ClientUpdateDetail`'s own composition.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01.
 */
export default async function ClientUpdateDetailPage({
  params,
}: {
  readonly params: Promise<{ engagementId: string; clientUpdateId: string }>;
}) {
  const { engagementId, clientUpdateId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <Link className={styles['backLink']} href={`/application/engagements/${engagementId}`}>
        {t('publications.backToList')}
      </Link>

      <ClientUpdateDetail engagementId={engagementId} clientUpdateId={clientUpdateId} />
    </div>
  );
}
