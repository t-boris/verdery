/**
 * Port for deleting the identity provider's own user record (P8-DELETE-01) —
 * architecture/data-export-and-deletion.md section 11: "Deletes Firebase
 * Authentication identity after application preconditions."
 *
 * A separate port from {@link TokenVerifier} deliberately. That interface is
 * the request pipeline's read-only view of a credential, injected into the
 * authentication plugin and reachable from every authenticated route; this
 * one destroys an account and is injected into exactly one place, the account
 * purge. Folding `deleteUser` into `TokenVerifier` would put an irreversible
 * capability within reach of every route that only needs to verify a token.
 *
 * "After application preconditions" is the ordering the purge implements:
 * this is called only once the account's own data has been purged, so a crash
 * mid-purge never leaves an application account whose identity is already
 * gone and which the user therefore could not sign back in to recover.
 */

export interface IdentityProviderAccountGateway {
  /**
   * Deletes the provider's user record for `providerUid`.
   *
   * MUST be idempotent: an already-absent user is success, not an error. The
   * purge is resumable, so this can legitimately be called twice for the same
   * uid — once by the attempt that crashed after the provider call but before
   * recording it, once by the retry.
   */
  deleteUser(providerUid: string): Promise<void>;
}
