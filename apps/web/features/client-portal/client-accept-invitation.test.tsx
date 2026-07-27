import type { ClientAccessGrant } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientAcceptInvitation } from './client-accept-invitation';
import { useAcceptClientInvitation } from './queries';

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

vi.mock('./queries', () => ({
  useAcceptClientInvitation: vi.fn(),
}));

const mockedUseAcceptClientInvitation = vi.mocked(useAcceptClientInvitation);

const GRANT: ClientAccessGrant = {
  id: 'grant-1',
  engagementId: 'engagement-1',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
};

function renderPage() {
  return render(
    <LocalizationProvider locale="en">
      <ClientAcceptInvitation />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams();
});

describe('ClientAcceptInvitation — missing token', () => {
  it('shows a specific message and never calls the endpoint', () => {
    const mutate = vi.fn();
    mockedUseAcceptClientInvitation.mockReturnValue({
      mutate,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptClientInvitation>);

    renderPage();

    expect(screen.getByText('This invitation link is missing its token.')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('ClientAcceptInvitation — success', () => {
  it('shows the success message and a read-only button to the garden switcher, never a garden deep-link', () => {
    searchParams = new URLSearchParams({ token: 'a'.repeat(32) });
    mockedUseAcceptClientInvitation.mockReturnValue({
      mutate: (_token: string, options: { onSuccess: (grant: ClientAccessGrant) => void }) =>
        options.onSuccess(GRANT),
      isError: false,
    } as unknown as ReturnType<typeof useAcceptClientInvitation>);

    renderPage();

    expect(
      screen.getByText('You now have access to this garden’s published updates.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to my gardens' }));
    expect(push).toHaveBeenCalledWith('/client-portal');
  });
});

describe('ClientAcceptInvitation — unauthenticated caller', () => {
  it('redirects to sign-in with the full path, including the token, preserved', () => {
    const token = 'b'.repeat(32);
    searchParams = new URLSearchParams({ token });
    mockedUseAcceptClientInvitation.mockReturnValue({
      mutate: (
        _token: string,
        options: { onError: (error: { failure: { code: string } }) => void },
      ) => options.onError({ failure: { code: 'auth.unauthenticated' } }),
      isError: false,
    } as unknown as ReturnType<typeof useAcceptClientInvitation>);

    renderPage();

    const expectedNext = encodeURIComponent(
      `/invite/client-portal/accept?token=${encodeURIComponent(token)}`,
    );
    expect(push).toHaveBeenCalledWith(`/auth/sign-in?next=${expectedNext}`);
  });
});

describe('ClientAcceptInvitation — a documented failure', () => {
  it('shows a distinct message for an expired invitation', () => {
    searchParams = new URLSearchParams({ token: 'c'.repeat(32) });
    const failure = {
      ok: false as const,
      kind: 'contract' as const,
      code: 'client_access_grant.expired',
      fallbackMessage: 'This invitation has expired.',
      correlationId: 'corr-1',
      retryable: false,
      details: [],
      status: 409,
    };
    mockedUseAcceptClientInvitation.mockReturnValue({
      mutate: (
        _token: string,
        options: { onError: (error: { failure: typeof failure }) => void },
      ) => options.onError({ failure }),
      isError: true,
      error: { failure },
    } as unknown as ReturnType<typeof useAcceptClientInvitation>);

    renderPage();

    expect(screen.getByText('This invitation has expired.')).toBeTruthy();
  });
});
