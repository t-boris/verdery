/**
 * The return to sign-in, for a session that cannot be recovered.
 *
 * A full document navigation rather than a router push: it discards the
 * in-memory query cache belonging to a session that no longer exists, and it
 * re-enters `proxy.ts`, which is where the routing rule for a missing session
 * actually lives. Duplicating that rule in the client would give two answers
 * to one question.
 *
 * Source: architecture/web-application-design.md, section
 * "7. Authentication Session"; `proxy.ts`.
 */

const SIGN_IN_PATH = '/auth/sign-in';

/**
 * Marks a return to sign-in caused by a session the API no longer accepts.
 *
 * Read by `proxy.ts`, which otherwise sends anyone holding a session cookie
 * away from the sign-in screen, and by the sign-in screen itself, which says
 * why the person is looking at it again.
 */
export const SESSION_EXPIRED_PARAMETER = 'sessionExpired';

/** The part of `Location` this needs, so a test can supply one without fighting jsdom. */
export type NavigableLocation = Pick<Location, 'pathname' | 'search' | 'hash' | 'assign'>;

/**
 * Sends the browser to sign-in, carrying where it was so the person returns
 * to the page they were on.
 *
 * Callers may fire this more than once — several failed requests can reach
 * the same conclusion at the same moment — so a page that is already the
 * sign-in screen is a no-op rather than a second assignment.
 */
export function redirectToSignIn(location?: NavigableLocation): void {
  const target = location ?? (typeof window === 'undefined' ? null : window.location);

  if (target === null) {
    return;
  }

  const { pathname, search, hash } = target;

  if (pathname === SIGN_IN_PATH) {
    return;
  }

  // Same-origin path only, read from this document's own location: never a
  // value from a response, which is what would make this an open redirect.
  const next = `${pathname}${search}${hash}`;
  const query = new URLSearchParams({ next, [SESSION_EXPIRED_PARAMETER]: '1' });

  target.assign(`${SIGN_IN_PATH}?${query.toString()}`);
}
