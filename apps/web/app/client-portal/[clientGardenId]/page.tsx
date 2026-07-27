import { getRequestTranslator } from '@/shared/localization/server';

import { ClientOverview } from '@/features/client-portal/public';

import styles from './page.module.css';

/**
 * A client garden's own overview tab: the accepted-garden snapshot from the
 * latest publication that included one, honestly empty when none has ever
 * been published.
 *
 * Cross-section navigation (Overview/Updates/Timeline) lives in `ClientShell`'s
 * own garden tabs, so this page carries only its own content — the same
 * split `application/gardens/[gardenId]/page.tsx`'s own doc comment
 * documents for the operational shell.
 *
 * Source: implementation-plan.md work package P9C-WEB-01.
 */
export default async function ClientGardenOverviewPage({
  params,
}: {
  readonly params: Promise<{ clientGardenId: string }>;
}) {
  const { clientGardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('clientPortal.overviewTitle')}</h1>
      </div>
      <ClientOverview clientGardenId={clientGardenId} />
    </div>
  );
}
