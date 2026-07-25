import { getRequestTranslator } from '@/shared/localization/server';
import { LeafIcon } from '@/shared/ui/public';

import { EmailLinkCompletion } from './email-link-completion';
import styles from './page.module.css';

export default async function EmailLinkPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['card']}>
        <span className={styles['mark']}>
          <LeafIcon size={22} />
        </span>
        <h1 className={styles['title']}>{t('auth.signInTitle')}</h1>
        <EmailLinkCompletion />
      </div>
    </div>
  );
}
