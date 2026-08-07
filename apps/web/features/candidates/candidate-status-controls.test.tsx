import type { PlantCandidate } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CandidateStatusControls } from './candidate-status-controls';

const mutateMock = vi.fn();
const idleMutation = { mutate: mutateMock, isPending: false, isError: false, isSuccess: false };

vi.mock('./queries', () => ({
  useSetCandidateStatus: () => idleMutation,
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
  photoAnalysis: null,
  revision: 1,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function renderControls(candidate: PlantCandidate = CANDIDATE) {
  return render(
    <LocalizationProvider locale="en">
      <CandidateStatusControls gardenId="garden-1" candidate={candidate} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  mutateMock.mockClear();
  act(() => onlineManager.setOnline(true));
});

describe('CandidateStatusControls', () => {
  it('never offers "converted" as a settable status', () => {
    renderControls();

    expect(screen.getByRole('button', { name: 'Active' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archived' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejected' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Converted' })).toBeNull();
  });

  it('applies a newly selected status immediately with the current revision', () => {
    renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Rejected' }));

    expect(mutateMock).toHaveBeenCalledWith({
      input: { status: 'rejected' },
      expectedRevision: 1,
    });
  });

  it('does not submit when the selection did not change', () => {
    renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('disables direct status choices while offline and re-enables them on reconnect', () => {
    renderControls();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Rejected' }).disabled).toBe(true);

    act(() => onlineManager.setOnline(true));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Rejected' }).disabled).toBe(
      false,
    );
  });
});
