import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientGardenList } from './client-garden-list';
import { useClientGardens } from './queries';

vi.mock('./queries', () => ({ useClientGardens: vi.fn() }));

const mockedUseClientGardens = vi.mocked(useClientGardens);

function mockClientGardensQuery(fields: Record<string, unknown>): void {
  mockedUseClientGardens.mockReturnValue(fields as unknown as ReturnType<typeof useClientGardens>);
}

const GARDEN = { id: 'client-garden-1', name: 'Riverside Garden' };

const TRANSPORT_FAILURE = {
  ok: false as const,
  kind: 'transport' as const,
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: null,
};

function renderList() {
  return render(
    <LocalizationProvider locale="en">
      <ClientGardenList />
    </LocalizationProvider>,
  );
}

describe('ClientGardenList', () => {
  it('shows a loading indicator on first mount', () => {
    mockClientGardensQuery({ isPending: true, data: undefined });

    renderList();

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the honest-empty state when the caller has no active garden connection', () => {
    mockClientGardensQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [] },
    });

    renderList();

    expect(screen.getByText('You have no active garden connections yet.')).toBeTruthy();
  });

  it('lists a client garden as a link into its own overview — read-only, no other affordance', () => {
    mockClientGardensQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [GARDEN] },
    });

    renderList();

    const link = screen.getByRole('link', { name: 'Riverside Garden' });
    expect(link.getAttribute('href')).toBe('/client-portal/client-garden-1');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists more than one garden — a client can hold more than one active engagement', () => {
    mockClientGardensQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [GARDEN, { id: 'client-garden-2', name: 'Hillside Garden' }] },
    });

    renderList();

    expect(screen.getByRole('link', { name: 'Riverside Garden' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Hillside Garden' })).toBeTruthy();
  });

  it('keeps a previously loaded list visible, with the stale indicator, on a failed background refetch', () => {
    mockClientGardensQuery({
      isPending: false,
      isLoadingError: false,
      isError: true,
      data: { items: [GARDEN] },
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.getByText('Riverside Garden')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
  });

  it('replaces the view with the full failure state on a failed first load', () => {
    mockClientGardensQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
