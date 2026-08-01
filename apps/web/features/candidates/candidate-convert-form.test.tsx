import type { ConvertCandidateResult, PlantCandidate } from '@verdery/api-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CandidateConvertForm } from './candidate-convert-form';

const mutateMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock('./queries', () => ({
  useConvertCandidate: () => ({ mutate: mutateMock, isPending: false, isError: false }),
}));

const CANDIDATE: PlantCandidate = {
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
  revision: 5,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function renderForm() {
  return render(
    <LocalizationProvider locale="en">
      <CandidateConvertForm gardenId="garden-1" candidate={CANDIDATE} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  mutateMock.mockClear();
  pushMock.mockClear();
  vi.restoreAllMocks();
});

describe('CandidateConvertForm', () => {
  it('converts with the current revision once the user confirms', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to plant' }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({ input: {}, expectedRevision: 5 });
  });

  it('does nothing when the user declines the confirmation', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to plant' }));

    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalled());
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('navigates to the newly created plant on success', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mutateMock.mockImplementation(
      (_input: unknown, options: { onSuccess: (result: ConvertCandidateResult) => void }) => {
        options.onSuccess({
          plant: { id: 'plant-42' } as ConvertCandidateResult['plant'],
          candidate: CANDIDATE,
          conversion: {
            id: 'conversion-1',
            candidateId: CANDIDATE.id,
            plantId: 'plant-42',
            convertedByProfileId: 'profile-1',
            convertedAt: CANDIDATE.createdAt,
          },
        });
      },
    );
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to plant' }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/application/gardens/garden-1/plants/plant-42'),
    );
  });
});
