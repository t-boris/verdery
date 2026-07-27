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

  /**
   * The caller's own ACTIVE grant on this exact engagement, or `null` —
   * covers "no grant at all", "grant still pending", "grant expired", and
   * "grant revoked" identically (P9C-API-01). This is the ONE read the
   * client portal's own authorization resolver
   * (`ClientPortalAuthorization.requireActiveGardenAccess`) performs before
   * trusting a caller-supplied `clientGardenId` at all — never a lookup by
   * `engagementId` alone, matching collaboration-and-client-sharing.md
   * section 13's own sentence: "authorization always starts from the
   * current client profile and active access grant."
   */
  findActiveForProfileAndEngagement(
    clientProfileId: Uuid,
    engagementId: Uuid,
  ): Promise<ClientAccessGrant | null>;

  /**
   * Every ACTIVE grant this client profile currently holds, across every
   * engagement, newest-granted first (P9C-API-01). The entire authority
   * behind `ListClientGardens`: that operation takes no path parameter
   * naming an engagement, garden, or organization, so this is the one query
   * that turns "which gardens can this client see" into a real answer
   * instead of a client-supplied claim.
   */
  listActiveForProfile(clientProfileId: Uuid): Promise<readonly ClientAccessGrant[]>;
}
