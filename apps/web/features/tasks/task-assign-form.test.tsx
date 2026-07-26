import { SharedErrorCode } from '@verdery/api-contracts';
import type { GardenMember, Task } from '@verdery/api-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiFailure } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { TaskAssignForm } from './task-assign-form';

const mutateMock = vi.fn();
const onDoneMock = vi.fn();

// Mirrors `create-manual-task-form.test.tsx`'s own convention: mock this
// component's two module boundaries (`./queries` for the mutation,
// `./assignable-members` for the picker's data) rather than standing up a
// full HTTP layer.
let membersQueryMock: {
  data: GardenMember[] | undefined;
  isPending: boolean;
  isError: boolean;
  error?: { failure: ApiFailure };
} = { data: [], isPending: false, isError: false };
let assignMutationMock: {
  mutate: typeof mutateMock;
  isPending: boolean;
  isError: boolean;
  error?: { failure: ApiFailure };
} = {
  mutate: mutateMock,
  isPending: false,
  isError: false,
};

vi.mock('./queries', () => ({
  useAssignTask: () => assignMutationMock,
}));

vi.mock('./assignable-members', () => ({
  useAssignableMembers: () => membersQueryMock,
}));

const STALE_REVISION_FAILURE: ApiFailure = {
  ok: false,
  kind: 'contract',
  code: SharedErrorCode.StaleRevision,
  fallbackMessage: 'stale',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: false,
  details: [],
  status: 412,
};

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
  revision: 5,
  createdByProfileId: 'profile-creator',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
  completedAt: null,
  assignedProfileId: null,
  assignedAt: null,
  completedByProfileId: null,
};

const MEMBERS: GardenMember[] = [
  {
    id: 'member-1',
    gardenId: 'garden-1',
    profileId: 'profile-owner',
    role: 'owner',
    state: 'active',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'member-2',
    gardenId: 'garden-1',
    profileId: 'profile-editor',
    role: 'editor',
    state: 'active',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
];

function renderForm(task: Task = TASK) {
  return render(
    <LocalizationProvider locale="en">
      <TaskAssignForm gardenId="garden-1" task={task} onDone={onDoneMock} />
    </LocalizationProvider>,
  );
}

beforeEach(() => {
  mutateMock.mockClear();
  membersQueryMock = { data: MEMBERS, isPending: false, isError: false };
  assignMutationMock = { mutate: mutateMock, isPending: false, isError: false };
});

describe('TaskAssignForm', () => {
  it('shows a loading state while the member picker is still loading', () => {
    membersQueryMock = { data: undefined, isPending: true, isError: false };

    renderForm();

    expect(screen.getByText('Loading members…')).toBeTruthy();
    expect(screen.queryByLabelText('Assign to')).toBeNull();
  });

  it('lists each active owner/editor member alongside an "Unassigned" option', () => {
    membersQueryMock = { data: MEMBERS, isPending: false, isError: false };

    renderForm();

    const select = screen.getByLabelText<HTMLSelectElement>('Assign to');
    const optionLabels = [...select.options].map((option) => option.text);
    expect(optionLabels).toEqual([
      'Unassigned',
      'Owner — profile-owner',
      'Editor — profile-editor',
    ]);
  });

  it('submits the selected member as assigneeProfileId with the task’s current revision', async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('Assign to'), {
      target: { value: 'profile-editor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    // `zodResolver` validates asynchronously, so `handleSubmit`'s call to
    // `mutate` lands on a later microtask than the click itself.
    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith(
        { input: { assigneeProfileId: 'profile-editor' }, expectedRevision: 5 },
        expect.anything(),
      ),
    );
  });

  it('submits an explicit null to unassign when "Unassigned" is selected', async () => {
    renderForm({ ...TASK, assignedProfileId: 'profile-owner', assignedAt: TASK.createdAt });

    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith(
        { input: { assigneeProfileId: null }, expectedRevision: 5 },
        expect.anything(),
      ),
    );
  });

  it('surfaces a stale-revision conflict as the same generic, understandable message other task forms use', () => {
    assignMutationMock = {
      mutate: mutateMock,
      isPending: false,
      isError: true,
      error: { failure: STALE_REVISION_FAILURE },
    };

    renderForm();

    expect(screen.getByText('The record changed before this edit was saved.')).toBeTruthy();
  });

  it('surfaces a failure to load the member picker itself', () => {
    membersQueryMock = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { failure: STALE_REVISION_FAILURE },
    };

    renderForm();

    expect(screen.getByText('The record changed before this edit was saved.')).toBeTruthy();
    expect(screen.queryByLabelText('Assign to')).toBeNull();
  });
});
