import type { Plant, PlantListResult } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantList } from './plant-list';
import { usePlantPhotoAccess } from './plant-media-queries';
import { useSearchPlants } from './queries';

vi.mock('./queries', () => ({ useSearchPlants: vi.fn() }));
vi.mock('./plant-media-queries', () => ({ usePlantPhotoAccess: vi.fn() }));

/**
 * The list writes its filters into the URL (`plant-list-url-state.ts`), so the
 * router is faked here and `currentSearch` stands in for the address bar: what
 * a reader would copy out of it is what these tests assert.
 */
const replaceMock = vi.fn<(href: string, options?: unknown) => void>();
let currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/application/gardens/garden-1/plants',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const mockedUseSearchPlants = vi.mocked(useSearchPlants);
const mockedUsePlantPhotoAccess = vi.mocked(usePlantPhotoAccess);

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
    coverMediaId: null,
    revision: 1,
    createdByProfileId: 'profile-1',
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
  };
}

const PLANT_A = plant('plant-a', 'Tomato row');
const PLANT_B = plant('plant-b', 'Basil pot');
const PLANT_WITH_COVER: Plant = { ...plant('plant-c', 'Roma Tomato'), coverMediaId: 'media-1' };

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
  mockedUsePlantPhotoAccess.mockReset();
  replaceMock.mockReset();
  currentSearch = '';
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
      status: ['active', 'dormant', 'archived', 'dead'],
      identified: null,
      observedWithinDays: null,
      notObservedForDays: null,
      healthConcern: null,
      seasonalActivity: null,
      seasonalMonth: null,
      distributionStatus: null,
      distributionRegion: null,
      profileCompleteness: null,
      cursor: null,
      limit: 20,
    });
  });

  it('re-queries with the identified filter and resets pagination when it changes', () => {
    mockSearchResult(queryResult({ items: [PLANT_A] }));

    renderList();

    // A segmented button group since the Kern pass, not a `<select>` — the
    // behaviour asserted below (re-query, reset pagination) is unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Not identified only' }));

    expect(mockedUseSearchPlants).toHaveBeenLastCalledWith('garden-1', {
      query: null,
      status: ['active', 'dormant', 'archived', 'dead'],
      identified: false,
      observedWithinDays: null,
      notObservedForDays: null,
      healthConcern: null,
      seasonalActivity: null,
      seasonalMonth: null,
      distributionStatus: null,
      distributionRegion: null,
      profileCompleteness: null,
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

describe('PlantList — cover photo', () => {
  // The `<img>` carries `alt=""` (the plant's name is already shown as
  // visible text right beside it, so a redundant accessible name would just
  // be announced twice) — that makes it presentational, not `role="img"`, so
  // these queries go through the container rather than `getByRole`.
  it('shows the fallback icon, without resolving a media URL, for a plant with no cover photo', () => {
    mockSearchResult(queryResult({ items: [PLANT_A] }));

    const { container } = renderList();

    expect(mockedUsePlantPhotoAccess).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
  });

  it("renders the plant's resolved cover photo when coverMediaId is set", () => {
    mockSearchResult(queryResult({ items: [PLANT_WITH_COVER] }));
    mockedUsePlantPhotoAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/media-1', expiresAt: '2026-01-01T00:00:00Z' },
    });

    const { container } = renderList();

    expect(mockedUsePlantPhotoAccess).toHaveBeenCalledWith('garden-1', 'media-1');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://signed.example/media-1',
    );
  });

  it('falls back to the icon when the cover photo fails to resolve', () => {
    mockSearchResult(queryResult({ items: [PLANT_WITH_COVER] }));
    mockedUsePlantPhotoAccess.mockReturnValue({
      isPending: false,
      isError: true,
    } as never);

    const { container } = renderList();

    expect(container.querySelector('img')).toBeNull();
  });
});

describe('PlantList — filters in the URL', () => {
  it('opens already filtered when the link carries filters', () => {
    // The point of the whole mechanism: a link someone sent shows what they
    // were looking at, not an unfiltered list.
    currentSearch = 'q=tomato&identified=unidentified&seen=not_seen_90';
    mockSearchResult(queryResult({ items: [] }));

    renderList();

    expect(mockedUseSearchPlants).toHaveBeenLastCalledWith(
      'garden-1',
      expect.objectContaining({
        query: 'tomato',
        identified: false,
        notObservedForDays: 90,
      }),
    );
  });

  it('writes a filter change back into the address bar', () => {
    mockSearchResult(queryResult({ items: [] }));
    renderList();

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'basil' } });

    // `replace`, not `push`: four keystrokes must not leave four entries in
    // the reader's history.
    expect(replaceMock).toHaveBeenLastCalledWith('/application/gardens/garden-1/plants?q=basil', {
      scroll: false,
    });
  });

  it('returns to a clean URL when the last filter is cleared', () => {
    currentSearch = 'q=basil';
    mockSearchResult(queryResult({ items: [] }));
    renderList();

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: '' } });

    // An unfiltered list should not carry `?q=` — that would say something the
    // reader never chose.
    expect(replaceMock).toHaveBeenLastCalledWith('/application/gardens/garden-1/plants', {
      scroll: false,
    });
  });

  it('ignores a value the contract does not define rather than filtering by it', () => {
    currentSearch = 'identified=perhaps&health=sunburn';
    mockSearchResult(queryResult({ items: [] }));

    renderList();

    // A hand-edited or stale link is ordinary input, not an error.
    expect(mockedUseSearchPlants).toHaveBeenLastCalledWith(
      'garden-1',
      expect.objectContaining({ identified: null, healthConcern: null }),
    );
  });
});
