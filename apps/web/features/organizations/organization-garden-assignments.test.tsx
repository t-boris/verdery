import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { OrganizationGardenAssignments } from './organization-garden-assignments';
import {
  useCreateGardenAssignment,
  useEndGardenAssignment,
  useOrganization,
  useOrganizationGardenAssignments,
  useOrganizationMembers,
  useRevokeGardenAssignment,
} from './queries';

vi.mock('./queries', () => ({
  useOrganization: vi.fn(),
  useOrganizationGardenAssignments: vi.fn(),
  useOrganizationMembers: vi.fn(),
  useCreateGardenAssignment: vi.fn(),
  useEndGardenAssignment: vi.fn(),
  useRevokeGardenAssignment: vi.fn(),
}));

const mockedUseOrganization = vi.mocked(useOrganization);
const mockedUseAssignments = vi.mocked(useOrganizationGardenAssignments);

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

const ASSIGNMENT = {
  id: 'assignment-1',
  organizationId: 'org-1',
  profileId: 'profile-pro',
  gardenId: 'garden-1',
  role: 'editor' as const,
  state: 'active' as const,
  validFrom: '2026-07-21T09:00:00Z',
  createdByProfileId: 'profile-admin',
  createdAt: '2026-07-21T09:00:00Z',
};

function mockCommon(callerRole: 'organizationAdmin' | 'professional'): void {
  vi.mocked(useOrganizationMembers).mockReturnValue({
    isPending: false,
    data: { items: [] },
  } as unknown as ReturnType<typeof useOrganizationMembers>);
  vi.mocked(useCreateGardenAssignment).mockReturnValue(
    idleMutation() as ReturnType<typeof useCreateGardenAssignment>,
  );
  vi.mocked(useEndGardenAssignment).mockReturnValue(
    idleMutation() as ReturnType<typeof useEndGardenAssignment>,
  );
  vi.mocked(useRevokeGardenAssignment).mockReturnValue(
    idleMutation() as ReturnType<typeof useRevokeGardenAssignment>,
  );
  mockedUseOrganization.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data: { id: 'org-1', name: 'Org', callerRole, revision: 1, createdAt: '', updatedAt: '' },
  } as unknown as ReturnType<typeof useOrganization>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrganizationGardenAssignments — admin-only creation, everyone reads', () => {
  it('shows the assignment list to a non-admin caller with no create form', () => {
    mockCommon('professional');
    mockedUseAssignments.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [ASSIGNMENT] },
    } as unknown as ReturnType<typeof useOrganizationGardenAssignments>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationGardenAssignments organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByText('profile-pro → garden-1')).toBeTruthy();
    expect(screen.queryByText('Assign a member to a garden')).toBeNull();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('shows end/revoke controls and the create form to an admin caller, for an active assignment', () => {
    mockCommon('organizationAdmin');
    mockedUseAssignments.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [ASSIGNMENT] },
    } as unknown as ReturnType<typeof useOrganizationGardenAssignments>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationGardenAssignments organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getAllByText('Assign a member to a garden').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });

  it('hides end/revoke for an already-terminal assignment', () => {
    mockCommon('organizationAdmin');
    mockedUseAssignments.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [{ ...ASSIGNMENT, state: 'ended' as const }] },
    } as unknown as ReturnType<typeof useOrganizationGardenAssignments>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationGardenAssignments organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.getByText('Ended')).toBeTruthy();
  });

  it('shows the empty state when the organization has no assignments yet', () => {
    mockCommon('professional');
    mockedUseAssignments.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [] },
    } as unknown as ReturnType<typeof useOrganizationGardenAssignments>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationGardenAssignments organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByText('No active garden assignments right now.')).toBeTruthy();
  });
});
