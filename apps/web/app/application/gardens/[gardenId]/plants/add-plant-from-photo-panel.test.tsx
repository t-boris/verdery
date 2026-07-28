import type { Plant } from '@verdery/api-contracts';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lifecycleStageLabel } from '@/features/plants/labels';
import { LocalizationProvider } from '@/shared/localization/public';

import { AddPlantFromPhotoPanel } from './add-plant-from-photo-panel';

interface ConfirmIdentificationVariables {
  readonly plantId: string;
  readonly identificationId: string;
  readonly expectedRevision: number;
}

const pushMock = vi.fn();
const addFromPhotoMutateMock = vi.fn();
const confirmMutateMock =
  vi.fn<(variables: ConfirmIdentificationVariables, options?: { onSuccess: () => void }) => void>();

let uploadState: {
  phase: string;
  mediaId: string | null;
  uploadedBytes: number;
  totalBytes: number;
  displayFilename: string | null;
  retryable: boolean;
  uploadFailureReason: null;
  apiFailure: null;
  pollFailure: null;
};
let addFromPhotoState: {
  data: Plant | undefined;
  isIdle: boolean;
  isPending: boolean;
  isError: boolean;
};
let identificationState: {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
};

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock('@/features/media/public', () => ({
  useMediaUpload: () => ({
    ...uploadState,
    startUpload: vi.fn(),
    pause: vi.fn(),
    resumeRecovered: vi.fn(),
    discardRecovered: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
  }),
  formatBytes: (bytes: number) => `${String(bytes)}b`,
  uploadFailureReasonLabel: () => 'media.status.uploadFailed',
  uploadPhaseLabel: () => 'media.phase.idle',
}));

vi.mock('@/features/plants/public', () => ({
  lifecycleStageLabel,
  useAddPlantFromPhoto: () => ({
    ...addFromPhotoState,
    mutate: addFromPhotoMutateMock,
  }),
  useConfirmPlantIdentification: () => ({
    mutate: confirmMutateMock,
    isPending: false,
    isError: false,
  }),
  usePlantIdentification: () => identificationState,
}));

const PLANT: Plant = {
  id: 'plant-1',
  gardenId: 'garden-1',
  gardenAreaMapObjectId: null,
  placementMapObjectId: null,
  displayName: 'Unidentified plant',
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

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <AddPlantFromPhotoPanel gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  addFromPhotoMutateMock.mockClear();
  confirmMutateMock.mockClear();
  uploadState = {
    phase: 'idle',
    mediaId: null,
    uploadedBytes: 0,
    totalBytes: 0,
    displayFilename: null,
    retryable: false,
    uploadFailureReason: null,
    apiFailure: null,
    pollFailure: null,
  };
  addFromPhotoState = { data: undefined, isIdle: true, isPending: false, isError: false };
  identificationState = { data: undefined, isPending: true, isError: false, isSuccess: false };
});

describe('AddPlantFromPhotoPanel — picking', () => {
  it('shows the file picker before any photo is uploaded', () => {
    renderPanel();

    expect(screen.getByLabelText('Choose a photo')).toBeTruthy();
  });

  it('creates the plant once the upload produces a mediaId', () => {
    uploadState.mediaId = 'media-1';
    uploadState.phase = 'processed';

    renderPanel();

    expect(addFromPhotoMutateMock).toHaveBeenCalledWith({ photoMediaId: 'media-1' });
  });
});

describe('AddPlantFromPhotoPanel — reviewing', () => {
  it('shows the suggested species and confidence, and confirms it', () => {
    addFromPhotoState.data = PLANT;
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0.81,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: { id: 'tax-1', scientificName: 'Ocimum basilicum', commonName: 'Basil' },
      },
      isPending: false,
      isError: false,
      isSuccess: true,
    };

    renderPanel();

    expect(screen.getByText('Ocimum basilicum (Basil)')).toBeTruthy();
    expect(screen.getByText('Confidence: 81%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    const [variables, options] = confirmMutateMock.mock.calls[0] ?? [];
    expect(variables).toEqual({
      plantId: 'plant-1',
      identificationId: 'identification-1',
      expectedRevision: 1,
    });
    expect(typeof options?.onSuccess).toBe('function');
  });

  it('offers only "decide later" when no confident candidate was found, and navigates to the plant', () => {
    addFromPhotoState.data = PLANT;
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: null,
      },
      isPending: false,
      isError: false,
      isSuccess: true,
    };

    renderPanel();

    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Decide later' }));

    expect(pushMock).toHaveBeenCalledWith('/application/gardens/garden-1/plants/plant-1');
  });

  it('shows the AI raw name guess and offers Confirm when a confident candidate has no catalog match', () => {
    addFromPhotoState.data = PLANT;
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
      isPending: false,
      isError: false,
      isSuccess: true,
    };

    renderPanel();

    expect(screen.getByText('Fraxinus pennsylvanica (Green ash)')).toBeTruthy();
    expect(
      screen.getByText("Not in the plant catalog yet — confirming will use this as the plant's name."),
    ).toBeTruthy();
    expect(screen.getByText('Confidence: 88%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    const [variables, options] = confirmMutateMock.mock.calls[0] ?? [];
    expect(variables).toEqual({
      plantId: 'plant-1',
      identificationId: 'identification-1',
      expectedRevision: 1,
    });
    expect(typeof options?.onSuccess).toBe('function');
  });

  it('shows the variety, growth stage, condition, and care-guidance guesses when present', () => {
    addFromPhotoState.data = PLANT;
    identificationState = {
      data: {
        id: 'identification-1',
        plantId: 'plant-1',
        plantPhotoId: 'photo-1',
        confidenceScore: 0.9,
        createdAt: '2026-07-21T09:00:00Z',
        suggestedTaxonomy: { id: 'tax-1', scientificName: 'Solanum lycopersicum', commonName: 'Tomato' },
        suggestedVarietyLabel: 'Roma',
        suggestedLifecycleStage: 'flowering',
        suggestedConditionNote: 'Leaves show mild water stress',
        suggestedCareGuidanceNote: 'Water more consistently and check drainage.',
      },
      isPending: false,
      isError: false,
      isSuccess: true,
    };

    renderPanel();

    expect(screen.getByText('Variety: Roma')).toBeTruthy();
    expect(screen.getByText('Growth stage: Flowering')).toBeTruthy();
    expect(screen.getByText('Condition: Leaves show mild water stress')).toBeTruthy();
    expect(
      screen.getByText('Care suggestion: Water more consistently and check drainage.'),
    ).toBeTruthy();
  });
});
