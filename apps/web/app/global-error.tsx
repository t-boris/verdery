'use client';

import { DEFAULT_LOCALE, createTranslator } from '@/shared/localization/public';
import { Alert, Button } from '@/shared/ui/public';
import '@/shared/ui/tokens.css';
import '@/shared/ui/global.css';

import styles from './page.module.css';

export interface GlobalErrorProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * Boundary for a failure in the root layout itself.
 *
 * It replaces the whole document, so it cannot rely on the layout's localization
 * provider and uses the default locale directly. The negotiated locale is
 * unavailable here because the failure happened before it was published.
 *
 * Source: architecture/web-application-design.md, section "13. Error Boundaries".
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const t = createTranslator(DEFAULT_LOCALE);

  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <div className={styles['page']}>
          <h1 className={styles['title']}>{t('errorBoundary.title')}</h1>
          <Alert
            tone="danger"
            title={t('errorBoundary.description')}
            {...(error.digest === undefined
              ? {}
              : { reference: t('errorBoundary.reference', { reference: error.digest }) })}
          />
          <Button variant="primary" onClick={reset}>
            {t('errorBoundary.retry')}
          </Button>
        </div>
      </body>
    </html>
  );
}
