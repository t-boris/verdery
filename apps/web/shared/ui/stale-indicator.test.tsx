import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiFailure } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { StaleIndicator } from './stale-indicator';

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

const TRANSPORT_FAILURE: ApiFailure = {
  ok: false,
  kind: 'transport',
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: null,
};

const CONTRACT_FAILURE: ApiFailure = {
  ok: false,
  kind: 'contract',
  code: 'shared.forbidden',
  fallbackMessage: 'This account is not allowed to perform that action.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  retryable: false,
  details: [],
  status: 403,
};

function renderIndicator(failure: ApiFailure | null = null) {
  return render(
    <LocalizationProvider locale="en">
      <StaleIndicator failure={failure} />
    </LocalizationProvider>,
  );
}

describe('StaleIndicator', () => {
  it('renders nothing while online with no failure', () => {
    renderIndicator();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing for a non-connectivity failure while online', () => {
    renderIndicator(CONTRACT_FAILURE);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the notice when the browser is offline', () => {
    act(() => onlineManager.setOnline(false));

    renderIndicator();

    expect(screen.getByRole('status').textContent).toContain('You are offline');
  });

  it('shows the notice for a connectivity (transport) failure even while nominally online', () => {
    renderIndicator(TRANSPORT_FAILURE);

    expect(screen.getByRole('status').textContent).toContain('You are offline');
  });
});
