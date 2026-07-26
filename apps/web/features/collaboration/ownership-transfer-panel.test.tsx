import type { GardenMember, OwnershipTransfer } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { OwnershipTransferPanel } from './ownership-transfer-panel';
import {
  useAcceptOwnershipTransfer,
  useCancelOwnershipTransfer,
  useDeclineOwnershipTransfer,
  useGardenOwnershipTransfer,
  useTransferOwnership,
} from './ownership-queries';

vi.mock('./ownership-queries', () => ({
  useGardenOwnershipTransfer: vi.fn(),
  useTransferOwnership: vi.fn(),
  useCancelOwnershipTransfer: vi.fn(),
  useAcceptOwnershipTransfer: vi.fn(),
  useDeclineOwnershipTransfer: vi.fn(),
}));

const mockedUseGardenOwnershipTransfer = vi.mocked(useGardenOwnershipTransfer);
const mockedUseTransferOwnership = vi.mocked(useTransferOwnership);
const mockedUseCancelOwnershipTransfer = vi.mocked(useCancelOwnershipTransfer);
const mockedUseAcceptOwnershipTransfer = vi.mocked(useAcceptOwnershipTransfer);
const mockedUseDeclineOwnershipTransfer = vi.mocked(useDeclineOwnershipTransfer);

