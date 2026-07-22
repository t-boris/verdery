/**
 * The outcome of successfully verifying a Firebase ID token or session cookie.
 *
 * Deliberately narrower than Firebase's own decoded token: only the claims the
 * rest of the service is allowed to depend on cross the platform boundary.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "4. Native Authentication Flow".
 */
export interface VerifiedCredential {
  readonly firebaseUid: string;
  readonly signInProvider: string;
  /**
   * The provider's own identifier for this user, from Firebase's
   * `firebase.identities` claim — distinct from `firebaseUid`, which is
   * Firebase's generated identifier, not the provider's native one. Falls
   * back to `firebaseUid` on the rare token that omits the claim (Firebase
   * does not document this as guaranteed present for every provider).
   */
  readonly providerUid: string;
  /** When the underlying sign-in occurred, per Firebase's `auth_time` claim. */
  readonly authenticatedAt: Date;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
}
