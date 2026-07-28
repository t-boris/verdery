import type { Plant } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantDeleteSection } from './plant-delete-section';

const mutateMock = vi.fn();

vi.mock('./queries', () => ({
  useSetPlantStatus: () => ({ mutate: mutateMock, isPending: false, isError: false }),
}));

const PLANT: Plant = {
  id: 'plant-1',
  gardenId: 'garden-1',
  gardenAreaMapObjectId: null,
  placementMapObjectId: null,
  displayName: 'Tomato row',
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

function renderSection() {
  return render(
    <LocalizationProvider locale="en">
      <PlantDeleteSection gardenId="garden-1" plant={PLANT} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  mutateMock.mockClear();
  vi.restoreAllMocks();
  act(() => onlineManager.setOnline(true));
});

describe('PlantDeleteSection', () => {
  it('deletes (sets status to removed) once the user confirms', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Delete plant' }));

    expect(mutateMock).toHaveBeenCalledWith({ status: 'removed', expectedRevision: 3 });
  });

  it('does nothing when the user declines the confirmation', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Delete plant' }));

    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('disables the button while offline and re-enables it on reconnect', () => {
    renderSection();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete plant' }).disabled).toBe(
      true,
    );

    act(() => onlineManager.setOnline(true));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete plant' }).disabled).toBe(
      false,
    );
  });
});
