import { getRequestTranslator } from '@/shared/localization/server';

import {
  ClientUpdateList,
  CreateClientUpdateForm,
  PublisherAccessPanel,
} from '@/features/publications/public';

import styles from './page.module.css';

/**
 * One client engagement's own client-update workspace: who may publish
 * (`PublisherAccessPanel`), every client update in any state
 * (`ClientUpdateList`), and starting a new one. Reached from
 * `OrganizationClientEngagementRow`/`GardenEngagementReadRow`'s own
 * "Client updates" link — an engagement id alone identifies this page
 * (`/client-engagements/{engagementId}/...` is the API's own resource
 * shape, org-backed or self-run alike), so this route needs neither a
 * `gardenId` nor an `organizationId` segment.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01.
 */
export default async function EngagementUpdatesPage({
  params,
}: {
  readonly params: Promise<{ engagementId: string }>;
}) {
  const { engagementId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('publications.pageTitle')}</h1>
      </div>

      <PublisherAccessPanel engagementId={engagementId} />
      <ClientUpdateList engagementId={engagementId} />
      <CreateClientUpdateForm engagementId={engagementId} />
    </div>
  );
}
