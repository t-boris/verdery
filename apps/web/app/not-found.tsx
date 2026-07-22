import Link from 'next/link';

import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/** Route boundary for an address that matches no segment. */
export default async function NotFound() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t('notFound.title')}</h1>
      <p className={styles['description']}>{t('notFound.description')}</p>
      <Link className={styles['action']} href="/">
        {t('notFound.backHome')}
      </Link>
    </div>
  );
}
