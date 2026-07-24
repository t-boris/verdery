import type { Plant } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantMoveForm } from './plant-move-form';

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false };

vi.mock('./queries', () => ({
  useMovePlant: () => idleMutation,
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

function renderForm() {
  return render(
    <LocalizationProvider locale="en">
      <PlantMoveForm gardenId="garden-1" plant={PLANT} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

describe('PlantMoveForm — offline gate (P5-WEB-01 follow-up)', () => {
  it('disables submission while offline and re-enables it on reconnect', () => {
    renderForm();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save placement' }).disabled).toBe(
      true,
    );

    act(() => onlineManager.setOnline(true));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save placement' }).disabled).toBe(
      false,
    );
  });
});
