import type { Plant } from '@verdery/api-contracts';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantDetail } from './plant-detail';

const confirmMutateMock = vi.fn();

let identificationState: { data: unknown };

vi.mock('./queries', () => ({
  usePlant: () => ({ isPending: false, isLoadingError: false, isError: false, data: PLANT }),
  usePlantIdentification: () => identificationState,
  useConfirmPlantIdentification: () => ({
    mutate: confirmMutateMock,
    isPending: false,
    isError: false,
  }),
  useUpdatePlantDetails: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetPlantStatus: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useTransitionPlantLifecycleStage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMovePlant: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useTaxonomyReferenceSearch: () => ({ data: { items: [] }, isError: false }),
}));

const PLANT: Plant = {
  id: 'plant-1',
  gardenId: 'garden-1',
  gardenAreaMapObjectId: null,
  placementMapObjectId: null,
  displayName: 'Tomato',
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
  revision: 3,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function renderDetail() {
  return render(
    <LocalizationProvider locale="en">
      <PlantDetail gardenId="garden-1" plantId="plant-1" />
    </LocalizationProvider>,
  );
}

beforeEach(() => {
  confirmMutateMock.mockClear();
  identificationState = { data: null };
});

describe('PlantDetail — pending identification banner (ADR-0015)', () => {
  it('shows no banner when nothing is pending', () => {
    renderDetail();

    expect(screen.queryByText('The AI suggested a species for this plant.')).toBeNull();
  });

  it('shows the suggestion and confirms it against the fetched identification', () => {
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0.81,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: { id: 'tax-1', scientificName: 'Ocimum basilicum', commonName: 'Basil' },
      },
    };

    renderDetail();

    expect(screen.getByText('The AI suggested a species for this plant.')).toBeTruthy();
    expect(screen.getByText('Ocimum basilicum (Basil)')).toBeTruthy();
    expect(screen.getByText('Confidence: 81%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(confirmMutateMock).toHaveBeenCalledWith({
      plantId: 'plant-1',
      identificationId: 'identification-1',
      expectedRevision: 3,
    });
  });

  it('shows no banner when the identification found no confident candidate', () => {
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: null,
      },
    };

    renderDetail();

    expect(screen.queryByText('The AI suggested a species for this plant.')).toBeNull();
  });

  it('shows the AI raw name guess and confirms it when a confident candidate has no catalog match', () => {
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0.88,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: null,
        suggestedCommonName: 'Green ash',
        suggestedScientificName: 'Fraxinus pennsylvanica',
      },
    };

    renderDetail();

    expect(screen.getByText('The AI suggested a species for this plant.')).toBeTruthy();
    expect(screen.getByText('Fraxinus pennsylvanica (Green ash)')).toBeTruthy();
    expect(screen.getByText("Not in the plant catalog yet — confirming will use this as the plant's name.")).toBeTruthy();
    expect(screen.getByText('Confidence: 88%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(confirmMutateMock).toHaveBeenCalledWith({
      plantId: 'plant-1',
      identificationId: 'identification-1',
      expectedRevision: 3,
    });
  });
});
