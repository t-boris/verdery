import Link from 'next/link';

import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/** Start page of the shell. Product surfaces replace it from Phase 2 onwards. */
export default async function HomePage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t('home.title')}</h1>
      <p className={styles['description']}>{t('home.description')}</p>
      <Link className={styles['action']} href="/status">
        {t('home.openStatus')}
      </Link>
    </div>
  );
}
