import type { PlantTaxonProfileResult } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiFailureError } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { useTaxonProfile } from './queries';
import { TaxonProfile } from './taxon-profile';

vi.mock('./queries', () => ({ useTaxonProfile: vi.fn() }));

const mockedUseTaxonProfile = vi.mocked(useTaxonProfile);

const PROFILE: NonNullable<PlantTaxonProfileResult['profile']> = {
  id: 'profile-1',
  taxonomyReferenceId: 'taxon-1',
  isPartial: false,
  createdAt: '2026-05-02T08:00:00Z',
  resolvedFacts: [
    {
      factKey: 'hardiness_zone_min',
      value: '5a',
      unit: null,
      geographicScope: 'US',
      providerKey: 'usda_plants',
      confidence: 0.9,
      sourceCitation: 'USDA PLANTS Database',
      evidenceStatus: 'source_backed',
    },
  ],
};

const TAXONOMY_REFERENCE: PlantTaxonProfileResult['taxonomyReference'] = {
  id: 'taxon-1',
  scientificName: 'Fraxinus pennsylvanica',
  commonName: 'Green ash',
  varietyName: null,
  family: 'Oleaceae',
  genus: 'Fraxinus',
  source: 'system_catalog',
  createdByProfileId: null,
  createdAt: '2026-01-01T00:00:00Z',
  matchedName: null,
};

function result(
  profile: PlantTaxonProfileResult['profile'],
  images: PlantTaxonProfileResult['images'] = [],
): PlantTaxonProfileResult {
  return { taxonomyReference: TAXONOMY_REFERENCE, profile, images };
}

function failure(status: number): ApiFailureError {
  return new ApiFailureError({
    ok: false,
    kind: 'contract',
    code: status === 404 ? 'resource.not_found' : 'internal.error',
    fallbackMessage: 'Not found.',
    correlationId: 'correlation-1',
    retryable: false,
    details: [],
    status,
  });
}

function renderProfile() {
  render(
    <LocalizationProvider locale="en">
      <TaxonProfile taxonomyReferenceId="taxon-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('TaxonProfile', () => {
  it('shows every fact with the source that asserted it', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: result(PROFILE),
    } as never);

    renderProfile();

    // Provenance is not optional decoration: a hardiness range from a federal
    // dataset and one from an occurrence record are different claims.
    expect(screen.getByText('Minimum hardiness zone')).toBeTruthy();
    expect(screen.getByText('Source: usda_plants')).toBeTruthy();
    expect(screen.getByText('USDA PLANTS Database')).toBeTruthy();
    expect(screen.getByText('Source-backed · not horticulturist-reviewed')).toBeTruthy();
  });

  it('treats a null fact profile as ordinary missing knowledge', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: result(null),
    } as never);

    renderProfile();

    expect(
      screen.getByText(/currently connected sources supplied no additional facts/),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still reports a real failure as one', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: true,
      error: failure(500),
    } as never);

    renderProfile();

    expect(screen.queryByText(/Nothing has been assembled/)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('warns when the profile resolved only part of what sources describe', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: result({ ...PROFILE, isPartial: true }),
    } as never);

    renderProfile();

    expect(screen.getByText('Incomplete profile')).toBeTruthy();
  });
  it('shows a licensed image with its credit, because the credit is the licence condition', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: result(PROFILE, [
        {
          id: 'image-1',
          sourceUrl: 'https://example.org/tomato.jpg',
          license: 'cc_by',
          attribution: 'A. Botanist',
          organ: null,
        },
      ]),
    } as never);

    render(<TaxonProfile taxonomyReferenceId="taxon-1" />);

    expect(screen.getByRole('img', { name: /reference photograph/i })).toBeTruthy();
    expect(screen.getByText('Photograph: A. Botanist')).toBeTruthy();
  });

  it('always shows the canonical botanical identity even before reviewed care facts exist', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: result(null),
    } as never);

    renderProfile();

    expect(screen.getByRole('heading', { name: 'Green ash' })).toBeTruthy();
    expect(screen.getByText('Fraxinus pennsylvanica')).toBeTruthy();
    expect(screen.getByText('Oleaceae')).toBeTruthy();
  });
});
