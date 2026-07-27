import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientTimeline } from './client-timeline';
import { useClientTimeline } from './queries';

vi.mock('./queries', () => ({ useClientTimeline: vi.fn() }));

const mockedUseTimeline = vi.mocked(useClientTimeline);

function mockTimelineQuery(fields: Record<string, unknown>): void {
  mockedUseTimeline.mockReturnValue(fields as unknown as ReturnType<typeof useClientTimeline>);
}

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

function renderTimeline() {
  return render(
    <LocalizationProvider locale="en">
      <ClientTimeline clientGardenId="client-garden-1" />
    </LocalizationProvider>,
  );
}

describe('ClientTimeline', () => {
  it('shows a loading indicator on first mount', () => {
    mockTimelineQuery({ isPending: true, data: undefined });

    renderTimeline();

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the honest-empty state when this garden has no recorded history yet', () => {
    mockTimelineQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [] },
    });

    renderTimeline();

    expect(screen.getByText('This garden has no recorded history yet.')).toBeTruthy();
  });

  it('renders every fact flattened into one chronological sequence, oldest first, with no version grouping', () => {
    mockTimelineQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: {
        items: [
          {
            publicationId: 'publication-1',
            kind: 'work_log',
            occurredAt: '2026-07-01T09:00:00Z',
            description: 'Cleared the beds.',
          },
          {
            publicationId: 'publication-2',
            kind: 'timeline_entry',
            occurredAt: '2026-07-10T09:00:00Z',
            entryText: 'First frost of the season.',
          },
        ],
      },
    });

    renderTimeline();

    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(screen.getByText('Cleared the beds.')).toBeTruthy();
    expect(screen.getByText('First frost of the season.')).toBeTruthy();
    // No publication title, summary, or version badge anywhere on this view.
    expect(screen.queryByText(/^Update \d/)).toBeNull();
  });

  it('replaces the view with the full failure state on a failed first load', () => {
    mockTimelineQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderTimeline();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
