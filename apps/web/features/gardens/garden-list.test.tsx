import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenList } from './garden-list';
import { useGardens } from './queries';

vi.mock('./queries', () => ({ useGardens: vi.fn() }));

const mockedUseGardens = vi.mocked(useGardens);

/**
 * Only the fields `garden-list.tsx` actually reads are supplied — this is
 * not a real `UseQueryResult` (that type is a large discriminated union of
 * TanStack Query's own internal flags), so the loosely-typed literal is cast
 * through `unknown` once, in this one helper, rather than repeating `as any`
 * at every call site.
 */
function mockGardensQuery(fields: Record<string, unknown>): void {
  mockedUseGardens.mockReturnValue(fields as unknown as ReturnType<typeof useGardens>);
}

const GARDEN = {
  id: 'garden-1',
  name: 'Backyard',
  lifecycleState: 'active' as const,
  callerRole: 'owner' as const,
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

function renderList() {
  return render(
    <LocalizationProvider locale="en">
      <GardenList />
    </LocalizationProvider>,
  );
}

describe('GardenList — data stays visible when connectivity is lost (P5-WEB-01)', () => {
  it('keeps a previously loaded list visible, with the stale indicator, when a background refetch fails for a connectivity reason', () => {
    mockGardensQuery({
      isPending: false,
      isLoadingError: false,
      isError: true,
      data: { items: [GARDEN] },
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.getByText('Backyard')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
    // The full-page failure state (with its own "Try again" retry button) is
    // reserved for a failed *first* load — it must not also appear here.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces the view with the full failure state only when there is no cached data at all (a failed first load)', () => {
    mockGardensQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.queryByText('Backyard')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders the ordinary list with no indicator at all once online with no failure', () => {
    mockGardensQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [GARDEN] },
      error: null,
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.getByText('Backyard')).toBeTruthy();
    expect(screen.queryByText('You are offline')).toBeNull();
  });
});
