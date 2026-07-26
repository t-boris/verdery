import { getRequestTranslator } from '@/shared/localization/server';
import { LeafIcon } from '@/shared/ui/public';

import { AcceptInvitation } from '@/features/collaboration/public';

import styles from './page.module.css';

/**
 * Deliberately outside `/application` — see `AcceptInvitation`'s own doc
 * comment for why: `proxy.ts`'s session-cookie redirect only forwards the
 * bare pathname as `next`, which would silently drop this page's `token`
 * query parameter for a signed-out visitor.
 *
 * Source: implementation-plan.md work package P9A-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `acceptInvitation`.
 */
export default async function AcceptInvitationPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['card']}>
        <span className={styles['mark']}>
          <LeafIcon size={22} />
        </span>
        <h1 className={styles['title']}>{t('invite.title')}</h1>
        <AcceptInvitation />
      </div>
    </div>
  );
}
