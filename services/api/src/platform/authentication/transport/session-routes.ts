/**
 * Web session exchange.
 *
 * `secure` on both cookies is decided per request from `request.protocol`
 * (accurate under `trustProxy: true`, which reads Cloud Run's
 * `X-Forwarded-Proto`), not a fixed `true`: hard-coding it would silently
 * stop cookies from ever being set during plain-HTTP local development.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "5. Web Session Flow"; packages/api-contracts/openapi.yaml, tag `Authentication`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ProvisionProfile } from '../../../modules/identity-access/public.js';
import { isAccountUsable } from '../../../modules/identity-access/public.js';
import { ForbiddenError, ValidationError } from '../../errors/application-error.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfTokensMatch, generateCsrfToken } from '../csrf.js';
import { SESSION_COOKIE_NAME } from '../authentication-plugin.js';
import type { TokenVerifier } from '../token-verifier.js';

/** Firebase's own maximum session cookie lifetime. */
const SESSION_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface SessionRoutesDependencies {
  readonly tokenVerifier: TokenVerifier;
  readonly provisionProfile: ProvisionProfile;
}

function setSessionCookies(reply: FastifyReply, secure: boolean, sessionCookie: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
  });

  reply.setCookie(CSRF_COOKIE_NAME, generateCsrfToken(), {
    // Readable by the page's own JavaScript, so it can echo the value back
    // in the X-CSRF-Token header — the entire double-submit mechanism
    // depends on this cookie being script-readable, unlike the session
    // cookie itself.
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
  });
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/', secure, sameSite: 'strict' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/', secure, sameSite: 'strict' });
}

export function registerSessionRoutes(
  app: FastifyInstance,
  dependencies: SessionRoutesDependencies,
): void {
  app.post('/auth/session', async (request, reply) => {
    const body = request.body as { idToken?: unknown } | undefined;
    if (typeof body?.idToken !== 'string' || body.idToken.length === 0) {
      throw new ValidationError(SharedErrorCode.RequestInvalid, 'idToken is required.', {
        details: [{ code: 'request.invalid', pointer: '/idToken' }],
      });
    }

    // Verifies signature, expiry, and revocation before any cookie is ever issued.
    const credential = await dependencies.tokenVerifier.verifyIdToken(body.idToken);
    const profile = await dependencies.provisionProfile.execute(credential);

    if (!isAccountUsable(profile.accountState)) {
      throw new ForbiddenError(
        SharedErrorCode.Forbidden,
        'This account cannot currently use the application.',
      );
    }

    const sessionCookie = await dependencies.tokenVerifier.createSessionCookie(
      body.idToken,
      SESSION_COOKIE_MAX_AGE_MS,
    );

    setSessionCookies(reply, request.protocol === 'https', sessionCookie);
    return reply.status(204).send();
  });

  app.delete('/auth/session', async (request, reply) => {
    const sessionCookie = request.cookies[SESSION_COOKIE_NAME];

    // Not registered inside the authentication plugin's context — logout
    // must succeed even with an already-invalid session — so the CSRF check
    // that plugin applies to every other cookie-authenticated mutation is
    // repeated here explicitly. Only enforced when a session cookie is
    // actually present: a forged cross-site logout against a visitor with no
    // session cookie has nothing to protect.
    if (
      sessionCookie !== undefined &&
      !csrfTokensMatch(request.cookies[CSRF_COOKIE_NAME], request.headers[CSRF_HEADER_NAME])
    ) {
      throw new ForbiddenError(SharedErrorCode.Forbidden, 'Missing or invalid CSRF token.');
    }

    if (sessionCookie !== undefined) {
      // Best-effort: an already-invalid cookie must not stop logout from
      // clearing it. Revoking refresh tokens on a cookie we cannot verify
      // would need the Firebase UID this branch does not have — the client
      // simply signs out client-side in that case, which is already the
      // Firebase SDK's own behavior on an expired session.
      try {
        const credential = await dependencies.tokenVerifier.verifySessionCookie(sessionCookie);
        await dependencies.tokenVerifier.revokeRefreshTokens(credential.firebaseUid);
      } catch {
        // Already unusable; nothing further to revoke.
      }
    }

    clearSessionCookies(reply, request.protocol === 'https');
    return reply.status(204).send();
  });
}
