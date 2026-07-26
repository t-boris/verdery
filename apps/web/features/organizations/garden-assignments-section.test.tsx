import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenAssignmentsSection } from './garden-assignments-section';
import { useGardenAssignmentsForGarden } from './queries';

vi.mock('./queries', () => ({ useGardenAssignmentsForGarden: vi.fn() }));

const mockedUseGardenAssignments = vi.mocked(useGardenAssignmentsForGarden);

function mockQuery(fields: Record<string, unknown>): void {
  mockedUseGardenAssignments.mockReturnValue(
    fields as unknown as ReturnType<typeof useGardenAssignmentsForGarden>,
  );
}

function renderSection() {
  return render(
    <LocalizationProvider locale="en">
      <GardenAssignmentsSection gardenId="garden-1" />
    </LocalizationProvider>,
  );
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

describe('GardenAssignmentsSection — viewGarden-gated, open to every active role', () => {
  it('renders the list for any active role (owner, editor, or viewer) since the endpoint grants all three viewGarden', () => {
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [ASSIGNMENT] },
    });

    renderSection();

    expect(screen.getByText('Professional assignments')).toBeTruthy();
    expect(screen.getByText(/profile-pro/)).toBeTruthy();
  });

  it('shows the empty state when no organization has ever assigned a professional to this garden', () => {
    mockQuery({ isPending: false, isLoadingError: false, isError: false, data: { items: [] } });

    renderSection();

    expect(
      screen.getByText('No organization currently has a professional assigned to this garden.'),
    ).toBeTruthy();
  });

  it('renders nothing at all for a caller with no visibility into this garden (concealed garden.not_found)', () => {
    mockQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: {
        failure: {
          ok: false,
          kind: 'contract',
          code: 'garden.not_found',
          fallbackMessage: 'This garden could not be found.',
          correlationId: 'corr-1',
          retryable: false,
          details: [],
          status: 404,
        },
      },
      refetch: vi.fn(),
    });

    const { container } = renderSection();

    expect(container.firstChild).toBeNull();
  });

  it('shows the real failure state for a genuine, non-concealed error (e.g. a transport failure)', () => {
    mockQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: {
        failure: {
          ok: false,
          kind: 'transport',
          code: 'client.transport_failure',
          fallbackMessage: 'The API could not be reached.',
          correlationId: 'corr-1',
          retryable: true,
          details: [],
          status: null,
        },
      },
      refetch: vi.fn(),
    });

    renderSection();

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
