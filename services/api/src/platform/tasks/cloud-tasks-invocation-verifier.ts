/**
 * Port for verifying that an inbound request genuinely came from this
 * service's own Cloud Tasks queue, not an arbitrary caller who found the
 * callback URL.
 *
 * Mirrors `platform/authentication/token-verifier.ts` and `platform/
 * app-check/app-check-verifier.ts`'s own port-plus-adapter-plus-fake shape:
 * application/transport code depends on this interface, never on
 * `google-auth-library` directly.
 *
 * Cloud Tasks (and Cloud Scheduler, and every other private Google-managed
 * caller in this architecture) authenticates itself with a Google-signed
 * OIDC ID token minted for a specific service account and audience —
 * architecture/asynchronous-processing.md section "17. Security": "Cloud
 * Tasks and Pub/Sub invoke private handlers with IAM service identities."
 * Unlike `AppCheckVerifier` (monitor-only, classifies and never throws), a
 * failed verification here is a hard authentication failure: an
 * unauthenticated caller must not be able to trigger a media-processing
 * result recording.
 *
 * Source: architecture/networking.md ("Internal worker handlers require
 * IAM authentication and are not internet-public.");
 * architecture/media-storage-and-processing.md, section "18. Security".
 */

export interface CloudTasksInvocationVerifier {
  /**
   * Verifies the callback request's `Authorization` header.
   *
   * @throws UnauthenticatedError when the header is missing, malformed, or
   * the token does not verify as a Google-signed OIDC token for the
   * expected audience and service account.
   */
  verify(authorizationHeader: string | undefined): Promise<void>;
}
