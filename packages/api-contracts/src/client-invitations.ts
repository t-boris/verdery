/**
 * The client-invitation/access-grant domain's contract surface
 * (P9C-INVITE-01): email-bound, expiring client invitations and the
 * resulting `client_access_grant` — split out of `index.ts` for the same
 * 600-line source-file rule `organizations.ts`/`publications.ts` document
 * for themselves; `index.ts` re-exports everything here unchanged.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/** The client-invitation/access-grant schemas (P9C-INVITE-01). */
export type ClientAccessGrantState = Schemas['ClientAccessGrantState'];
export type ClientAccessGrant = Schemas['ClientAccessGrant'];
export type ClientAccessGrantListResult = Schemas['ClientAccessGrantListResult'];
export type CreateClientInvitationRequest = Schemas['CreateClientInvitationRequest'];
export type AcceptClientInvitationRequest = Schemas['AcceptClientInvitationRequest'];

/**
 * Error codes the client-invitation/access-grant endpoints raise
 * (P9C-INVITE-01).
 *
 * Non-visibility of an engagement is concealed as `notFound` by
 * `engagementNotFoundError()` (reused, unchanged, from the `Organizations`
 * tag's own `ClientEngagementErrorCode.NotFound`) before any of these codes
 * are ever reached — these are this resource's OWN codes, reached only once
 * an engagement is already known to the caller. `NotFound` here specifically
 * means no grant exists at the given id/token, mirroring
 * `CollaborationErrorCode.InvitationNotFound`'s identical "existence is not a
 * concealment device once the caller already holds the token" posture.
 */
export const ClientAccessGrantErrorCode = {
  /** No client access grant exists at this id (on this engagement) or at this token. */
  NotFound: 'client_access_grant.not_found',
  /** An outstanding (pending or active) grant already exists for this email on this engagement. */
  AlreadyOutstanding: 'client_access_grant.already_outstanding',
  /** The grant's `expiresAt` has passed. Evaluated at acceptance time regardless of whether a future sweep has run. */
  Expired: 'client_access_grant.expired',
  /** The grant was revoked before it was accepted, or after. */
  Revoked: 'client_access_grant.revoked',
  /** The grant was already accepted — by this caller (replayed outside the idempotency window) or another. */
  AlreadyAccepted: 'client_access_grant.already_accepted',
  /** The grant is bound to an email address that does not match the accepting caller's own verified email. */
  EmailMismatch: 'client_access_grant.email_mismatch',
  /** `createClientInvitation` was attempted against an engagement that is `ended` or `revoked`. */
  EngagementNotInvitable: 'client_access_grant.engagement_not_invitable',
  /** `acceptClientInvitation` was attempted while the grant's own engagement is not currently `active`. */
  EngagementNotActive: 'client_access_grant.engagement_not_active',
  /** `revokeClientInvitation` was asked to revoke a grant already in the OTHER terminal state (`expired`) — no edge reaches `revoked` from there. */
  InvalidTransition: 'client_access_grant.invalid_transition',
} as const;

export type ClientAccessGrantErrorCode =
  (typeof ClientAccessGrantErrorCode)[keyof typeof ClientAccessGrantErrorCode];
