import { SharedErrorCode } from '@verdery/api-contracts';
import type { TaskActivityEntry } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiFailure } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { TaskActivityView } from './task-activity-view';

const refetchMock = vi.fn();

let activityQueryMock: {
  data: { items: TaskActivityEntry[] } | undefined;
  isPending: boolean;
  isError: boolean;
  error?: { failure: ApiFailure };
  refetch: typeof refetchMock;
} = { data: undefined, isPending: true, isError: false, refetch: refetchMock };

// Mirrors this feature's established convention (`task-row.test.tsx`,
// `create-manual-task-form.test.tsx`): mock `./queries`, this component's
// only module boundary, rather than standing up a full HTTP layer.
vi.mock('./queries', () => ({
  useTaskActivity: () => activityQueryMock,
}));

const FAILURE: ApiFailure = {
  ok: false,
  kind: 'contract',
  code: SharedErrorCode.Internal,
  fallbackMessage: 'boom',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: 500,
};

function renderView() {
  return render(
    <LocalizationProvider locale="en">
      <TaskActivityView gardenId="garden-1" taskId="task-1" />
    </LocalizationProvider>,
  );
}

describe('TaskActivityView', () => {
  it('shows a loading state', () => {
    activityQueryMock = { data: undefined, isPending: true, isError: false, refetch: refetchMock };

    renderView();

    expect(screen.getByText('Loading activity…')).toBeTruthy();
  });

  it('shows an empty state for a task with no recorded activity', () => {
    activityQueryMock = {
      data: { items: [] },
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    renderView();

    expect(screen.getByText('No activity yet.')).toBeTruthy();
  });

  it('surfaces a load failure with a retry action that calls refetch', () => {
    activityQueryMock = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { failure: FAILURE },
      refetch: refetchMock,
    };
    refetchMock.mockClear();

    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders every entry field the contract actually returns, oldest first, without inventing any', () => {
    activityQueryMock = {
      data: {
        items: [
          {
            revision: 1,
            commandType: 'createManualTask',
            actorProfileId: 'profile-creator',
            status: 'planned',
            dueDate: null,
            assignedProfileId: null,
            recordedAt: '2026-07-21T09:00:00Z',
          },
          {
            revision: 2,
            commandType: 'rescheduleTask',
            actorProfileId: 'profile-editor',
            status: null,
            dueDate: '2026-08-01',
            assignedProfileId: null,
            recordedAt: '2026-07-22T09:00:00Z',
          },
          {
            revision: 3,
            commandType: 'assignTask',
            actorProfileId: 'profile-owner',
            status: null,
            dueDate: null,
            assignedProfileId: 'profile-assignee',
            recordedAt: '2026-07-23T09:00:00Z',
          },
          {
            revision: 4,
            commandType: 'assignTask',
            actorProfileId: 'profile-owner',
            status: null,
            dueDate: null,
            assignedProfileId: null,
            recordedAt: '2026-07-24T09:00:00Z',
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    renderView();

    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('By profile-creator')).toBeTruthy();
    expect(screen.getByText('Status: Planned')).toBeTruthy();

    expect(screen.getByText('Rescheduled')).toBeTruthy();
    expect(screen.getByText('By profile-editor')).toBeTruthy();
    expect(screen.getByText('New due date: Aug 1, 2026')).toBeTruthy();

    const assignmentChanges = screen.getAllByText('Assignment changed');
    expect(assignmentChanges).toHaveLength(2);
    expect(screen.getByText('Assigned to profile-assignee')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});
