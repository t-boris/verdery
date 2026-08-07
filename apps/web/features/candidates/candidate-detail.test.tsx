import type { PlantCandidate } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CandidateDetail } from './candidate-detail';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let candidateState: {
  isPending: boolean;
  isLoadingError: boolean;
  isError: boolean;
  data: unknown;
};

vi.mock('./queries', () => ({
  useCandidate: () => candidateState,
  useUpdateCandidateDetails: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetCandidateStatus: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
  useConvertCandidate: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteCandidate: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCandidateSuitability: () => ({ isPending: false, isError: false, data: null, error: null }),
  useRecalculateCandidateSuitability: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCandidatePhotos: () => ({ data: [], isPending: false, isError: false }),
  useIdentifyCandidateFromPhoto: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

vi.mock('./taxonomy-queries', () => ({
  useTaxonomyReferenceSearch: () => ({ data: { items: [] }, isError: false }),
}));

vi.mock('./map-object-queries', () => ({
  useGardenMapObjects: () => ({ data: [], isPending: false, isError: false }),
}));

function candidate(overrides: Partial<PlantCandidate> = {}): PlantCandidate {
  return {
    id: 'candidate-1',
    gardenId: 'garden-1',
    proposedGardenAreaMapObjectId: null,
    proposedPlacementMapObjectId: null,
    displayName: 'Fig tree',
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
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <LocalizationProvider locale="en">
      <CandidateDetail gardenId="garden-1" candidateId="candidate-1" />
    </LocalizationProvider>,
  );
}

beforeEach(() => {
  candidateState = { isPending: false, isLoadingError: false, isError: false, data: candidate() };
});

describe('CandidateDetail — active candidate', () => {
  it('renders the edit, status, and convert sections', () => {
    renderDetail();

    expect(screen.getByRole('heading', { name: 'Fig tree' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save status' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Convert to plant' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeTruthy();
    expect(
      screen.queryByText('This candidate has already been converted and cannot be edited.'),
    ).toBeNull();
  });

  it('shows the complete structured photo analysis', () => {
    candidateState = {
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: candidate({
        taxonomyReferenceId: 'taxon-1',
        photoAnalysis: {
          commonName: 'Green ash',
          scientificName: 'Fraxinus pennsylvanica',
          familyName: 'Oleaceae',
          genusName: 'Fraxinus',
          varietyLabel: null,
          identificationConfidenceScore: 0.91,
          estimatedAgeMonthsMin: 12,
          estimatedAgeMonthsMax: 24,
          lifecycleStage: 'growing',
          estimatedAcquisitionDate: '2025-03-01',
          analyzedAt: '2026-08-06T12:00:00Z',
          condition: {
            kind: 'stress',
            label: 'Mild leaf curl',
            confidenceScore: 0.72,
            evidenceSummary: 'Several leaves curl at the edges.',
            alternativeExplanations: ['Heat exposure'],
            safetyClass: 'monitor',
            requestedAdditionalEvidence: true,
            requestedViewPurposes: ['leaf_back'],
            careGuidance: 'Check soil moisture consistency.',
          },
        },
      }),
    };

    renderDetail();

    expect(screen.getByText('Fraxinus pennsylvanica')).toBeTruthy();
    expect(screen.getByText('Oleaceae')).toBeTruthy();
    expect(screen.getByText('12–24 months')).toBeTruthy();
    expect(screen.getByText('Mild leaf curl')).toBeTruthy();
    expect(screen.getByText(/Several leaves curl at the edges/)).toBeTruthy();
    expect(screen.getByText(/Check soil moisture consistency/)).toBeTruthy();
  });
});

describe('CandidateDetail — converted candidate', () => {
  it('replaces the edit/status/convert sections with a notice, keeping the suitability panel', () => {
    candidateState = {
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: candidate({ status: 'converted' }),
    };

    renderDetail();

    expect(
      screen.getByText('This candidate has already been converted and cannot be edited.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Convert to plant' })).toBeNull();
    expect(screen.getByText('Suitability for this garden')).toBeTruthy();
  });
});
