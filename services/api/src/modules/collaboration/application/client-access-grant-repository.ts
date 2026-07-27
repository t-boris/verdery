import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientAccessGrant } from '../domain/client-access-grant.js';

/**
 * Persistence port for `collaboration.client_access_grant` (P9C-INVITE-01,
 * completing the P9B-DATA-01 skeleton). Lives beside
 * `ClientEngagementRepository`/`PublisherGrantRepository` in this module,
 * the same home their own migrations already put the table in.
 */
export interface ClientAccessGrantRepository {
  insert(grant: ClientAccessGrant): Promise<void>;

  /**
   * The single lookup `AcceptClientInvitation` runs, keyed on the token's
   * own hash — never on `id`, which the accepting caller does not have.
   * `null` covers both "no such token" and "malformed token",
   * indistinguishably, matching the operational invitation's own posture.
   */
  findByTokenHash(tokenHash: string): Promise<ClientAccessGrant | null>;

  /** Scoped to `engagementId` so a caller cannot revoke (or discover, via a distinguishable error) a grant belonging to an engagement they do not administer. */
  findByIdAndEngagement(id: Uuid, engagementId: Uuid): Promise<ClientAccessGrant | null>;

  /** Row-locks one grant by id and re-reads it — the same "decide under lock, not from a stale snapshot" guard `PublisherGrantRepository.lockById` provides, run immediately before `RevokeClientInvitation` decides anything. */
  lockById(id: Uuid): Promise<ClientAccessGrant | null>;

  /**
   * Whether an OUTSTANDING (`pending` OR `active`) grant already exists for
   * this (engagement, email) — the application-level pre-check
   * `CreateClientInvitation` runs BEFORE sending any email, so a caller
   * never receives an invitation to an address that already has one
   * outstanding. Wider than the operational invitation's own
   * `hasPendingForEmail` (which checks `pending` alone) deliberately:
   * re-inviting an email that already holds ACTIVE access to this same
   * engagement is refused the identical way, not silently permitted to
   * accumulate a second, redundant grant row. The database's own
   * `client_access_grant_pending_email_key` (pending only) remains the
   * authoritative second layer for the genuine concurrent race this
   * pre-check cannot see.
   */
  hasOutstandingGrantForEmail(engagementId: Uuid, invitedEmail: string): Promise<boolean>;

  /** Persists every mutable field of `grant` — state, and whichever of `clientProfileId`/`grantedAt`/`revokedAt` that state implies. */
  update(grant: ClientAccessGrant): Promise<void>;

  /** Every grant this engagement has ever issued, in any state, newest first. */
  listForEngagement(engagementId: Uuid): Promise<readonly ClientAccessGrant[]>;
}
