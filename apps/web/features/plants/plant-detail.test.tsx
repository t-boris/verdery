import type { Plant } from '@verdery/api-contracts';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantDetail } from './plant-detail';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const confirmMutateMock = vi.fn();
const recordObservationMutateMock = vi.fn();

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
  usePlantPhotos: () => ({ data: [], isPending: false, isError: false }),
  useSetPrimaryPlantPhoto: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useRecordObservationFromIdentification: () => ({
    mutate: recordObservationMutateMock,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

vi.mock('./map-object-queries', () => ({
  useGardenMapObjects: () => ({ data: [], isPending: false, isError: false }),
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
  coverMediaId: null,
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
  recordObservationMutateMock.mockClear();
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
    expect(
      screen.getByText(
        "Not in the plant catalog yet — confirming will use this as the plant's name.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Confidence: 88%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(confirmMutateMock).toHaveBeenCalledWith({
      plantId: 'plant-1',
      identificationId: 'identification-1',
      expectedRevision: 3,
    });
  });

  it('shows the variety, growth stage, condition, and care-guidance guesses when present', () => {
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0.9,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: {
          id: 'tax-1',
          scientificName: 'Solanum lycopersicum',
          commonName: 'Tomato',
        },
        suggestedVarietyLabel: 'Roma',
        suggestedLifecycleStage: 'flowering',
        suggestedConditionNote: 'Leaves show mild water stress',
        suggestedCareGuidanceNote: 'Water more consistently and check drainage.',
        suggestedAcquisitionDate: '2026-05-01',
      },
    };

    renderDetail();

    const banner = within(
      screen.getByText('The AI suggested a species for this plant.').closest('div')!,
    );
    expect(banner.getByText('Variety')).toBeTruthy();
    expect(banner.getByText('Roma')).toBeTruthy();
    expect(banner.getByText('Growth stage')).toBeTruthy();
    expect(banner.getByText('Flowering')).toBeTruthy();
    expect(banner.getByText('Condition')).toBeTruthy();
    expect(banner.getByText('Leaves show mild water stress')).toBeTruthy();
    expect(banner.getByText('Care suggestion')).toBeTruthy();
    expect(banner.getByText('Water more consistently and check drainage.')).toBeTruthy();
    expect(banner.getByText('Estimated acquisition date')).toBeTruthy();
    expect(banner.getByText('2026-05-01')).toBeTruthy();
  });

  it('shows a "Record as observation" button and records it independently of confirming the species', () => {
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0.9,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: {
          id: 'tax-1',
          scientificName: 'Solanum lycopersicum',
          commonName: 'Tomato',
        },
        suggestedConditionNote: 'Leaves show mild water stress',
      },
    };

    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Record as observation' }));

    expect(recordObservationMutateMock).toHaveBeenCalledWith({
      plantId: 'plant-1',
      identificationId: 'identification-1',
    });
    expect(confirmMutateMock).not.toHaveBeenCalled();
  });

  it('shows the banner for a condition guess alone, with no confirmable species suggestion', () => {
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: null,
        suggestedConditionNote: 'Leaves show mild water stress',
      },
    };

    renderDetail();

    expect(screen.getByText('The AI suggested a species for this plant.')).toBeTruthy();
    expect(screen.getByText('Condition')).toBeTruthy();
    expect(screen.getByText('Leaves show mild water stress')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Record as observation' })).toBeTruthy();
  });
});
