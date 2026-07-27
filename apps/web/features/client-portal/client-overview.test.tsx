import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientOverview } from './client-overview';
import { useClientGardenOverview } from './queries';

vi.mock('./queries', () => ({ useClientGardenOverview: vi.fn() }));

const mockedUseOverview = vi.mocked(useClientGardenOverview);

function mockOverviewQuery(fields: Record<string, unknown>): void {
  mockedUseOverview.mockReturnValue(
    fields as unknown as ReturnType<typeof useClientGardenOverview>,
  );
}

const CLIENT_GARDEN_ID = 'client-garden-1';

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

function renderOverview() {
  return render(
    <LocalizationProvider locale="en">
      <ClientOverview clientGardenId={CLIENT_GARDEN_ID} />
    </LocalizationProvider>,
  );
}

describe('ClientOverview', () => {
  it('shows a loading indicator on first mount', () => {
    mockOverviewQuery({ isPending: true, data: undefined });

    renderOverview();

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the honest-empty state when no garden_snapshot has ever been published — 200, not an error', () => {
    mockOverviewQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { clientGardenId: CLIENT_GARDEN_ID },
    });

    renderOverview();

    expect(screen.getByText('Nothing has been published for this garden yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the published overview text, structured supplement, and both timestamps', () => {
    mockOverviewQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: {
        clientGardenId: CLIENT_GARDEN_ID,
        publicationId: 'publication-1',
        overviewText: 'The north bed was re-mulched and the irrigation line repaired.',
        snapshotData: { bedsCount: 4 },
        occurredAt: '2026-07-10T09:00:00Z',
        publishedAt: '2026-07-12T09:00:00Z',
      },
    });

    renderOverview();

    expect(
      screen.getByText('The north bed was re-mulched and the irrigation line repaired.'),
    ).toBeTruthy();
    expect(screen.getByText('bedsCount')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText(/^As of /)).toBeTruthy();
    expect(screen.getByText(/^Published /)).toBeTruthy();
  });

  it('replaces the view with the full failure state on a failed first load', () => {
    mockOverviewQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderOverview();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps the previously loaded overview visible, with the stale indicator, on a failed background refetch', () => {
    mockOverviewQuery({
      isPending: false,
      isLoadingError: false,
      isError: true,
      data: {
        clientGardenId: CLIENT_GARDEN_ID,
        overviewText: 'Everything is on schedule.',
      },
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderOverview();

    expect(screen.getByText('Everything is on schedule.')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
  });
});
