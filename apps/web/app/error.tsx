'use client';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Button } from '@/shared/ui/public';

import styles from './page.module.css';

export interface RouteErrorProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * Application shell error boundary.
 *
 * Only the framework-issued `digest` is shown. The error's message and stack may
 * contain internal detail, so they are never rendered; they reach the team
 * through error reporting, which arrives with `P1-OBS-01`.
 *
 * Source: architecture/web-application-design.md, sections "13. Error Boundaries"
 * and "18. Observability".
 */
export default function RouteError({ error, reset }: RouteErrorProps) {
  const { t } = useLocalization();

  return (
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
  );
}
