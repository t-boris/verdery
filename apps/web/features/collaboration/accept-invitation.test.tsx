import type { GardenMember } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AcceptInvitation } from './accept-invitation';
import { useAcceptInvitation } from './queries';

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

vi.mock('./queries', () => ({
  useAcceptInvitation: vi.fn(),
}));

const mockedUseAcceptInvitation = vi.mocked(useAcceptInvitation);

const MEMBER: GardenMember = {
  id: 'member-1',
  gardenId: 'garden-1',
  profileId: 'profile-1',
  role: 'editor',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function renderPage() {
  return render(
    <LocalizationProvider locale="en">
      <AcceptInvitation />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams();
});

describe('AcceptInvitation — missing token', () => {
  it('shows a specific message and never calls the endpoint', () => {
    const mutate = vi.fn();
    mockedUseAcceptInvitation.mockReturnValue({
      mutate,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptInvitation>);

    renderPage();

    expect(screen.getByText('This link is missing its invitation token.')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('AcceptInvitation — success (already a member or freshly accepted are indistinguishable)', () => {
  it('shows the resulting role and a link to the garden', () => {
    searchParams = new URLSearchParams({ token: 'a'.repeat(32) });
    mockedUseAcceptInvitation.mockReturnValue({
      mutate: (_token: string, options: { onSuccess: (member: GardenMember) => void }) =>
        options.onSuccess(MEMBER),
      isError: false,
    } as unknown as ReturnType<typeof useAcceptInvitation>);

    renderPage();

    expect(screen.getByText('You now have Editor access to this garden.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the garden' }));
    expect(push).toHaveBeenCalledWith('/application/gardens/garden-1');
  });
});

describe('AcceptInvitation — unauthenticated caller', () => {
  it('redirects to sign-in with the full path, including the token, preserved', () => {
    const token = 'b'.repeat(32);
    searchParams = new URLSearchParams({ token });
    mockedUseAcceptInvitation.mockReturnValue({
      mutate: (
        _token: string,
        options: { onError: (error: { failure: { code: string } }) => void },
      ) => options.onError({ failure: { code: 'auth.unauthenticated' } }),
      isError: false,
    } as unknown as ReturnType<typeof useAcceptInvitation>);

    renderPage();

    const expectedNext = encodeURIComponent(`/invite/accept?token=${encodeURIComponent(token)}`);
    expect(push).toHaveBeenCalledWith(`/auth/sign-in?next=${expectedNext}`);
  });
});

describe('AcceptInvitation — a documented idempotency failure', () => {
  it('shows a distinct message for an expired invitation', () => {
    searchParams = new URLSearchParams({ token: 'c'.repeat(32) });
    const failure = {
      ok: false as const,
      kind: 'contract' as const,
      code: 'collaboration.invitation.expired',
      fallbackMessage: 'This invitation has expired.',
      correlationId: 'corr-1',
      retryable: false,
      details: [],
      status: 409,
    };
    mockedUseAcceptInvitation.mockReturnValue({
      mutate: (
        _token: string,
        options: { onError: (error: { failure: typeof failure }) => void },
      ) => options.onError({ failure }),
      isError: true,
      error: { failure },
    } as unknown as ReturnType<typeof useAcceptInvitation>);

    renderPage();

    expect(screen.getByText('This invitation has expired.')).toBeTruthy();
  });
});
