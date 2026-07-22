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
}
