/**
 * Port for verifying Firebase credentials.
 *
 * Application and transport code depend on this interface, never on
 * `firebase-admin` directly, so the adapter stays swappable for tests and the
 * dependency stays confined to one file.
 *
 * Source: architecture/backend-modular-monolith.md, section "4. Source
 * Structure" (`platform/authentication`); architecture/identity-and-
 * authorization.md, sections "4. Native Authentication Flow", "5. Web Session
 * Flow", "14. Token and Session Revocation".
 */

import type { VerifiedCredential } from './verified-credential.js';

export interface TokenVerifier {
  /**
   * Verifies a native client's Firebase ID token, including current
   * revocation state.
   *
   * Throws `UnauthenticatedError` when the token is missing, malformed,
   * expired, or has been revoked.
   */
  verifyIdToken(idToken: string): Promise<VerifiedCredential>;

  /**
   * Verifies a web client's Firebase session cookie, including current
   * revocation state.
   *
   * Throws `UnauthenticatedError` under the same conditions as
   * {@link verifyIdToken}.
   */
  verifySessionCookie(sessionCookie: string): Promise<VerifiedCredential>;

  /**
   * Exchanges a freshly verified ID token for a session cookie with the given
   * lifetime, for the web sign-in flow.
   *
   * Source: architecture/identity-and-authorization.md, section "5. Web
   * Session Flow", steps 2-4.
   */
  createSessionCookie(idToken: string, expiresInMilliseconds: number): Promise<string>;

  /**
   * Revokes every refresh token issued to this Firebase user so far, forcing
   * re-authentication on every device at their next token refresh.
   *
   * Source: architecture/identity-and-authorization.md, section "14. Token
   * and Session Revocation".
   */
  revokeRefreshTokens(firebaseUid: string): Promise<void>;
}
