/**
 * Unit coverage for `GoogleOidcInvocationVerifier`'s own guard clauses —
 * the checks that run BEFORE any network call to Google's certificate
 * endpoint. Verifying an actually-signed OIDC token needs a real Google-
 * minted token and live network access to Google's own signon-certs
 * endpoint, which this suite deliberately does not attempt: mirrors
 * `services/api/src/platform/tasks/google-oidc-invocation-verifier.ts`'s own
 * established precedent of having no unit test for the live-token path
 * (see `services/api/tests/http/media-processing-callback-route.test.ts`'s
 * own header comment for that precedent's exact wording), which this
 * package's own duplicated verifier inherits unchanged.
 *
 * What IS meaningfully, deterministically testable without live infra: a
 * missing or malformed Authorization header must be rejected before
 * `verifyIdToken` is ever reached — a real security property (a caller that
 * forgets to attach a bearer token, or attaches the wrong scheme, must never
 * be treated as authenticated by omission).
 */

import { describe, expect, it } from 'vitest';
import {
  GoogleOidcInvocationVerifier,
  InvocationAuthenticationError,
} from './oidc-invocation-verifier.js';

const AUDIENCE = 'https://verdery-workers-dev.example.run.app/internal/media-validation-jobs';
const ALLOWED_SERVICE_ACCOUNT = 'verdery-dev-tasks-invoker@example.iam.gserviceaccount.com';

function verifier(): GoogleOidcInvocationVerifier {
  return new GoogleOidcInvocationVerifier(AUDIENCE, ALLOWED_SERVICE_ACCOUNT);
}

describe('GoogleOidcInvocationVerifier', () => {
  it('rejects an absent Authorization header', async () => {
    await expect(verifier().verify(undefined)).rejects.toBeInstanceOf(
      InvocationAuthenticationError,
    );
  });

  it('rejects a header using a non-Bearer scheme', async () => {
    await expect(verifier().verify('Basic dXNlcjpwYXNz')).rejects.toBeInstanceOf(
      InvocationAuthenticationError,
    );
  });

  it('rejects an empty Bearer token', async () => {
    await expect(verifier().verify('Bearer    ')).rejects.toBeInstanceOf(
      InvocationAuthenticationError,
    );
  });

  it('rejects the literal string "Bearer" with nothing following it', async () => {
    await expect(verifier().verify('Bearer')).rejects.toBeInstanceOf(InvocationAuthenticationError);
  });
});
