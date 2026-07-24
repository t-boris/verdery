import type { Plant } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantLifecycleControls } from './plant-lifecycle-controls';

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false };

vi.mock('./queries', () => ({
  useTransitionPlantLifecycleStage: () => idleMutation,
  useSetPlantStatus: () => idleMutation,
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
  revision: 1,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function renderControls() {
  return render(
    <LocalizationProvider locale="en">
      <PlantLifecycleControls gardenId="garden-1" plant={PLANT} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

describe('PlantLifecycleControls — offline gate (P5-WEB-01 follow-up)', () => {
  it('disables save-stage/save-status/delete while offline and re-enables them on reconnect', () => {
    renderControls();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save stage' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save status' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete plant' }).disabled).toBe(
      true,
    );

    act(() => onlineManager.setOnline(true));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save stage' }).disabled).toBe(
      false,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save status' }).disabled).toBe(
      false,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete plant' }).disabled).toBe(
      false,
    );
  });
});
