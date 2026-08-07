import Link from 'next/link';

import { ClientUpdateDetail } from '@/features/publications/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { BookIcon, RouteBody, RouteHeader, RoutePage } from '@/shared/ui/public';

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
    <RoutePage>
      <RouteHeader
        title={t('publications.editTitle')}
        icon={<BookIcon size={18} />}
        actions={
          <Link className={styles['backLink']} href={`/application/engagements/${engagementId}`}>
            {t('publications.backToList')}
          </Link>
        }
      />

      <RouteBody>
        <ClientUpdateDetail engagementId={engagementId} clientUpdateId={clientUpdateId} />
      </RouteBody>
    </RoutePage>
  );
}
