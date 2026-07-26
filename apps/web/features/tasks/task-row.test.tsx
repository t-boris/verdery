import type { Task } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { TaskRow } from './task-row';

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false };
const idleActivityQuery = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };

vi.mock('./queries', () => ({
  useCompleteTask: () => idleMutation,
  useDismissTask: () => idleMutation,
  useSkipTask: () => idleMutation,
  useDeleteTask: () => idleMutation,
  useEditTask: () => idleMutation,
  useRescheduleTask: () => idleMutation,
  useAssignTask: () => idleMutation,
  useTaskActivity: () => idleActivityQuery,
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
  originRecommendationId: null,
  revision: 1,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
  completedAt: null,
  assignedProfileId: null,
  assignedAt: null,
  completedByProfileId: null,
};

function renderRow(task: Task = TASK) {
  return render(
    <LocalizationProvider locale="en">
      <TaskRow gardenId="garden-1" task={task} />
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

  it('leaves Edit/Reschedule/Assign/Activity (panel toggles, not mutations) enabled while offline', () => {
    renderRow();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reschedule' }).disabled).toBe(
      false,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Assign' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Activity' }).disabled).toBe(
      false,
    );
  });
});

describe('TaskRow — current assignment and completion attribution (P9A-TASK-01)', () => {
  it('shows "Unassigned" for a task with no assignee', () => {
    renderRow({ ...TASK, assignedProfileId: null, assignedAt: null });

    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('shows the assignee profile id for an assigned task', () => {
    renderRow({
      ...TASK,
      assignedProfileId: 'profile-assignee',
      assignedAt: '2026-07-22T10:00:00Z',
    });

    expect(screen.getByText('Assigned to profile-assignee')).toBeTruthy();
  });

  it('offers the "Assign" action only while the task is mutable', () => {
    renderRow({ ...TASK, status: 'completed' });

    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('always offers "Activity" regardless of task status', () => {
    renderRow({ ...TASK, status: 'completed' });

    expect(screen.getByRole('button', { name: 'Activity' })).toBeTruthy();
  });

  it('shows completion attribution when the completer differs from the assignee', () => {
    renderRow({
      ...TASK,
      status: 'completed',
      completedAt: '2026-07-23T09:00:00Z',
      assignedProfileId: 'profile-assignee',
      assignedAt: '2026-07-22T10:00:00Z',
      completedByProfileId: 'profile-completer',
    });

    expect(screen.getByText('Completed by profile-completer')).toBeTruthy();
    expect(screen.getByText('Assigned to profile-assignee')).toBeTruthy();
  });

  it('omits completion attribution when the completer matches the assignee', () => {
    renderRow({
      ...TASK,
      status: 'completed',
      completedAt: '2026-07-23T09:00:00Z',
      assignedProfileId: 'profile-assignee',
      assignedAt: '2026-07-22T10:00:00Z',
      completedByProfileId: 'profile-assignee',
    });

    expect(screen.queryByText(/^Completed by /)).toBeNull();
  });
});
