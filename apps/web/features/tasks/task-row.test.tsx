import type { Task } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { TaskRow } from './task-row';

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false };

vi.mock('./queries', () => ({
  useCompleteTask: () => idleMutation,
  useDismissTask: () => idleMutation,
  useSkipTask: () => idleMutation,
  useDeleteTask: () => idleMutation,
  useEditTask: () => idleMutation,
  useRescheduleTask: () => idleMutation,
}));

const TASK: Task = {
  id: 'task-1',
  gardenId: 'garden-1',
  targetKind: 'garden',
  targetGardenAreaMapObjectId: null,
  targetPlantId: null,
  title: 'Water the beds',
  notes: null,
  status: 'planned',
  dueDate: null,
  timeWindowStart: null,
  timeWindowEnd: null,
  recurrenceRule: null,
  urgency: 'normal',
  source: 'manual',
  originObservationId: null,
  revision: 1,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
  completedAt: null,
};

function renderRow() {
  return render(
    <LocalizationProvider locale="en">
      <TaskRow gardenId="garden-1" task={TASK} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

describe('TaskRow — offline gate (P5-WEB-01 follow-up)', () => {
  it('disables complete/skip/dismiss/delete while offline and re-enables them on reconnect', () => {
    renderRow();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Complete' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Dismiss' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' }).disabled).toBe(true);

    act(() => onlineManager.setOnline(true));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Complete' }).disabled).toBe(
      false,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Dismiss' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' }).disabled).toBe(false);
  });

  it('leaves Edit/Reschedule (panel toggles, not mutations) enabled while offline', () => {
    renderRow();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reschedule' }).disabled).toBe(
      false,
    );
  });
});
