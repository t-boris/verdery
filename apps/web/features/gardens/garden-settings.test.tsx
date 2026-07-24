import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenSettings } from './garden-settings';
import { useArchiveGarden, useGarden, useRenameGarden, useRequestGardenDeletion } from './queries';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./queries', () => ({
  useGarden: vi.fn(),
  useRenameGarden: vi.fn(),
  useArchiveGarden: vi.fn(),
  useRequestGardenDeletion: vi.fn(),
}));

const mockedUseGarden = vi.mocked(useGarden);
const mockedUseRenameGarden = vi.mocked(useRenameGarden);
const mockedUseArchiveGarden = vi.mocked(useArchiveGarden);
const mockedUseRequestGardenDeletion = vi.mocked(useRequestGardenDeletion);

/**
 * Only the fields `garden-settings.tsx` actually reads are supplied — this is
 * not a real `UseQueryResult` (that type is a large discriminated union of
 * TanStack Query's own internal flags), so the loosely-typed literal is cast
 * through `unknown` once, in this one helper, rather than repeating `as any`
 * at every call site. Mirrors `garden-list.test.tsx`'s own `mockGardensQuery`.
 */
function mockGardenQuery(fields: Record<string, unknown>): void {
  mockedUseGarden.mockReturnValue(fields as unknown as ReturnType<typeof useGarden>);
}

function mockMutation(): void {
  const idleMutation = { mutate: vi.fn(), isPending: false, isError: false } as unknown;
  mockedUseRenameGarden.mockReturnValue(idleMutation as ReturnType<typeof useRenameGarden>);
  mockedUseArchiveGarden.mockReturnValue(idleMutation as ReturnType<typeof useArchiveGarden>);
  mockedUseRequestGardenDeletion.mockReturnValue(
    idleMutation as ReturnType<typeof useRequestGardenDeletion>,
  );
}

const GARDEN = {
  id: 'garden-1',
  name: 'Backyard',
  lifecycleState: 'active' as const,
  callerRole: 'owner' as const,
  revision: 3,
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

function renderSettings() {
  mockMutation();
  return render(
    <LocalizationProvider locale="en">
      <GardenSettings gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

describe('GardenSettings — data stays visible when connectivity is lost (P5-WEB-01 follow-up)', () => {
  it('keeps the previously loaded garden visible, with the stale indicator, when a background refetch fails for a connectivity reason', () => {
    mockGardenQuery({
      isPending: false,
      isLoadingError: false,
      isError: true,
      data: GARDEN,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderSettings();

    expect(screen.getByText('Backyard')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
    // The full-page failure state (with its own "Try again" retry button) is
    // reserved for a failed *first* load — it must not also appear here.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces the view with the full failure state only when there is no cached data at all (a failed first load)', () => {
    mockGardenQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderSettings();

    expect(screen.queryByText('Backyard')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders the ordinary settings page with no indicator at all once online with no failure', () => {
    mockGardenQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: GARDEN,
      error: null,
      refetch: vi.fn(),
    });

    renderSettings();

    expect(screen.getByText('Backyard')).toBeTruthy();
    expect(screen.queryByText('You are offline')).toBeNull();
  });
});
