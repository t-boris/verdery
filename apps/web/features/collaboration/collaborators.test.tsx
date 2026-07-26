import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { Collaborators } from './collaborators';
import {
  useCallerRole,
  useChangeMemberRole,
  useCreateInvitation,
  useGardenInvitations,
  useGardenMembers,
  useRemoveMember,
  useRevokeInvitation,
} from './queries';
import {
  useAcceptOwnershipTransfer,
  useCancelOwnershipTransfer,
  useDeclineOwnershipTransfer,
  useGardenOwnershipTransfer,
  usePromoteMember,
  useDemoteMember,
  useTransferOwnership,
} from './ownership-queries';

vi.mock('./queries', () => ({
  useCallerRole: vi.fn(),
  useGardenMembers: vi.fn(),
  useCreateInvitation: vi.fn(),
  useGardenInvitations: vi.fn(),
  useRevokeInvitation: vi.fn(),
  useChangeMemberRole: vi.fn(),
  useRemoveMember: vi.fn(),
}));

vi.mock('./ownership-queries', () => ({
  usePromoteMember: vi.fn(),
  useDemoteMember: vi.fn(),
  useGardenOwnershipTransfer: vi.fn(),
  useTransferOwnership: vi.fn(),
  useCancelOwnershipTransfer: vi.fn(),
  useAcceptOwnershipTransfer: vi.fn(),
  useDeclineOwnershipTransfer: vi.fn(),
}));

const mockedUseCallerRole = vi.mocked(useCallerRole);
const mockedUseGardenMembers = vi.mocked(useGardenMembers);

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

function mockEverythingIdle(): void {
  vi.mocked(useCreateInvitation).mockReturnValue(
    idleMutation() as ReturnType<typeof useCreateInvitation>,
  );
  vi.mocked(useGardenInvitations).mockReturnValue({
    isPending: true,
    isLoadingError: false,
    isError: false,
    data: undefined,
  } as unknown as ReturnType<typeof useGardenInvitations>);
  vi.mocked(useRevokeInvitation).mockReturnValue(
    idleMutation() as ReturnType<typeof useRevokeInvitation>,
  );
  vi.mocked(useChangeMemberRole).mockReturnValue(
    idleMutation() as ReturnType<typeof useChangeMemberRole>,
  );
  vi.mocked(useRemoveMember).mockReturnValue(idleMutation() as ReturnType<typeof useRemoveMember>);
  vi.mocked(usePromoteMember).mockReturnValue(
    idleMutation() as ReturnType<typeof usePromoteMember>,
  );
  vi.mocked(useDemoteMember).mockReturnValue(idleMutation() as ReturnType<typeof useDemoteMember>);
  vi.mocked(useGardenOwnershipTransfer).mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data: null,
  } as unknown as ReturnType<typeof useGardenOwnershipTransfer>);
  vi.mocked(useTransferOwnership).mockReturnValue(
    idleMutation() as ReturnType<typeof useTransferOwnership>,
  );
  vi.mocked(useCancelOwnershipTransfer).mockReturnValue(
    idleMutation() as ReturnType<typeof useCancelOwnershipTransfer>,
  );
  vi.mocked(useAcceptOwnershipTransfer).mockReturnValue(
    idleMutation() as ReturnType<typeof useAcceptOwnershipTransfer>,
  );
  vi.mocked(useDeclineOwnershipTransfer).mockReturnValue(
    idleMutation() as ReturnType<typeof useDeclineOwnershipTransfer>,
  );
}

/** `overrides` runs after `mockEverythingIdle`'s defaults, so a test can replace just the one mock it cares about. */
function renderCollaborators(overrides?: () => void) {
  mockEverythingIdle();
  overrides?.();
  return render(
    <LocalizationProvider locale="en">
      <Collaborators gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Collaborators — revoked/lost access shows the honest concealed failure, not a raw error or a spinner', () => {
  it('shows a loading indicator on first mount', () => {
    mockedUseCallerRole.mockReturnValue({
      isPending: true,
      isLoadingError: false,
      isError: false,
    } as unknown as ReturnType<typeof useCallerRole>);
    mockedUseGardenMembers.mockReturnValue({
      isPending: true,
      data: undefined,
    } as unknown as ReturnType<typeof useGardenMembers>);

    renderCollaborators();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the same garden.not_found failure `GardenSettings` uses for a revoked/nonexistent garden, with a retry, on a failed first load', () => {
    const failure = {
      ok: false as const,
      kind: 'contract' as const,
      code: 'garden.not_found',
      fallbackMessage: 'This garden could not be found.',
      correlationId: 'corr-1',
      retryable: false,
      details: [],
      status: 404,
    };
    mockedUseCallerRole.mockReturnValue({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCallerRole>);
    mockedUseGardenMembers.mockReturnValue({
      isPending: true,
      data: undefined,
    } as unknown as ReturnType<typeof useGardenMembers>);

    renderCollaborators();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('This garden could not be found.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Collaborators — owner-only sections', () => {
  it('hides invite creation and pending invitations from a non-owner caller', () => {
    mockedUseCallerRole.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { callerRole: 'editor' },
    } as unknown as ReturnType<typeof useCallerRole>);
    mockedUseGardenMembers.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [] },
    } as unknown as ReturnType<typeof useGardenMembers>);

    // A real pending transfer, so the recipient branch has something to
    // render — `useGardenOwnershipTransfer` returning `null` (this suite's
    // idle default) is itself asserted separately by
    // `ownership-transfer-panel.test.tsx`'s "renders nothing" case.
    renderCollaborators(() => {
      vi.mocked(useGardenOwnershipTransfer).mockReturnValue({
        isPending: false,
        isLoadingError: false,
        isError: false,
        data: {
          id: 'transfer-1',
          gardenId: 'garden-1',
          fromProfileId: 'profile-owner',
          toProfileId: 'profile-editor',
          fromResultingRole: 'editor',
          state: 'pending',
          authenticatedAt: '2026-07-21T09:00:00Z',
          requestedAt: '2026-07-21T09:00:00Z',
        },
      } as unknown as ReturnType<typeof useGardenOwnershipTransfer>);
    });

    expect(screen.queryByText('Invite someone')).toBeNull();
    expect(screen.queryByText('Pending invitations')).toBeNull();
    expect(screen.getByText('Respond to an ownership transfer')).toBeTruthy();
  });

  it('shows invite creation and pending invitations to an owner caller', () => {
    mockedUseCallerRole.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { callerRole: 'owner' },
    } as unknown as ReturnType<typeof useCallerRole>);
    mockedUseGardenMembers.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [] },
    } as unknown as ReturnType<typeof useGardenMembers>);

    renderCollaborators();

    expect(screen.getByText('Invite someone')).toBeTruthy();
    expect(screen.getByText('Transfer ownership')).toBeTruthy();
  });
});
