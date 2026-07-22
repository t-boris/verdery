import { getRequestTranslator } from '@/shared/localization/server';

import { EmailLinkCompletion } from './email-link-completion';
import styles from './page.module.css';

export default async function EmailLinkPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t('auth.signInTitle')}</h1>
      <EmailLinkCompletion />
    </div>
  );
}
