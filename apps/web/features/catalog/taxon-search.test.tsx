import type { TaxonomyReference } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { TAXON_SEARCH_LIMIT, useTaxonSearch } from './queries';
import { TaxonSearch } from './taxon-search';

// Only the hook is faked: `TAXON_SEARCH_LIMIT` is the number the component and
// this test must agree on, and re-declaring it here would let them drift.
vi.mock('./queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTaxonSearch: vi.fn(),
}));

const mockedUseTaxonSearch = vi.mocked(useTaxonSearch);

function taxon(id: string, scientificName: string, commonName: string | null): TaxonomyReference {
  return {
    id,
    scientificName,
    commonName,
    varietyName: null,
    source: 'system_catalog',
    matchedName: { nameKind: 'accepted_scientific', nameText: scientificName, locale: null },
    createdByProfileId: null,
    createdAt: '2026-05-02T08:00:00Z',
  };
}

function renderSearch() {
  render(
    <LocalizationProvider locale="en">
      <TaxonSearch gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('TaxonSearch', () => {
  it('browses with an empty query rather than waiting to be told a name', () => {
    mockedUseTaxonSearch.mockReturnValue({
      isError: false,
      data: { items: [taxon('taxon-1', 'Solanum lycopersicum', 'Tomato')] },
    } as never);

    renderSearch();

    // A reader who does not know a name still sees something; that is what
    // makes this a browse and not a lookup.
    expect(mockedUseTaxonSearch).toHaveBeenLastCalledWith('garden-1', '');
    expect(screen.getByRole('link', { name: /Solanum lycopersicum/ })).toBeTruthy();
  });

  it('passes the typed name through to the search', () => {
    mockedUseTaxonSearch.mockReturnValue({ isError: false, data: { items: [] } } as never);

    renderSearch();
    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'tomato' } });

    expect(mockedUseTaxonSearch).toHaveBeenLastCalledWith('garden-1', 'tomato');
    expect(screen.getByText('No taxa match that name.')).toBeTruthy();
  });

  it('says the page is bounded rather than implying it is the whole catalog', () => {
    mockedUseTaxonSearch.mockReturnValue({
      isError: false,
      data: {
        items: Array.from({ length: TAXON_SEARCH_LIMIT }, (_, index) =>
          taxon(`taxon-${String(index)}`, `Species ${String(index)}`, null),
        ),
      },
    } as never);

    renderSearch();

    // This operation takes no cursor, so a full page is the end of what the
    // reader can reach — saying nothing would read as "that is all there is".
    expect(screen.getByText(/Showing the first 25 matches/)).toBeTruthy();
  });
});
