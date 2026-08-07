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
    },
  ],
};

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
      data: { profile: PROFILE, images: [] },
    } as never);

    renderProfile();

    // Provenance is not optional decoration: a hardiness range from a federal
    // dataset and one from an occurrence record are different claims.
    expect(screen.getByText('hardiness_zone_min')).toBeTruthy();
    expect(screen.getByText('Source: usda_plants')).toBeTruthy();
    expect(screen.getByText('USDA PLANTS Database')).toBeTruthy();
  });

  it('treats a null fact profile as ordinary missing knowledge', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: { profile: null, images: [] },
    } as never);

    renderProfile();

    expect(
      screen.getByText('This profile was assembled without any reviewed facts in it.'),
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
      data: { profile: { ...PROFILE, isPartial: true }, images: [] },
    } as never);

    renderProfile();

    expect(screen.getByText('Incomplete profile')).toBeTruthy();
  });
  it('shows a licensed image with its credit, because the credit is the licence condition', () => {
    mockedUseTaxonProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        profile: PROFILE,
        images: [
          {
            id: 'image-1',
            sourceUrl: 'https://example.org/tomato.jpg',
            license: 'cc_by',
            attribution: 'A. Botanist',
            organ: null,
          },
        ],
      },
    } as never);

    render(<TaxonProfile taxonomyReferenceId="taxon-1" />);

    expect(screen.getByRole('img', { name: /reference photograph/i })).toBeTruthy();
    expect(screen.getByText('Photograph: A. Botanist')).toBeTruthy();
  });
});
