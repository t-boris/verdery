import type * as CoreApiPublic from '@/core/api/public';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { EmailLinkCompletion } from './email-link-completion';

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

const completeEmailSignIn = vi.fn<(email: string, link: string) => Promise<string>>();
const isSignInWithEmailLink = vi.fn<(link: string) => boolean>();
const pendingEmailForSignIn = vi.fn<() => string | null>();

vi.mock('@/core/auth/public', () => ({
  completeEmailSignIn: (email: string, link: string) => completeEmailSignIn(email, link),
  isSignInWithEmailLink: (link: string) => isSignInWithEmailLink(link),
  pendingEmailForSignIn: () => pendingEmailForSignIn(),
}));

const createSession = vi.fn();

vi.mock('@/core/api/public', async () => {
  const actual = await vi.importActual<typeof CoreApiPublic>('@/core/api/public');
  return {
    ...actual,
    createBrowserApiClient: () => ({}),
    createSessionGateway: () => ({ createSession }),
  };
});

function renderPage() {
  return render(
    <LocalizationProvider locale="en">
      <EmailLinkCompletion />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  searchParams = new URLSearchParams();
});

describe('EmailLinkCompletion — post-sign-in redirect', () => {
  it('redirects to the next query param when completion succeeds, rather than always to the gardens list', async () => {
    searchParams = new URLSearchParams({ next: '/invite/client-portal/accept?token=abc123' });
    isSignInWithEmailLink.mockReturnValue(true);
    pendingEmailForSignIn.mockReturnValue('client@example.test');
    completeEmailSignIn.mockResolvedValue('id-token');
    createSession.mockResolvedValue({ ok: true, value: {} });

    renderPage();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/invite/client-portal/accept?token=abc123');
    });
  });

  it('falls back to the gardens list when no next param is present', async () => {
    isSignInWithEmailLink.mockReturnValue(true);
    pendingEmailForSignIn.mockReturnValue('someone@example.test');
    completeEmailSignIn.mockResolvedValue('id-token');
    createSession.mockResolvedValue({ ok: true, value: {} });

    renderPage();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/application/gardens');
    });
  });

  it('never redirects to an absolute or protocol-relative next value, even if one arrives in the query string', async () => {
    searchParams = new URLSearchParams({ next: '//evil.example.test' });
    isSignInWithEmailLink.mockReturnValue(true);
    pendingEmailForSignIn.mockReturnValue('someone@example.test');
    completeEmailSignIn.mockResolvedValue('id-token');
    createSession.mockResolvedValue({ ok: true, value: {} });

    renderPage();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/application/gardens');
    });
  });

  it('shows the invalid-link message and never redirects when the URL is not a real sign-in link', () => {
    isSignInWithEmailLink.mockReturnValue(false);

    renderPage();

    expect(
      screen.getByText('This sign-in link is invalid or has expired. Request a new one.'),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
