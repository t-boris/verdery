import type { GardenMember } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MemberRow } from './member-row';
import { useDemoteMember, usePromoteMember } from './ownership-queries';
import { useChangeMemberRole, useRemoveMember } from './queries';

vi.mock('./queries', () => ({
  useChangeMemberRole: vi.fn(),
  useRemoveMember: vi.fn(),
}));

vi.mock('./ownership-queries', () => ({
  usePromoteMember: vi.fn(),
  useDemoteMember: vi.fn(),
}));

const mockedUseChangeMemberRole = vi.mocked(useChangeMemberRole);
const mockedUseRemoveMember = vi.mocked(useRemoveMember);
const mockedUsePromoteMember = vi.mocked(usePromoteMember);
const mockedUseDemoteMember = vi.mocked(useDemoteMember);

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

function mockIdleMutations(): void {
  mockedUseChangeMemberRole.mockReturnValue(
    idleMutation() as ReturnType<typeof useChangeMemberRole>,
  );
  mockedUseRemoveMember.mockReturnValue(idleMutation() as ReturnType<typeof useRemoveMember>);
  mockedUsePromoteMember.mockReturnValue(idleMutation() as ReturnType<typeof usePromoteMember>);
  mockedUseDemoteMember.mockReturnValue(idleMutation() as ReturnType<typeof useDemoteMember>);
}

const EDITOR_MEMBER: GardenMember = {
  id: 'member-1',
  gardenId: 'garden-1',
  profileId: 'profile-editor',
  role: 'editor',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const OWNER_MEMBER: GardenMember = { ...EDITOR_MEMBER, profileId: 'profile-owner', role: 'owner' };

function renderRow(member: GardenMember, callerIsOwner: boolean) {
  return render(
    <LocalizationProvider locale="en">
      <MemberRow gardenId="garden-1" member={member} callerIsOwner={callerIsOwner} />
    </LocalizationProvider>,
  );
}

beforeEach(() => {
  mockIdleMutations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MemberRow — visibility for every role (H2, S1)', () => {
  it('shows the raw profile id and role for every caller, since there is no display name in the contract', () => {
    renderRow(EDITOR_MEMBER, false);

    expect(screen.getByText('profile-editor')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('renders no administration controls at all for a non-owner caller', () => {
    renderRow(EDITOR_MEMBER, false);

    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Promote to co-owner' })).toBeNull();
  });
});

describe('MemberRow — owner administration (H7, H8, H9, H11)', () => {
  it('offers role change and promote for a non-owner member, not demote', () => {
    renderRow(EDITOR_MEMBER, true);

    expect(screen.getByRole('button', { name: 'Save role' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Promote to co-owner' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Demote from owner' })).toBeNull();
  });

  it('offers demote for an owner member, not role change or promote', () => {
    renderRow(OWNER_MEMBER, true);

    expect(screen.getByRole('button', { name: 'Demote from owner' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Promote to co-owner' })).toBeNull();
  });

  it('always offers remove, for any role', () => {
    renderRow(EDITOR_MEMBER, true);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();

    renderRow(OWNER_MEMBER, true);
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0);
  });

  it('does not mutate remove without confirmation', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const mutate = vi.fn();
    mockedUseRemoveMember.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useRemoveMember>);

    renderRow(EDITOR_MEMBER, true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('mutates remove with the member profile id once confirmed', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const mutate = vi.fn();
    mockedUseRemoveMember.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useRemoveMember>);

    renderRow(EDITOR_MEMBER, true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(mutate).toHaveBeenCalledWith('profile-editor');
  });

  it('disables saving a role change until a different role is selected', () => {
    renderRow(EDITOR_MEMBER, true);

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save role' }).disabled).toBe(
      true,
    );
  });

  it('shows a failure alert when a mutation errors', () => {
    const failure = {
      ok: false as const,
      kind: 'contract' as const,
      code: 'auth.forbidden',
      fallbackMessage: 'Forbidden.',
      correlationId: 'corr-1',
      retryable: false,
      details: [],
      status: 403,
    };
    mockedUseRemoveMember.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { failure },
    } as unknown as ReturnType<typeof useRemoveMember>);

    renderRow(EDITOR_MEMBER, true);

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
