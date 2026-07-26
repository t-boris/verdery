import type { IncomingOwnershipTransfer } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { IncomingOwnershipTransfers } from './incoming-ownership-transfers';
import {
  useAcceptOwnershipTransfer,
  useDeclineOwnershipTransfer,
  useIncomingOwnershipTransfers,
} from './ownership-queries';

vi.mock('./ownership-queries', () => ({
  useIncomingOwnershipTransfers: vi.fn(),
  useAcceptOwnershipTransfer: vi.fn(),
  useDeclineOwnershipTransfer: vi.fn(),
}));

const mockedUseIncomingOwnershipTransfers = vi.mocked(useIncomingOwnershipTransfers);
const mockedUseAcceptOwnershipTransfer = vi.mocked(useAcceptOwnershipTransfer);
const mockedUseDeclineOwnershipTransfer = vi.mocked(useDeclineOwnershipTransfer);

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

const RIVERSIDE_TRANSFER: IncomingOwnershipTransfer = {
  id: 'transfer-1',
  gardenId: 'garden-1',
  gardenName: 'Riverside Garden',
  fromProfileId: 'profile-owner',
  toProfileId: 'profile-editor',
  fromResultingRole: 'editor',
  state: 'pending',
  authenticatedAt: '2026-07-21T09:00:00Z',
  requestedAt: '2026-07-21T09:00:00Z',
};

const HILLSIDE_TRANSFER: IncomingOwnershipTransfer = {
  ...RIVERSIDE_TRANSFER,
  id: 'transfer-2',
  gardenId: 'garden-2',
  gardenName: 'Hillside Plot',
};

function mockIncomingQuery(fields: Record<string, unknown>): void {
  mockedUseIncomingOwnershipTransfers.mockReturnValue(
    fields as unknown as ReturnType<typeof useIncomingOwnershipTransfers>,
  );
}

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

beforeEach(() => {
  mockedUseAcceptOwnershipTransfer.mockReturnValue(
    idleMutation() as ReturnType<typeof useAcceptOwnershipTransfer>,
  );
  mockedUseDeclineOwnershipTransfer.mockReturnValue(
    idleMutation() as ReturnType<typeof useDeclineOwnershipTransfer>,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderBanner() {
  return render(
    <LocalizationProvider locale="en">
      <IncomingOwnershipTransfers />
    </LocalizationProvider>,
  );
}

describe('IncomingOwnershipTransfers', () => {
  it('renders nothing while the read is in flight', () => {
    mockIncomingQuery({ data: undefined });

    const { container } = renderBanner();

    expect(container.textContent).toBe('');
  });

  it('renders nothing once loaded when nothing is pending for the caller', () => {
    mockIncomingQuery({ data: { items: [] } });

    const { container } = renderBanner();

    expect(container.textContent).toBe('');
  });

  it('shows one card per incoming transfer, named by its destination garden', () => {
    mockIncomingQuery({ data: { items: [RIVERSIDE_TRANSFER, HILLSIDE_TRANSFER] } });

    renderBanner();

    expect(screen.getByText('Riverside Garden')).toBeTruthy();
    expect(screen.getByText('Hillside Plot')).toBeTruthy();
    expect(
      screen.getAllByText('profile-owner wants to make you the owner of this garden.'),
    ).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Accept ownership' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Decline' })).toHaveLength(2);
  });

  it('does not accept without confirmation', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    mockIncomingQuery({ data: { items: [RIVERSIDE_TRANSFER] } });
    const mutate = vi.fn();
    mockedUseAcceptOwnershipTransfer.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOwnershipTransfer>);

    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('accepts once confirmed and shows the accepted notice for that card', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mockIncomingQuery({ data: { items: [RIVERSIDE_TRANSFER] } });
    mockedUseAcceptOwnershipTransfer.mockReturnValue({
      mutate: (_variables: unknown, options: { onSuccess: () => void }) => options.onSuccess(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOwnershipTransfer>);

    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    expect(screen.getByText('You are now the owner of this garden.')).toBeTruthy();
  });

  it('declines without a confirmation prompt and shows the declined notice for that card', () => {
    mockIncomingQuery({ data: { items: [RIVERSIDE_TRANSFER] } });
    mockedUseDeclineOwnershipTransfer.mockReturnValue({
      mutate: (_variables: unknown, options: { onSuccess: () => void }) => options.onSuccess(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useDeclineOwnershipTransfer>);

    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(screen.getByText('You declined the ownership transfer.')).toBeTruthy();
  });

  it('reports a 404 on accept as the offer no longer being available, not a failure', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mockIncomingQuery({ data: { items: [RIVERSIDE_TRANSFER] } });
    mockedUseAcceptOwnershipTransfer.mockReturnValue({
      mutate: (
        _variables: unknown,
        options: { onError: (error: { failure: typeof NOT_FOUND_FAILURE }) => void },
      ) => options.onError({ failure: NOT_FOUND_FAILURE }),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOwnershipTransfer>);

    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    expect(screen.getByText('This ownership offer is no longer available.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
