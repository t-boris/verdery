import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenEngagementsSection } from './garden-engagements-section';
import { useGardenClientEngagementsForGarden } from './queries';

vi.mock('./queries', () => ({ useGardenClientEngagementsForGarden: vi.fn() }));

const mockedUseGardenEngagements = vi.mocked(useGardenClientEngagementsForGarden);

function mockQuery(fields: Record<string, unknown>): void {
  mockedUseGardenEngagements.mockReturnValue(
    fields as unknown as ReturnType<typeof useGardenClientEngagementsForGarden>,
  );
}

function renderSection() {
  return render(
    <LocalizationProvider locale="en">
      <GardenEngagementsSection gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

const ENGAGEMENT = {
  id: 'engagement-1',
  gardenId: 'garden-1',
  serviceOrganizationId: 'org-1',
  state: 'active' as const,
  stewardshipPolicy: 'residential' as const,
  clientNotificationsEnabled: true,
  createdByProfileId: 'profile-admin',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

describe('GardenEngagementsSection — manageGarden-gated, owner-only', () => {
  it('renders the list for the owner (who genuinely holds manageGarden)', () => {
    mockQuery({
      isPending: false,
      isLoadingError: false,
      isError: false,
      data: { items: [ENGAGEMENT] },
    });

    renderSection();

    expect(screen.getByText('Client engagements')).toBeTruthy();
    expect(screen.getByText('org-1')).toBeTruthy();
  });

  it('renders nothing at all for a non-owner ACTIVE member (real auth.forbidden, not a guessed client-side gate)', () => {
    mockQuery({
      isPending: false,
      isLoadingError: true,
      isError: true,
      data: undefined,
      error: {
        failure: {
          ok: false,
          kind: 'contract',
          code: 'auth.forbidden',
          fallbackMessage: 'This account is not allowed to perform that action.',
          correlationId: 'corr-1',
          retryable: false,
          details: [],
          status: 403,
        },
      },
      refetch: vi.fn(),
    });

    const { container } = renderSection();

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing at all for a total stranger (concealed garden.not_found)', () => {
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

  it('shows the real failure state for a genuine, non-concealed error', () => {
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

  it('shows the empty state once loaded for the owner with no engagement created yet', () => {
    mockQuery({ isPending: false, isLoadingError: false, isError: false, data: { items: [] } });

    renderSection();

    expect(
      screen.getByText('No client engagement has been created for this garden yet.'),
    ).toBeTruthy();
  });
});
