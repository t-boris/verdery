import { SharedErrorCode } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApiFailure } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { FailureAlert } from './failure-alert';

const FAILURE: ApiFailure = {
  ok: false,
  kind: 'contract',
  code: SharedErrorCode.DependencyUnavailable,
  fallbackMessage: 'A required dependency is temporarily unavailable.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: 503,
};

describe('FailureAlert', () => {
  it('announces the failure and localizes it by error code', () => {
    render(
      <LocalizationProvider locale="ru">
        <FailureAlert failure={FAILURE} />
      </LocalizationProvider>,
    );

    const alert = screen.getByRole('alert');

    expect(alert.textContent).toContain('Сервис, от которого зависит API, временно недоступен.');
    expect(alert.textContent).toContain(FAILURE.correlationId);
  });

  it('never renders the server fallback message, which is not a localization source', () => {
    render(
      <LocalizationProvider locale="en">
        <FailureAlert failure={FAILURE} />
      </LocalizationProvider>,
    );

    expect(screen.getByRole('alert').textContent).not.toContain(FAILURE.fallbackMessage);
  });
});
