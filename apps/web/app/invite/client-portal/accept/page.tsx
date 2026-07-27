import { getRequestTranslator } from '@/shared/localization/server';
import { LeafIcon } from '@/shared/ui/public';

import { ClientAcceptInvitation } from '@/features/client-portal/public';

import styles from './page.module.css';

/**
 * Deliberately outside both `/client-portal` and `/application` — see
 * `ClientAcceptInvitation`'s own doc comment for why: `proxy.ts`'s session-
 * cookie redirect only forwards the bare pathname as `next`, which would
 * silently drop this page's `token` query parameter for a signed-out
 * visitor, the identical reason `/invite/accept` (the operational
 * equivalent) also sits outside `/application`.
 *
 * Source: implementation-plan.md work packages P9C-WEB-01, P9C-INVITE-01;
 * packages/api-contracts/openapi.yaml, operation `acceptClientInvitation`.
 */
export default async function AcceptClientInvitationPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['card']}>
        <span className={styles['mark']}>
          <LeafIcon size={22} />
        </span>
        <h1 className={styles['title']}>{t('clientPortal.inviteTitle')}</h1>
        <ClientAcceptInvitation />
      </div>
    </div>
  );
}
