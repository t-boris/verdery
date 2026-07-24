/**
 * `google-auth-library`-backed `CloudTasksInvocationVerifier`.
 *
 * Verifies a Google-signed OIDC ID token against Google's own public certs
 * (network call, cached by the library), checking signature, expiry, issuer,
 * and audience, then checks the token's own `email`/`email_verified` claims
 * against the one service account this deployment's Cloud Tasks queue is
 * configured to mint tokens for — the same "verify the specific expected
 * identity, not merely that some Google-signed token was presented" posture
 * `FirebaseTokenVerifier` already takes for end-user credentials.
 *
 * `google-auth-library` was already a devDependency in this package (used by
 * `scripts/verify-real-gcs-media-gateway.mjs`, a manual, non-CI check) before
 * this stage; it moves to a real runtime `dependencies` entry here because
 * this is the first time anything in `src/` uses it at request time.
 *
 * Source: architecture/asynchronous-processing.md, section "17. Security".
 */

import { OAuth2Client } from 'google-auth-library';
import { SharedErrorCode } from '@verdery/api-contracts';
import { UnauthenticatedError } from '../errors/application-error.js';
import type { CloudTasksInvocationVerifier } from './cloud-tasks-invocation-verifier.js';

const BEARER_PREFIX = 'Bearer ';

function unauthenticated(cause?: unknown): UnauthenticatedError {
  return new UnauthenticatedError(
    SharedErrorCode.Unauthenticated,
    'This endpoint requires a valid Cloud Tasks OIDC token.',
    cause === undefined ? {} : { cause },
  );
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length === 0 ? null : token;
}

export class GoogleOidcInvocationVerifier implements CloudTasksInvocationVerifier {
  private readonly client = new OAuth2Client();

  constructor(
    /** The exact callback URL Cloud Tasks was configured to call — the token's own `aud` claim must match it exactly. */
    private readonly audience: string,
    /** The one service-account email this deployment's Cloud Tasks queue mints tokens for. */
    private readonly allowedServiceAccountEmail: string,
  ) {}

  async verify(authorizationHeader: string | undefined): Promise<void> {
    const token = extractBearerToken(authorizationHeader);
    if (token === null) {
      throw unauthenticated();
    }

    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.audience });
      payload = ticket.getPayload();
    } catch (error) {
      throw unauthenticated(error);
    }

    if (
      payload === undefined ||
      payload.email !== this.allowedServiceAccountEmail ||
      payload.email_verified !== true
    ) {
      throw unauthenticated();
    }
  }
}
