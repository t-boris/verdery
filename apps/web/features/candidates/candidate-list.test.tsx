import type { PlantCandidate, PlantCandidateListResult } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CandidateList } from './candidate-list';
import { useListCandidates } from './queries';

/** Mirrors `candidate-list.tsx`'s own default: every status except the two disposal ones. */
const WORKING_STATUSES = ['active', 'converted'] as const;

vi.mock('./queries', () => ({ useListCandidates: vi.fn() }));

const mockedUseListCandidates = vi.mocked(useListCandidates);

/** Only the fields `candidate-list.tsx` actually reads are supplied — mirrors `plant-list.test.tsx`'s own `mockSearchResult` helper. */
function mockListResult(fields: Record<string, unknown>): void {
  mockedUseListCandidates.mockReturnValue(
    fields as unknown as ReturnType<typeof useListCandidates>,
  );
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

function candidate(id: string, displayName: string): PlantCandidate {
  return {
    id,
    gardenId: 'garden-1',
    proposedGardenAreaMapObjectId: null,
    proposedPlacementMapObjectId: null,
    displayName,
    taxonomyReferenceId: null,
    varietyLabel: null,
    groupingKind: 'individual',
    quantity: null,
    status: 'active',
    rationaleNote: null,
    priority: null,
    priceAmount: null,
    priceCurrency: null,
    purchaseSource: null,
    alternativeToCandidateId: null,
    photoAnalysis: null,
    revision: 1,
    createdByProfileId: 'profile-1',
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
  };
}

const CANDIDATE_A = candidate('candidate-a', 'Fig tree');
const CANDIDATE_B = candidate('candidate-b', 'Apple tree');

function queryResult(
  data: PlantCandidateListResult | undefined,
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
      <CandidateList gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  mockedUseListCandidates.mockReset();
});

describe('CandidateList — loading and failure states', () => {
  it('shows a loading status on the first fetch', () => {
    mockListResult(queryResult(undefined, { isPending: true, isLoadingError: false }));

    renderList();

    expect(screen.getByText('Loading candidates.')).toBeTruthy();
  });

  it('replaces the view with the full failure state only when nothing has loaded yet', () => {
    mockListResult(
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

  it('shows the empty message when nothing matches', () => {
    mockListResult(queryResult({ items: [] }));

    renderList();

    expect(screen.getByText('No candidates match the current search and filters.')).toBeTruthy();
  });

  it('keeps already-loaded candidates visible with the stale indicator on a connectivity failure', () => {
    mockListResult(
      queryResult(
        { items: [CANDIDATE_A] },
        { isError: true, error: { failure: TRANSPORT_FAILURE } },
      ),
    );

    renderList();

    expect(screen.getByText('Fig tree')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('CandidateList — search, filters, and pagination', () => {
  it('renders a candidate as a link to its detail page', () => {
    mockListResult(queryResult({ items: [CANDIDATE_A] }));

    renderList();

    const link = screen.getByRole<HTMLAnchorElement>('link', { name: /Fig tree/ });
    expect(link.getAttribute('href')).toBe('/application/gardens/garden-1/candidates/candidate-a');
  });

  it('re-queries with the typed text and resets pagination when the search box changes', () => {
    mockListResult(queryResult({ items: [CANDIDATE_A] }));

    renderList();

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'fig' } });

    expect(mockedUseListCandidates).toHaveBeenLastCalledWith('garden-1', {
      query: 'fig',
      status: WORKING_STATUSES,
      priority: null,
      cursor: null,
      limit: 20,
    });
  });

  // `archived` and `rejected` are hidden by default so that disposing of a
  // candidate takes it out of the working list — the whole point of the
  // default. Checking `Archived` is how a user goes looking for one.
  it('starts on the working statuses and adds archived only when asked', () => {
    mockListResult(queryResult({ items: [CANDIDATE_A] }));

    renderList();

    expect(mockedUseListCandidates).toHaveBeenLastCalledWith('garden-1', {
      query: null,
      status: WORKING_STATUSES,
      priority: null,
      cursor: null,
      limit: 20,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Archived' }));

    expect(mockedUseListCandidates).toHaveBeenLastCalledWith('garden-1', {
      query: null,
      status: [...WORKING_STATUSES, 'archived'],
      priority: null,
      cursor: null,
      limit: 20,
    });
  });

  it('re-queries with the remaining statuses when a default one is unchecked', () => {
    mockListResult(queryResult({ items: [CANDIDATE_A] }));

    renderList();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Active' }));

    expect(mockedUseListCandidates).toHaveBeenLastCalledWith('garden-1', {
      query: null,
      status: WORKING_STATUSES.filter((status) => status !== 'active'),
      priority: null,
      cursor: null,
      limit: 20,
    });
  });

  it('re-queries with the selected priorities when a priority filter is toggled', () => {
    mockListResult(queryResult({ items: [CANDIDATE_A] }));

    renderList();

    fireEvent.click(screen.getByRole('checkbox', { name: 'High' }));

    expect(mockedUseListCandidates).toHaveBeenLastCalledWith('garden-1', {
      query: null,
      status: WORKING_STATUSES,
      priority: ['high'],
      cursor: null,
      limit: 20,
    });
  });

  it('loads the next page on "Load more", keeping the earlier page visible', () => {
    mockedUseListCandidates.mockImplementation((_gardenId, params) => {
      const fields =
        params.cursor === null || params.cursor === undefined
          ? queryResult({ items: [CANDIDATE_A], nextCursor: 'cursor-2' })
          : params.cursor === 'cursor-2'
            ? queryResult({ items: [CANDIDATE_B] })
            : (() => {
                throw new Error(`unexpected cursor: ${String(params.cursor)}`);
              })();
      return fields as unknown as ReturnType<typeof useListCandidates>;
    });

    renderList();

    expect(screen.getByText('Fig tree')).toBeTruthy();
    expect(screen.queryByText('Apple tree')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(screen.getByText('Fig tree')).toBeTruthy();
    expect(screen.getByText('Apple tree')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
