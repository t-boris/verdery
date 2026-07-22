import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LocalizationProvider, createTranslator } from '@/shared/localization/public';
import { getRequestLocale } from '@/shared/localization/server';
import '@/shared/ui/tokens.css';
import '@/shared/ui/global.css';

import styles from './layout.module.css';

export const metadata: Metadata = {
  title: 'Verdery',
  description: 'A living map of a real garden.',
};

/**
 * Root layout.
 *
 * The locale is negotiated on the server so the first response is already in
 * the user's language and `<html lang>` is correct for assistive technology. A
 * stored per-account preference overrides this once accounts exist.
 *
 * Source: architecture/web-application-design.md, sections "4. Rendering Model"
 * and "15. Localization".
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);

  return (
    <html lang={locale}>
      <body>
        <LocalizationProvider locale={locale}>
          <div className={styles['shell']}>
            <a className={styles['skipLink']} href="#main">
              {t('app.skipToContent')}
            </a>
            <header className={styles['header']}>
              <Link className={styles['productName']} href="/">
                {t('app.name')}
              </Link>
              <span className={styles['tagline']}>{t('app.tagline')}</span>
            </header>
            <main id="main" className={styles['main']}>
              {children}
            </main>
          </div>
        </LocalizationProvider>
      </body>
    </html>
  );
}
