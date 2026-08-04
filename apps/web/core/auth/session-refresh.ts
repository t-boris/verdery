/**
 * Minting a new session cookie from the identity provider's own credentials.
 *
 * The session cookie the API accepts is short-lived by design, while the
 * Firebase refresh token in this browser outlives it. When the cookie expires
 * mid-visit, the person is still signed in — nothing about their identity has
 * changed — and sending them back to a sign-in screen would be asking them to
 * prove something the browser can already prove.
 *
 * Source: architecture/identity-and-authorization.md, sections
 * "5. Web Session Flow" and "9. Session Lifecycle".
 */

import { getFirebaseAuth } from './firebase-app';

/**
 * Exchanges a fresh Firebase ID token for a session cookie through
 * `exchange`, which reports whether the API accepted it.
 *
 * Returns `false` when this browser holds no Firebase user at all — the
 * honest answer that no credential exists to refresh from, which the caller
 * turns into a return to sign-in.
 *
 * `authStateReady()` is awaited first because the SDK restores a persisted
 * user asynchronously: reading `currentUser` on a freshly loaded page can see
 * `null` for a signed-in person, and treating that as "no credential" would
 * sign them out for opening a bookmark.
 */
export async function refreshSessionCookie(
  exchange: (idToken: string) => Promise<boolean>,
): Promise<boolean> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();

  const user = auth.currentUser;

  if (user === null) {
    return false;
  }

  let idToken: string;

  try {
    // `true` forces a refresh rather than returning the cached ID token: a
    // cached one can be as stale as the session cookie that just failed.
    idToken = await user.getIdToken(true);
  } catch {
    // A revoked or disabled account, or an offline browser. Both mean this
    // request cannot be recovered now.
    return false;
  }

  return exchange(idToken);
}
