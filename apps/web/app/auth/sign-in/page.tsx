import { getRequestTranslator } from '@/shared/localization/server';

import { SignInPanel } from './sign-in-panel';
import styles from './page.module.css';

export default async function SignInPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t('auth.signInTitle')}</h1>
      <p className={styles['description']}>{t('auth.signInDescription')}</p>
      <SignInPanel />
    </div>
  );
}
