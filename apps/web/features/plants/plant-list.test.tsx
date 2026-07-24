import type { Plant, PlantListResult } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantList } from './plant-list';
import { useSearchPlants } from './queries';

vi.mock('./queries', () => ({ useSearchPlants: vi.fn() }));

const mockedUseSearchPlants = vi.mocked(useSearchPlants);

/**
 * Only the fields `plant-list.tsx` actually reads are supplied — this is not
 * a real `UseQueryResult`, so the loosely-typed literal is cast through
 * `unknown` once, in this one helper, rather than repeating `as any` at
 * every call site. Mirrors `garden-list.test.tsx`'s own `mockGardensQuery`.
 */
function mockSearchResult(fields: Record<string, unknown>): void {
  mockedUseSearchPlants.mockReturnValue(fields as unknown as ReturnType<typeof useSearchPlants>);
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

function plant(id: string, displayName: string): Plant {
  return {
    id,
    gardenId: 'garden-1',
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    displayName,
    taxonomyReferenceId: null,
    varietyLabel: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'seed',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId: 'profile-1',
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
  };
}

const PLANT_A = plant('plant-a', 'Tomato row');
const PLANT_B = plant('plant-b', 'Basil pot');

function queryResult(
  data: PlantListResult | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isPending: false,
    isLoadingError: false,
    isError: false,
    data,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderList() {
  return render(
    <LocalizationProvider locale="en">
      <PlantList gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  mockedUseSearchPlants.mockReset();
});

describe('PlantList — loading and failure states', () => {
  it('shows a loading status on the first fetch', () => {
    mockSearchResult(queryResult(undefined, { isPending: true, isLoadingError: false }));

    renderList();

    expect(screen.getByText('Loading plants.')).toBeTruthy();
  });

  it('replaces the view with the full failure state only when nothing has loaded yet', () => {
    mockSearchResult(
      queryResult(undefined, {
        isPending: false,
        isLoadingError: true,
        isError: true,
        error: { failure: TRANSPORT_FAILURE },
      }),
    );

    renderList();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the empty message when a search matches nothing', () => {
    mockSearchResult(queryResult({ items: [] }));

    renderList();

    expect(screen.getByText('No plants match your search yet.')).toBeTruthy();
  });

  it('keeps already-loaded plants visible with the stale indicator on a connectivity failure', () => {
    mockSearchResult(
      queryResult({ items: [PLANT_A] }, { isError: true, error: { failure: TRANSPORT_FAILURE } }),
    );

    renderList();

    expect(screen.getByText('Tomato row')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('PlantList — search and pagination', () => {
  it('renders a plant as a link to its detail page', () => {
    mockSearchResult(queryResult({ items: [PLANT_A] }));

    renderList();

    const link = screen.getByRole<HTMLAnchorElement>('link', { name: /Tomato row/ });
    expect(link.getAttribute('href')).toBe('/application/gardens/garden-1/plants/plant-a');
  });

  it('re-queries with the typed text and resets pagination when the search box changes', () => {
    mockSearchResult(queryResult({ items: [PLANT_A] }));

    renderList();

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'tomato' } });

    expect(mockedUseSearchPlants).toHaveBeenLastCalledWith('garden-1', {
      query: 'tomato',
      cursor: null,
      limit: 20,
    });
  });

  it('loads the next page on "Load more", keeping the earlier page visible', () => {
    mockedUseSearchPlants.mockImplementation((_gardenId, params) => {
      const fields =
        params.cursor === null
          ? queryResult({ items: [PLANT_A], nextCursor: 'cursor-2' })
          : params.cursor === 'cursor-2'
            ? queryResult({ items: [PLANT_B] })
            : (() => {
                throw new Error(`unexpected cursor: ${String(params.cursor)}`);
              })();
      return fields as unknown as ReturnType<typeof useSearchPlants>;
    });

    renderList();

    expect(screen.getByText('Tomato row')).toBeTruthy();
    expect(screen.queryByText('Basil pot')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(screen.getByText('Tomato row')).toBeTruthy();
    expect(screen.getByText('Basil pot')).toBeTruthy();
    // The second page has no `nextCursor` — the button must not persist.
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
