import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { OrganizationMembers } from './organization-members';
import {
  useAddOrganizationMember,
  useChangeOrganizationMemberRole,
  useOrganization,
  useOrganizationMembers,
  useRemoveOrganizationMember,
} from './queries';

vi.mock('./queries', () => ({
  useOrganization: vi.fn(),
  useOrganizationMembers: vi.fn(),
  useAddOrganizationMember: vi.fn(),
  useChangeOrganizationMemberRole: vi.fn(),
  useRemoveOrganizationMember: vi.fn(),
}));

const mockedUseOrganization = vi.mocked(useOrganization);
const mockedUseOrganizationMembers = vi.mocked(useOrganizationMembers);

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

function mockIdleMutations(): void {
  vi.mocked(useAddOrganizationMember).mockReturnValue(
    idleMutation() as ReturnType<typeof useAddOrganizationMember>,
  );
  vi.mocked(useChangeOrganizationMemberRole).mockReturnValue(
    idleMutation() as ReturnType<typeof useChangeOrganizationMemberRole>,
  );
  vi.mocked(useRemoveOrganizationMember).mockReturnValue(
    idleMutation() as ReturnType<typeof useRemoveOrganizationMember>,
  );
}

const ADMIN_MEMBER = {
  id: 'membership-1',
  organizationId: 'org-1',
  profileId: 'profile-admin',
  role: 'organizationAdmin' as const,
  state: 'active' as const,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const PROFESSIONAL_MEMBER = {
  ...ADMIN_MEMBER,
  id: 'membership-2',
  profileId: 'profile-pro',
  role: 'professional' as const,
};

function renderMembers(callerRole: 'organizationAdmin' | 'professional') {
  mockIdleMutations();
  mockedUseOrganization.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data: { id: 'org-1', name: 'Org', callerRole, revision: 1, createdAt: '', updatedAt: '' },
  } as unknown as ReturnType<typeof useOrganization>);
  mockedUseOrganizationMembers.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data: { items: [ADMIN_MEMBER, PROFESSIONAL_MEMBER] },
  } as unknown as ReturnType<typeof useOrganizationMembers>);

  return render(
    <LocalizationProvider locale="en">
      <OrganizationMembers organizationId="org-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrganizationMembers — admin-only administration', () => {
  it('shows every member to a non-admin caller, with no mutation controls at all', () => {
    renderMembers('professional');

    expect(screen.getByText('profile-admin')).toBeTruthy();
    expect(screen.getByText('profile-pro')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByText('Add a member')).toBeNull();
  });

  it('shows the add-member form and per-row remove/change-role controls to an admin caller', () => {
    renderMembers('organizationAdmin');

    expect(screen.getByText('Add a member')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBe(2);
  });

  it('surfaces the real last-admin 422 as a failure alert rather than guessing the invariant client-side', () => {
    mockIdleMutations();
    mockedUseOrganization.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: {
        id: 'org-1',
        name: 'Org',
        callerRole: 'organizationAdmin',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    } as unknown as ReturnType<typeof useOrganization>);
    mockedUseOrganizationMembers.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [ADMIN_MEMBER] },
    } as unknown as ReturnType<typeof useOrganizationMembers>);
    vi.mocked(useRemoveOrganizationMember).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: {
        failure: {
          ok: false,
          kind: 'contract',
          code: 'organization.membership.last_admin_required',
          fallbackMessage: 'This action would leave the organization with no administrator.',
          correlationId: 'corr-1',
          retryable: false,
          details: [],
          status: 422,
        },
      },
    } as unknown as ReturnType<typeof useRemoveOrganizationMember>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationMembers organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      screen.getByText('This action would leave the organization with no administrator.'),
    ).toBeTruthy();
  });
});
