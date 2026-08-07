import type { Plant } from '@verdery/api-contracts';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MediaPublic from '@/features/media/public';
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
const recordObservationMutateMock = vi.fn();

let uploadState: {
  phase: string;
  mediaId: string | null;
  /** Mirrors the controller's own `media`, whose `uploadState` gates creation. */
  media: {
    uploadState: string;
    declaredByteSize: number;
    verifiedByteSize: number | null;
  } | null;
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

// Partial: `photoReadyForIdentification` is a pure decision this panel is
// tested THROUGH — stubbing it would hide the gate these tests exist to check.
vi.mock('@/features/media/public', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaPublic>()),
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
  useRecordObservationFromIdentification: () => ({
    mutate: recordObservationMutateMock,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
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
  coverMediaId: null,
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
  recordObservationMutateMock.mockClear();
  uploadState = {
    phase: 'idle',
    mediaId: null,
    media: null,
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

  it('creates the plant once the uploaded media is available', () => {
    uploadState.mediaId = 'media-1';
    uploadState.media = {
      uploadState: 'available',
      declaredByteSize: 2_000_000,
      verifiedByteSize: null,
    };
    uploadState.phase = 'processing';

    renderPanel();

    expect(addFromPhotoMutateMock).toHaveBeenCalledWith({ photoMediaId: 'media-1' });
  });

  /*
   * Regression. `mediaId` is set the moment the upload is REGISTERED, before
   * any byte is stored, so creating on the id alone called the API against a
   * still-`pending` media record and was refused with a 400 — seen in
   * production 93ms after the registration's own 201.
   */
  it('does not create the plant while the registered media is still pending', () => {
    uploadState.mediaId = 'media-1';
    uploadState.media = {
      uploadState: 'pending',
      declaredByteSize: 2_000_000,
      verifiedByteSize: null,
    };
    uploadState.phase = 'uploading';

    renderPanel();

    expect(addFromPhotoMutateMock).not.toHaveBeenCalled();
  });

  it('submits a large available original without a client-side identification limit', () => {
    uploadState.mediaId = 'media-1';
    uploadState.media = {
      uploadState: 'available',
      declaredByteSize: 80_000_000,
      verifiedByteSize: null,
    };
    uploadState.phase = 'processing';

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
      screen.getByText(
        "Not in the plant catalog yet — confirming will use this as the plant's name.",
      ),
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
      isPending: false,
      isError: false,
      isSuccess: true,
    };

    renderPanel();

    expect(screen.getByText('Variety')).toBeTruthy();
    expect(screen.getByText('Roma')).toBeTruthy();
    expect(screen.getByText('Growth stage')).toBeTruthy();
    expect(screen.getByText('Flowering')).toBeTruthy();
    expect(screen.getByText('Condition')).toBeTruthy();
    expect(screen.getByText('Leaves show mild water stress')).toBeTruthy();
    expect(screen.getByText('Care suggestion')).toBeTruthy();
    expect(screen.getByText('Water more consistently and check drainage.')).toBeTruthy();
    expect(screen.getByText('Estimated acquisition date')).toBeTruthy();
    expect(screen.getByText('2026-05-01')).toBeTruthy();
  });

  it('records the condition guess as an observation, independent of confirming the species', () => {
    addFromPhotoState.data = PLANT;
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
      isPending: false,
      isError: false,
      isSuccess: true,
    };

    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Record as observation' }));

    expect(recordObservationMutateMock).toHaveBeenCalledWith({
      plantId: 'plant-1',
      identificationId: 'identification-1',
    });
    expect(confirmMutateMock).not.toHaveBeenCalled();
  });
});
