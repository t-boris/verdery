/**
 * Firebase Admin SDK adapter for {@link TokenVerifier}.
 *
 * The only file in the service allowed to import `firebase-admin`. Runs under
 * the runtime service account's own Google identity — no downloaded service
 * account key — matching `roles/firebaseauth.admin` granted in
 * infrastructure/gcloud/scripts/05-service-accounts.sh.
 */

import type { App } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
import { SharedErrorCode } from '@verdery/api-contracts';
import { UnauthenticatedError } from '../errors/application-error.js';
import type { TokenVerifier } from './token-verifier.js';
import type { VerifiedCredential } from './verified-credential.js';

/**
 * Firebase error codes this adapter distinguishes for the detail code it
 * attaches to `UnauthenticatedError`. Every other Firebase Admin SDK error
 * (malformed token, unknown project, network failure) collapses to
 * `auth.token_invalid` — the client cannot act differently on those anyway.
 */
const REVOKED_CODES = new Set([
  'auth/id-token-revoked',
  'auth/session-cookie-revoked',
  'auth/user-disabled',
]);
const EXPIRED_CODES = new Set(['auth/id-token-expired', 'auth/session-cookie-expired']);

function detailCodeFor(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;

  if (typeof code === 'string' && REVOKED_CODES.has(code)) {
    return 'auth.token_revoked';
  }
  if (typeof code === 'string' && EXPIRED_CODES.has(code)) {
    return 'auth.token_expired';
  }
  return 'auth.token_invalid';
}

function toUnauthenticatedError(error: unknown): UnauthenticatedError {
  return new UnauthenticatedError(
    SharedErrorCode.Unauthenticated,
    'The supplied credential could not be verified.',
    { details: [{ code: detailCodeFor(error) }], cause: error },
  );
}

function toVerifiedCredential(decoded: {
  uid: string;
  firebase: { sign_in_provider: string; identities?: Record<string, string[]> };
  auth_time: number;
  email?: string;
  email_verified?: boolean;
}): VerifiedCredential {
  const providerUid =
    decoded.firebase.identities?.[decoded.firebase.sign_in_provider]?.[0] ?? decoded.uid;

  return {
    firebaseUid: decoded.uid,
    signInProvider: decoded.firebase.sign_in_provider,
    providerUid,
    // Firebase expresses auth_time in whole seconds since the epoch.
    authenticatedAt: new Date(decoded.auth_time * 1000),
    email: decoded.email,
    emailVerified: decoded.email_verified ?? false,
  };
}

export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly auth: Auth;

  constructor(app: App) {
    this.auth = getAuth(app);
  }

  async verifyIdToken(idToken: string): Promise<VerifiedCredential> {
    try {
      const decoded = await this.auth.verifyIdToken(idToken, /* checkRevoked */ true);
      return toVerifiedCredential(decoded);
    } catch (error) {
      throw toUnauthenticatedError(error);
    }
  }

  async verifySessionCookie(sessionCookie: string): Promise<VerifiedCredential> {
    try {
      const decoded = await this.auth.verifySessionCookie(sessionCookie, /* checkRevoked */ true);
      return toVerifiedCredential(decoded);
    } catch (error) {
      throw toUnauthenticatedError(error);
    }
  }

  async createSessionCookie(idToken: string, expiresInMilliseconds: number): Promise<string> {
    try {
      return await this.auth.createSessionCookie(idToken, { expiresIn: expiresInMilliseconds });
    } catch (error) {
      throw toUnauthenticatedError(error);
    }
  }

  async revokeRefreshTokens(firebaseUid: string): Promise<void> {
    await this.auth.revokeRefreshTokens(firebaseUid);
  }
}
