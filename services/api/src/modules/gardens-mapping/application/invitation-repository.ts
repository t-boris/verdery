import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Invitation } from '../domain/invitation.js';

/**
 * Persistence port for `collaboration.invitation` (P9A-API-01, completing
 * the P9A-DATA-01 schema). Lives beside `MembershipRepository` in this
 * module for the same "temporary consolidation" reason that file's own
 * header records — no dedicated Collaboration module exists yet, and
 * standing one up is a larger change than this work package's scope.
 */
export interface InvitationRepository {
  insert(invitation: Invitation): Promise<void>;

  /**
   * The single lookup `AcceptInvitation` runs, keyed on the token's own
   * hash — never on `id`, which the accepting caller does not have. `null`
   * covers both "no such token" and "malformed token", indistinguishably,
   * matching section 10's "cannot reveal whether an unrelated garden
   * exists".
   */
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;

  /** Scoped to `gardenId` so a caller cannot revoke (or even discover, via a distinguishable error) an invitation belonging to a garden they administer nothing on. */
  findByIdAndGarden(id: Uuid, gardenId: Uuid): Promise<Invitation | null>;

  /**
   * Every invitation ever issued for `gardenId`, newest first — every
   * state, not only `pending`, so an owner can see what happened to one
   * they no longer remember the id of. `ListGardenInvitations` gates this
   * behind `manageGarden`, not `viewGarden`: an intended email is the
   * enumeration surface `GardenMember` deliberately withholds.
   */
  listByGarden(gardenId: Uuid): Promise<readonly Invitation[]>;

  /**
   * Whether a PENDING invitation already exists for this (garden, email) —
   * the application-level mirror of `invitation_pending_intended_email_key`,
   * checked before the insert so the common case returns a clean conflict
   * instead of racing the unique index. The index is still the authority:
   * `CreateInvitation` also catches its violation for the genuine
   * concurrent case this check cannot see.
   */
  hasPendingForEmail(gardenId: Uuid, intendedEmail: string): Promise<boolean>;

  /** Persists every mutable field of `invitation` — state, and whichever of the acceptance/revocation columns that state implies. */
  update(invitation: Invitation): Promise<void>;

  /**
   * Bulk-transitions up to `limit` past-expiry `pending` rows to `expired`.
   * The sweep's whole job (`RunInvitationExpirySweep`) — see that file for
   * why acceptance ALSO self-heals a lapsed row rather than depending on
   * this ever having run first.
   */
  expireDuePending(now: Date, limit: number): Promise<number>;
}
