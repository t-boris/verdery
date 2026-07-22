'use client';

import { errorMessageKey, type ApiFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert } from '@/shared/ui/public';

/**
 * Presents a typed API failure.
 *
 * The text comes from the error code, never from the envelope's `message`, and
 * the correlation identifier is shown so a user can quote it to support. The
 * identifier carries no user content, unlike the failure's own diagnostics.
 *
 * Source: architecture/api-design.md, section "12. Error Envelope";
 * architecture/observability-and-analytics.md, section "4. Correlation".
 */
export function FailureAlert({ failure }: { readonly failure: ApiFailure }) {
  const { t } = useLocalization();

  return (
    <Alert
      tone="danger"
      title={t('error.title')}
      reference={t('error.correlation', { correlationId: failure.correlationId })}
    >
      <p>{t(errorMessageKey(failure.code))}</p>
    </Alert>
  );
}
