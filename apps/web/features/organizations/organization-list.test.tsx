import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { OrganizationList } from './organization-list';
import { useOrganizations } from './queries';

vi.mock('./queries', () => ({ useOrganizations: vi.fn() }));

const mockedUseOrganizations = vi.mocked(useOrganizations);

function mockOrganizationsQuery(fields: Record<string, unknown>): void {
  mockedUseOrganizations.mockReturnValue(fields as unknown as ReturnType<typeof useOrganizations>);
}

const ORGANIZATION = {
  id: 'org-1',
  name: 'Riverside Landscaping',
  callerRole: 'organizationAdmin' as const,
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const TRANSPORT_FAILURE = {
  ok: false as const,
  kind: 'transport' as const,
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: null,
};

function renderList() {
  return render(
    <LocalizationProvider locale="en">
      <OrganizationList />
    </LocalizationProvider>,
  );
}

describe('OrganizationList', () => {
  it('shows a loading indicator on first mount', () => {
    mockOrganizationsQuery({ isPending: true, data: undefined });

    renderList();

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the empty state when the caller belongs to no organization', () => {
    mockOrganizationsQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [] },
    });

    renderList();

    expect(
      screen.getByText('You are not part of any organization yet. Create one below.'),
    ).toBeTruthy();
  });

  it('lists an organization with its own callerRole pill and a link to its detail page', () => {
    mockOrganizationsQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [ORGANIZATION] },
    });

    renderList();

    const link = screen.getByRole('link', { name: 'Riverside Landscaping' });
    expect(link.getAttribute('href')).toBe('/application/organizations/org-1');
    expect(screen.getByText('Administrator')).toBeTruthy();
  });

  it('keeps a previously loaded list visible, with the stale indicator, on a failed background refetch', () => {
    mockOrganizationsQuery({
      isPending: false,
      isLoadingError: false,
      isError: true,
      data: { items: [ORGANIZATION] },
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.getByText('Riverside Landscaping')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
  });

  it('replaces the view with the full failure state on a failed first load', () => {
    mockOrganizationsQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: { failure: TRANSPORT_FAILURE },
      refetch: vi.fn(),
    });

    renderList();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
