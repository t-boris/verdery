/**
 * Populates `request.actorContext` for every route registered inside this
 * plugin's encapsulation context.
 *
 * Deliberately not global: registered only alongside the routes that need
 * it (gardens, not `/health/*`, which the contract marks `security: []`).
 * Fastify's plugin encapsulation keeps a hook registered here from ever
 * running for a sibling registration, so no separate "skip this path" list
 * is needed.
 *
 * Also where "account state" — the second step of authorization evaluation —
 * is enforced, once, for every Phase 2 endpoint uniformly: every route this
 * phase ships requires an active account, so checking it here instead of
 * inside each individual use case avoids repeating the same check six times
 * for no behavioral difference. A future endpoint that must remain reachable
 * for a non-active account (account recovery, for example) is not something
 * Phase 2 has, and can opt out of this plugin's context when it exists.
 *
 * Source: architecture/api-design.md, section "9. Actor Context";
 * architecture/identity-and-authorization.md, sections
 * "4. Native Authentication Flow", "5. Web Session Flow",
 * "9. Authorization Evaluation".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import { isAccountUsable, type ProvisionProfile } from '../../modules/identity-access/public.js';
import type {
  ActorContext,
  AuthenticationCredentialKind,
} from '../../shared/actor/actor-context.js';
import { ForbiddenError, UnauthenticatedError } from '../errors/application-error.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfTokensMatch, requiresCsrfCheck } from './csrf.js';
import type { TokenVerifier } from './token-verifier.js';
import type { VerifiedCredential } from './verified-credential.js';

export const SESSION_COOKIE_NAME = '__session';

declare module 'fastify' {
  interface FastifyRequest {
    actorContext: ActorContext;
  }
}

export interface AuthenticationPluginDependencies {
  readonly tokenVerifier: TokenVerifier;
  readonly provisionProfile: ProvisionProfile;
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined || !authorizationHeader.startsWith('Bearer ')) {
    return null;
  }
  return authorizationHeader.slice('Bearer '.length).trim();
}

export function registerAuthentication(
  app: FastifyInstance,
  dependencies: AuthenticationPluginDependencies,
): void {
  // No default value: every request that reaches a handler inside this
  // plugin's context has already passed the onRequest hook below, which
  // always sets a real ActorContext or throws first.
  app.decorateRequest('actorContext');

  app.addHook('onRequest', async (request) => {
    const bearerToken = extractBearerToken(request.headers.authorization);
    const sessionCookie = request.cookies[SESSION_COOKIE_NAME];

    let credential: VerifiedCredential;
    let credentialKind: AuthenticationCredentialKind;

    if (bearerToken !== null) {
      credential = await dependencies.tokenVerifier.verifyIdToken(bearerToken);
      credentialKind = 'firebaseIdToken';
    } else if (sessionCookie !== undefined) {
      credential = await dependencies.tokenVerifier.verifySessionCookie(sessionCookie);
      credentialKind = 'sessionCookie';

      if (
        requiresCsrfCheck(request.method) &&
        !csrfTokensMatch(request.cookies[CSRF_COOKIE_NAME], request.headers[CSRF_HEADER_NAME])
      ) {
        throw new ForbiddenError(SharedErrorCode.Forbidden, 'Missing or invalid CSRF token.');
      }
    } else {
      throw new UnauthenticatedError(
        SharedErrorCode.Unauthenticated,
        'This request requires a Firebase ID token or an active session.',
      );
    }

    const profile = await dependencies.provisionProfile.execute(credential);

    if (!isAccountUsable(profile.accountState)) {
      throw new ForbiddenError(
        SharedErrorCode.Forbidden,
        'This account cannot currently use the application.',
      );
    }

    request.actorContext = {
      profileId: profile.id,
      firebaseUid: credential.firebaseUid,
      authenticatedAt: credential.authenticatedAt,
      signInProvider: credential.signInProvider,
      credentialKind,
      requestId: request.id,
    };
  });
}
