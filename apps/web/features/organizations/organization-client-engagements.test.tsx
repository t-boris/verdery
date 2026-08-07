import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { OrganizationClientEngagements } from './organization-client-engagements';
import {
  useActivateClientEngagement,
  useCreateClientEngagement,
  useEndClientEngagement,
  useOrganization,
  useOrganizationClientEngagements,
  useRevokeClientEngagement,
} from './queries';

vi.mock('./queries', () => ({
  useOrganization: vi.fn(),
  useOrganizationClientEngagements: vi.fn(),
  useCreateClientEngagement: vi.fn(),
  useActivateClientEngagement: vi.fn(),
  useEndClientEngagement: vi.fn(),
  useRevokeClientEngagement: vi.fn(),
}));

const mockedUseOrganization = vi.mocked(useOrganization);
const mockedUseEngagements = vi.mocked(useOrganizationClientEngagements);

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown;
}

function mockCommon(callerRole: 'organizationAdmin' | 'professional'): void {
  vi.mocked(useCreateClientEngagement).mockReturnValue(
    idleMutation() as ReturnType<typeof useCreateClientEngagement>,
  );
  vi.mocked(useActivateClientEngagement).mockReturnValue(
    idleMutation() as ReturnType<typeof useActivateClientEngagement>,
  );
  vi.mocked(useEndClientEngagement).mockReturnValue(
    idleMutation() as ReturnType<typeof useEndClientEngagement>,
  );
  vi.mocked(useRevokeClientEngagement).mockReturnValue(
    idleMutation() as ReturnType<typeof useRevokeClientEngagement>,
  );
  mockedUseOrganization.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data: { id: 'org-1', name: 'Org', callerRole, revision: 1, createdAt: '', updatedAt: '' },
  } as unknown as ReturnType<typeof useOrganization>);
}

const DRAFT_ENGAGEMENT = {
  id: 'engagement-1',
  gardenId: 'garden-1',
  serviceOrganizationId: 'org-1',
  state: 'draft' as const,
  stewardshipPolicy: 'residential' as const,
  clientNotificationsEnabled: true,
  createdByProfileId: 'profile-admin',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrganizationClientEngagements — admin-only lifecycle, everyone reads', () => {
  it('shows the engagement list with no lifecycle controls or create form to a non-admin caller', () => {
    mockCommon('professional');
    mockedUseEngagements.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [DRAFT_ENGAGEMENT] },
    } as unknown as ReturnType<typeof useOrganizationClientEngagements>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationClientEngagements organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByText('garden-1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByText('Create a client engagement')).toBeNull();
  });

  it('offers activate and revoke for a draft engagement, to an admin caller', () => {
    mockCommon('organizationAdmin');
    mockedUseEngagements.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [DRAFT_ENGAGEMENT] },
    } as unknown as ReturnType<typeof useOrganizationClientEngagements>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationClientEngagements organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    expect(screen.getAllByText('Create a client engagement').length).toBeGreaterThan(0);
  });

  it('offers end and revoke, not activate, for an active engagement', () => {
    mockCommon('organizationAdmin');
    mockedUseEngagements.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [{ ...DRAFT_ENGAGEMENT, state: 'active' as const }] },
    } as unknown as ReturnType<typeof useOrganizationClientEngagements>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationClientEngagements organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('offers no lifecycle controls at all for a terminal engagement', () => {
    mockCommon('organizationAdmin');
    mockedUseEngagements.mockReturnValue({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [{ ...DRAFT_ENGAGEMENT, state: 'ended' as const }] },
    } as unknown as ReturnType<typeof useOrganizationClientEngagements>);

    render(
      <LocalizationProvider locale="en">
        <OrganizationClientEngagements organizationId="org-1" />
      </LocalizationProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});