const OWNER: GardenMember = {
  id: 'member-owner',
  gardenId: 'garden-1',
  profileId: 'profile-owner',
  role: 'owner',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const EDITOR: GardenMember = {
  ...OWNER,
  id: 'member-editor',
  profileId: 'profile-editor',
  role: 'editor',
};

const TRANSFER: OwnershipTransfer = {
  id: 'transfer-1',
  gardenId: 'garden-1',
  fromProfileId: 'profile-owner',
  toProfileId: 'profile-editor',
  fromResultingRole: 'editor',
  state: 'pending',
  authenticatedAt: '2026-07-21T09:00:00Z',
  requestedAt: '2026-07-21T09:00:00Z',
};

const NOT_FOUND_FAILURE = {
  ok: false as const,
  kind: 'contract' as const,
  code: 'collaboration.ownership_transfer.not_found',
  fallbackMessage: 'No pending ownership transfer was found.',
  correlationId: 'corr-1',
  retryable: false,
  details: [],
  status: 404,
};

const OTHER_FAILURE = {
  ok: false as const,
  kind: 'contract' as const,
  code: 'error.internal',
  fallbackMessage: 'Something went wrong.',
  correlationId: 'corr-2',
  retryable: false,
  details: [],
  status: 500,
};

/**
 * Only the fields each component actually reads are supplied — not a real
 * `UseQueryResult`/`UseMutationResult` (both large discriminated unions of
 * TanStack Query's own internal flags) — so the loosely-typed literal is
 * cast through `unknown` once, mirroring `garden-list.test.tsx`'s own
 * `mockGardensQuery` helper.
 */
function mockTransferQuery(fields: Record<string, unknown>): void {
  mockedUseGardenOwnershipTransfer.mockReturnValue(
    fields as unknown as ReturnType<typeof useGardenOwnershipTransfer>,
  );
}

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

function mockIdleMutations(): void {
  mockedUseTransferOwnership.mockReturnValue(
    idleMutation() as ReturnType<typeof useTransferOwnership>,
  );
  mockedUseCancelOwnershipTransfer.mockReturnValue(
    idleMutation() as ReturnType<typeof useCancelOwnershipTransfer>,
  );
  mockedUseAcceptOwnershipTransfer.mockReturnValue(
    idleMutation() as ReturnType<typeof useAcceptOwnershipTransfer>,
  );
  mockedUseDeclineOwnershipTransfer.mockReturnValue(
    idleMutation() as ReturnType<typeof useDeclineOwnershipTransfer>,
  );
}

beforeEach(() => {
  mockIdleMutations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderOwner(members: readonly GardenMember[]) {
  return render(
    <LocalizationProvider locale="en">
      <OwnershipTransferPanel gardenId="garden-1" callerRole="owner" members={members} />
    </LocalizationProvider>,
  );
}

function renderRecipient(role: 'editor' | 'viewer' = 'editor') {
  return render(
    <LocalizationProvider locale="en">
      <OwnershipTransferPanel gardenId="garden-1" callerRole={role} members={[OWNER, EDITOR]} />
    </LocalizationProvider>,
  );
}

describe('OwnershipTransferPanel — owner branch', () => {
  it('shows a loading state while the real pending-transfer read is in flight', () => {
    mockTransferQuery({ isPending: true, isLoadingError: false });

    renderOwner([OWNER, EDITOR]);

    expect(screen.getByText('Loading the ownership transfer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request transfer' })).toBeNull();
  });

  it('shows the full failure state on a failed first read, with a retry', () => {
    const refetch = vi.fn();
    mockTransferQuery({
      isPending: false,
      isLoadingError: true,
      error: { failure: OTHER_FAILURE },
      refetch,
    });

    renderOwner([OWNER, EDITOR]);

    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('shows "no eligible members" when nothing is pending and every member is already an owner', () => {
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: null });

    renderOwner([OWNER]);

    expect(screen.getByText(/Invite another member before transferring ownership/)).toBeTruthy();
  });

  it('disables submit until a target is selected, and requests a transfer once one is', () => {
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: null });
    const mutate = vi.fn<(variables: { toProfileId: string; resultingRole: string }) => void>();
    mockedUseTransferOwnership.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useTransferOwnership>);

    renderOwner([OWNER, EDITOR]);

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Request transfer' });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox', { name: 'New owner' }), {
      target: { value: 'profile-editor' },
    });

    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(mutate.mock.calls[0]?.[0]).toEqual({
      toProfileId: 'profile-editor',
      resultingRole: 'editor',
    });
  });

  it('shows the real pending transfer, read after a reload, with a cancel option', () => {
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });

    renderOwner([OWNER, EDITOR]);

    expect(screen.getByText(/You offered ownership of this garden/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel this transfer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request transfer' })).toBeNull();
  });

  it('cancels the pending transfer once confirmed', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });
    const mutate = vi.fn();
    mockedUseCancelOwnershipTransfer.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCancelOwnershipTransfer>);

    renderOwner([OWNER, EDITOR]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this transfer' }));

    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not cancel without confirmation', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });
    const mutate = vi.fn();
    mockedUseCancelOwnershipTransfer.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCancelOwnershipTransfer>);

    renderOwner([OWNER, EDITOR]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this transfer' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('silently refetches, rather than showing a failure, when cancelling races a resolution already in flight', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const refetch = vi.fn();
    mockTransferQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: TRANSFER,
      refetch,
    });
    mockedUseCancelOwnershipTransfer.mockReturnValue({
      mutate: (
        _variables: unknown,
        options: { onError: (error: { failure: typeof NOT_FOUND_FAILURE }) => void },
      ) => options.onError({ failure: NOT_FOUND_FAILURE }),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCancelOwnershipTransfer>);

    renderOwner([OWNER, EDITOR]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this transfer' }));

    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('OwnershipTransferPanel — recipient branch', () => {
  it('shows a loading state while the real pending-transfer read is in flight', () => {
    mockTransferQuery({ isPending: true, isLoadingError: false });

    renderRecipient();

    expect(screen.getByText('Loading the ownership transfer.')).toBeTruthy();
  });

  it('renders nothing once loaded when nothing is actually pending for the caller', () => {
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: null });

    const { container } = renderRecipient();

    expect(container.textContent).toBe('');
  });

  it('shows accept and decline only once a real transfer is confirmed pending', () => {
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });

    renderRecipient();

    expect(
      screen.getByText('profile-owner wants to make you the owner of this garden.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept ownership' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  it('does not accept without confirmation', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });
    const mutate = vi.fn();
    mockedUseAcceptOwnershipTransfer.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOwnershipTransfer>);

    renderRecipient();
    fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('accepts once confirmed and shows the accepted notice', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });
    mockedUseAcceptOwnershipTransfer.mockReturnValue({
      mutate: (_variables: unknown, options: { onSuccess: () => void }) => options.onSuccess(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOwnershipTransfer>);

    renderRecipient();
    fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    expect(screen.getByText('You are now the owner of this garden.')).toBeTruthy();
  });

  it('reports a 404 on accept as the offer no longer being available, not a failure', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });
    mockedUseAcceptOwnershipTransfer.mockReturnValue({
      mutate: (
        _variables: unknown,
        options: { onError: (error: { failure: typeof NOT_FOUND_FAILURE }) => void },
      ) => options.onError({ failure: NOT_FOUND_FAILURE }),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOwnershipTransfer>);

    renderRecipient();
    fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    expect(screen.getByText('This ownership offer is no longer available.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('declines without a confirmation prompt and shows the declined notice', () => {
    mockTransferQuery({ isPending: false, isLoadingError: false, isError: false, data: TRANSFER });
    mockedUseDeclineOwnershipTransfer.mockReturnValue({
      mutate: (_variables: unknown, options: { onSuccess: () => void }) => options.onSuccess(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useDeclineOwnershipTransfer>);

    renderRecipient();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(screen.getByText('You declined the ownership transfer.')).toBeTruthy();
  });
});
