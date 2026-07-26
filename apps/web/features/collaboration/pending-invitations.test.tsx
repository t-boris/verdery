import type { Invitation } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PendingInvitations } from './pending-invitations';
import { useGardenInvitations, useRevokeInvitation } from './queries';

vi.mock('./queries', () => ({
  useGardenInvitations: vi.fn(),
  useRevokeInvitation: vi.fn(),
}));

const mockedUseGardenInvitations = vi.mocked(useGardenInvitations);
const mockedUseRevokeInvitation = vi.mocked(useRevokeInvitation);

const PENDING_INVITATION: Invitation = {
  id: 'invitation-1',
  gardenId: 'garden-1',
  inviterProfileId: 'profile-owner',
  intendedRole: 'editor',
  intendedEmail: 'friend@example.test',
  state: 'pending',
  createdAt: '2026-07-21T09:00:00Z',
  expiresAt: '2026-07-28T09:00:00Z',
};

function mockQuery(fields: Record<string, unknown>): void {
  mockedUseGardenInvitations.mockReturnValue(
    fields as unknown as ReturnType<typeof useGardenInvitations>,
  );
}

function renderPanel() {
  mockedUseRevokeInvitation.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useRevokeInvitation>);
  return render(
    <LocalizationProvider locale="en">
      <PendingInvitations gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PendingInvitations', () => {
  it('shows a loading state', () => {
    mockQuery({ isPending: true, isLoadingError: false, isError: false, data: undefined });
    renderPanel();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the full failure state on a failed first load', () => {
    const failure = {
      ok: false as const,
      kind: 'transport' as const,
      code: 'client.transport_failure',
      fallbackMessage: 'unreachable',
      correlationId: 'corr-1',
      retryable: true,
      details: [],
      status: null,
    };
    mockQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure },
      refetch: vi.fn(),
    });
    renderPanel();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows an empty state with no invitations', () => {
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [] },
    });
    renderPanel();
    expect(screen.getByText('No invitations yet.')).toBeTruthy();
  });

  it('shows the intended email, role, and state for each invitation', () => {
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [PENDING_INVITATION] },
    });
    renderPanel();

    expect(screen.getByText('friend@example.test')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('shows a fallback for an invitation with no bound email', () => {
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [{ ...PENDING_INVITATION, intendedEmail: undefined }] },
    });
    renderPanel();

    expect(screen.getByText('Anyone with the link')).toBeTruthy();
  });

  it('offers revoke only for a pending invitation', () => {
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: {
        items: [
          PENDING_INVITATION,
          { ...PENDING_INVITATION, id: 'invitation-2', state: 'revoked' as const },
        ],
      },
    });
    renderPanel();

    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
  });

  it('revokes only after confirmation', () => {
    const mutate = vi.fn();
    mockedUseRevokeInvitation.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useRevokeInvitation>);
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [PENDING_INVITATION] },
    });

    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    render(
      <LocalizationProvider locale="en">
        <PendingInvitations gardenId="garden-1" />
      </LocalizationProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(mutate).not.toHaveBeenCalled();

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(mutate).toHaveBeenCalledWith('invitation-1');
  });
});
