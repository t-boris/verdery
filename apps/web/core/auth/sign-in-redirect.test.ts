import { describe, expect, it, vi } from 'vitest';

import {
  redirectToSignIn,
  SESSION_EXPIRED_PARAMETER,
  type NavigableLocation,
} from './sign-in-redirect';

function locationAt(pathname: string, search = '', hash = ''): NavigableLocation {
  return { pathname, search, hash, assign: vi.fn<(url: string | URL) => void>() };
}

describe('redirectToSignIn', () => {
  it('carries the current path as the return destination', () => {
    const location = locationAt('/application/gardens');

    redirectToSignIn(location);

    const target = new URL(String(vi.mocked(location.assign).mock.calls[0]?.[0]), 'https://x.test');
    expect(target.pathname).toBe('/auth/sign-in');
    expect(target.searchParams.get('next')).toBe('/application/gardens');
  });

  // Without this marker `proxy.ts` sends anyone holding a session cookie from
  // sign-in back to the gardens list — which is where the failing requests
  // are, so the two rules would loop.
  it('marks the return as caused by an expired session', () => {
    const location = locationAt('/application/gardens');

    redirectToSignIn(location);

    const target = new URL(String(vi.mocked(location.assign).mock.calls[0]?.[0]), 'https://x.test');
    expect(target.searchParams.get(SESSION_EXPIRED_PARAMETER)).toBe('1');
  });

  it('keeps query and fragment, so a filtered list returns filtered', () => {
    const location = locationAt('/application/gardens/g1/plants', '?status=alive', '#top');

    redirectToSignIn(location);

    const target = new URL(String(vi.mocked(location.assign).mock.calls[0]?.[0]), 'https://x.test');
    expect(target.searchParams.get('next')).toBe('/application/gardens/g1/plants?status=alive#top');
  });

  it('does nothing when the sign-in screen is already showing', () => {
    const location = locationAt('/auth/sign-in', '?next=%2Fapplication%2Fgardens');

    redirectToSignIn(location);

    expect(location.assign).not.toHaveBeenCalled();
  });
});
