/**
 * The authenticated actor for one request.
 *
 * Constructed once, after credential verification and profile provisioning,
 * and passed explicitly to every use case that needs it. Nothing downstream
 * re-derives identity from a raw token.
 *
 * Source: architecture/api-design.md, section "9. Actor Context".
 */

import type { Uuid } from '../identifiers/uuid.js';

export type AuthenticationCredentialKind = 'firebaseIdToken' | 'sessionCookie';

export interface ActorContext {
  readonly profileId: Uuid;
  readonly firebaseUid: string;
  /** When the credential's underlying sign-in occurred, per Firebase's `auth_time` claim. */
  readonly authenticatedAt: Date;
  readonly signInProvider: string;
  readonly credentialKind: AuthenticationCredentialKind;
  readonly requestId: string;
  /**
   * The credential's own email claim, carried through from
   * `VerifiedCredential` (P9A-API-01). `undefined` exactly when Firebase's
   * token carried none — some providers and anonymous-style sign-ins never
   * populate it. Present but `emailVerified: false` for an unconfirmed
   * email/password sign-up.
   *
   * Added for invitation email binding (identity-and-authorization.md
   * section 10: "Authenticated email mismatch where email binding is
   * required"). Nothing before this needed the caller's email past
   * `ProvisionProfile`, which deliberately never stores it on `Profile`
   * (identity-access/domain/profile.ts: "Firebase remains the sole
   * authority for credentials ... this entity never carries them") — this
   * field does not change that; it is the verified claim for THIS request
   * only, never persisted.
   */
  readonly email: string | undefined;
  /** Whether Firebase itself considers `email` confirmed. A binding check must never treat an unverified email as proof of identity. */
  readonly emailVerified: boolean;
}
