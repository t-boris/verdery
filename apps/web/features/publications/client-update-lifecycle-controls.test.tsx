import type { ClientUpdate } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientUpdateLifecycleControls } from './client-update-lifecycle-controls';

const submitMutateMock = vi.fn();
const publishMutateMock = vi.fn();
const withdrawMutateMock = vi.fn();

const idleMutation = { isPending: false, isError: false, isSuccess: false };

vi.mock('./queries', () => ({
  useSubmitClientUpdate: () => ({ ...idleMutation, mutate: submitMutateMock }),
  usePublishClientUpdate: () => ({ ...idleMutation, mutate: publishMutateMock }),
  useWithdrawClientUpdate: () => ({ ...idleMutation, mutate: withdrawMutateMock }),
}));

const BASE_UPDATE: ClientUpdate = {
  id: 'update-1',
  engagementId: 'engagement-1',
  gardenId: 'garden-1',
  state: 'internal_draft',
  title: 'Spring cleanup',
  revision: 3,
  createdByProfileId: 'profile-1',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
  items: [],
};

function renderControls(update: Partial<ClientUpdate> = {}) {
  return render(
    <LocalizationProvider locale="en">
      <ClientUpdateLifecycleControls
        engagementId="engagement-1"
        update={{ ...BASE_UPDATE, ...update }}
      />
    </LocalizationProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  submitMutateMock.mockClear();
  publishMutateMock.mockClear();
  withdrawMutateMock.mockClear();
  act(() => onlineManager.setOnline(true));
});

describe('ClientUpdateLifecycleControls', () => {
  it('disables submit and shows a hint when no summary is set', () => {
    renderControls({ state: 'internal_draft' });

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Submit for publishing' }).disabled,
    ).toBe(true);
    expect(screen.queryByText('Add a summary above before submitting.')).not.toBeNull();
  });

  it('submits with the current revision once a summary is set and confirmed', () => {
    renderControls({ state: 'internal_draft', summary: 'What we did this week.' });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for publishing' }));

    expect(submitMutateMock).toHaveBeenCalledWith(3);
  });

  it('does not submit when the confirmation is declined', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    renderControls({ state: 'internal_draft', summary: 'What we did this week.' });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for publishing' }));

    expect(submitMutateMock).not.toHaveBeenCalled();
  });

  it('publishes with an empty timelineEntries array when no note is entered', () => {
    renderControls({ state: 'ready_for_client', summary: 'What we did this week.' });

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(publishMutateMock).toHaveBeenCalledWith({
      input: { timelineEntries: [] },
      expectedRevision: 3,
    });
  });

  it('publishes with one timelineEntries entry when a note is entered', () => {
    renderControls({ state: 'ready_for_client', summary: 'What we did this week.' });

    fireEvent.change(screen.getByLabelText('Note for the timeline (optional)'), {
      target: { value: 'Pruned the roses.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(publishMutateMock).toHaveBeenCalledTimes(1);
    const call = publishMutateMock.mock.calls[0]?.[0] as {
      input: { timelineEntries: { entryText: string }[] };
      expectedRevision: number;
    };
    expect(call.expectedRevision).toBe(3);
    expect(call.input.timelineEntries).toHaveLength(1);
    expect(call.input.timelineEntries[0]?.entryText).toBe('Pruned the roses.');
  });

  it('withdraws with an empty input when no reason is entered', () => {
    renderControls({ state: 'published', summary: 'What we did this week.' });

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

    expect(withdrawMutateMock).toHaveBeenCalledWith({ input: {}, expectedRevision: 3 });
  });

  it('withdraws with a reason when one is entered', () => {
    renderControls({ state: 'published', summary: 'What we did this week.' });

    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'Incorrect photo.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

    expect(withdrawMutateMock).toHaveBeenCalledWith({
      input: { reason: 'Incorrect photo.' },
      expectedRevision: 3,
    });
  });

  it('renders no lifecycle action for a withdrawn update', () => {
    renderControls({ state: 'withdrawn', summary: 'What we did this week.' });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disables the submit action while offline', () => {
    renderControls({ state: 'internal_draft', summary: 'What we did this week.' });

    act(() => onlineManager.setOnline(false));

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Submit for publishing' }).disabled,
    ).toBe(true);
  });
});
