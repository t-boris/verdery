import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientPublications } from './client-publications';
import { useClientPublications } from './queries';

vi.mock('./queries', () => ({
  useClientPublications: vi.fn(),
  useClientMediaAccess: vi.fn(),
}));

const mockedUsePublications = vi.mocked(useClientPublications);

function mockPublicationsQuery(fields: Record<string, unknown>): void {
  mockedUsePublications.mockReturnValue(
    fields as unknown as ReturnType<typeof useClientPublications>,
  );
}

const PUBLICATION = {
  id: 'publication-1',
  versionNumber: 1,
  title: 'First visit',
  summary: 'Initial assessment and cleanup.',
  publishedAt: '2026-07-01T09:00:00Z',
  items: [
    {
      id: 'item-1',
      kind: 'work_log' as const,
      occurredAt: '2026-07-01T09:00:00Z',
      description: 'Cleared the beds.',
    },
  ],
  staffAttributions: [],
};

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

function renderPublications() {
  return render(
    <LocalizationProvider locale="en">
      <ClientPublications clientGardenId="client-garden-1" />
    </LocalizationProvider>,
  );
}

describe('ClientPublications', () => {
  it('shows a loading indicator on first mount', () => {
    mockPublicationsQuery({ isPending: true, data: undefined });

    renderPublications();

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the honest-empty state when nothing has ever been published', () => {
    mockPublicationsQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [] },
    });

    renderPublications();

    expect(screen.getByText('No updates have been published for this garden yet.')).toBeTruthy();
  });

  it('renders each visible publication as its own version-grouped card', () => {
    mockPublicationsQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [PUBLICATION] },
    });

    renderPublications();

    expect(screen.getByRole('heading', { name: 'First visit' })).toBeTruthy();
    expect(screen.getByText('Cleared the beds.')).toBeTruthy();
  });

  it('replaces the view with the full failure state on a failed first load', () => {
    mockPublicationsQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderPublications();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
