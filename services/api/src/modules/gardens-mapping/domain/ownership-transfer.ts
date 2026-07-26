/**
 * The ownership-transfer aggregate, and the recent-authentication policy
 * shared by every owner-administration command (P9A-OWNER-01): promotion to
 * owner (matrix H8), demotion of an owner (H9), and ownership transfer
 * itself (H13).
 *
 * WHY A TRANSFER IS NOT JUST ANOTHER ROLE CHANGE — the exact line the
 * P9A-DATA-01 migration draws: "a transition where the giver stays owner is
 * a co-owner PROMOTION ... not a transfer." Promotion (giver stays owner,
 * recipient gains it) and demotion (an owner loses it, nobody new gains it)
 * are both single-membership role changes, recorded like any other role
 * change through `collaboration.membership_period` — see `promote-to-owner
 * .ts`/`demote-owner.ts`, which touch this file only for the recent-auth
 * policy below, never for `OwnershipTransfer` itself. A TRANSFER is the one
 * case where the outgoing owner's OWN role changes together with, and only
 * because of, the incoming owner's — a single event with two sides, which is
 * exactly what this aggregate exists to record as one row rather than two
 * unrelated role changes no query could reassemble later.
 *
 * CONFIRMATION POLICY — the judgment call the migration's own comment
 * deliberately left open ("a policy needing no acceptance from the recipient
 * simply inserts and completes in one transaction, and a policy that adds
 * recipient acceptance later needs no schema change"). This codebase's FIRST
 * reading of section 11 was NO-ACCEPTANCE — the initiating owner's own
 * recently-authenticated request treated as sufficient, by analogy with
 * promotion's one-sided "becomes owner" outcome. THE OWNER REVIEWED THAT
 * READING AND OVERRODE IT: a transfer now REQUIRES the recipient's explicit
 * acceptance before it takes effect. `TransferOwnership` inserts the row as
 * `pending` and stops; `AcceptOwnershipTransfer` is what moves it to
 * `completed` and only then closes/reopens both sides' membership periods.
 *
 * Why the analogy to promotion does not carry, on reflection: promotion adds
 * a co-owner without removing anyone else's ownership — the worst case of a
 * mistaken promote is an extra owner, reversible by an ordinary demote a
 * moment later. A transfer is not additive. It is a UNILATERAL HANDOVER: the
 * initiator's OWN `administerOwnership` is gone the instant it takes effect,
 * and full ownership carries deletion, export, and membership-administration
 * rights the recipient did not ask for. Under the no-acceptance reading, one
 * mistaken click by the initiator (wrong profile picked from a list, a
 * misread name) simultaneously hands a stranger those rights AND strips the
 * initiator of them, with no way back except asking the new owner to
 * voluntarily hand the garden back — a request that owner has no obligation
 * to honor. That asymmetry (irreversible-by-the-mistaken-party,
 * reversible-only-by-the-recipient's-goodwill) is a materially different risk
 * shape from promotion's, and is why the two commands may reach different
 * confirmation policies even though both end in "becomes owner". See
 * `transfer-ownership.ts`'s and `accept-ownership-transfer.ts`'s own headers
 * for exactly how the `pending` -> `completed` transition now works and who
 * drives it.
 *
 * `fromResultingRole` is deliberately narrower here than the column's own
 * vocabulary (`editor | viewer | removed`): this command always names an
 * explicit successor role, never leaves the outgoing owner with no
 * membership at all. "Transfer and leave" is a real outcome the schema
 * anticipates but no document in scope for P9A-OWNER-01 asks this command to
 * offer — an owner who wants to leave entirely still has `RemoveMember`
 * (self-removal) available immediately afterward.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "11. Ownership Transfer"; architecture/collaboration-and-client-sharing.md,
 * section "5. Operational Invitation and Co-Ownership";
 * migrations/1786500000000_collaboration-operations-and-attribution.sql.
 */

import { CollaborationErrorCode } from '@verdery/api-contracts';
import { ForbiddenError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** The role vocabulary `TransferOwnership` may assign the outgoing owner — see this file's header for why `removed` is out of scope here even though the column allows it. */
export type OwnershipTransferResultingRole = 'editor' | 'viewer';

export type OwnershipTransferState = 'pending' | 'completed' | 'cancelled';

export interface OwnershipTransfer {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly fromProfileId: Uuid;
  readonly toProfileId: Uuid;
  readonly fromResultingRole: OwnershipTransferResultingRole;
  readonly state: OwnershipTransferState;
  /** The recent-authentication instant that satisfied section 11's sensitive-action precondition — stored so "recent auth was required" is a fact of the record, not merely a claim. */
  readonly authenticatedAt: Date;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
}

/**
 * How recent the acting owner's underlying sign-in must be for ANY owner-
 * administration action (promote, demote, transfer) — matrix rows H8, H9,
 * H13 all name "recent auth ≤ 30 m". A domain-local constant, not a reuse of
 * `shared/deletion/deletion-policy.ts`'s identical-valued
 * `DELETION_RECENT_AUTHENTICATION_MAX_AGE_MS`: this codebase's own
 * established posture (`exports/domain/export-request.ts`'s
 * `RECENT_AUTHENTICATION_MAX_AGE_MS`, independently declared and reasoned
 * despite matching deletion's number exactly) is that each sensitive-action
 * family gets its own named constant and its own error code, even where the
 * chosen window coincides. Deletion's constant is shared across TWO modules
 * for a real reason (one recovery window, one gate, stated once) that does
 * not apply here — owner administration is entirely a `gardens-mapping`
 * concern.
 */
export const OWNERSHIP_ADMINISTRATION_RECENT_AUTHENTICATION_MAX_AGE_MS = 30 * 60 * 1000;

/** Throws unless the acting owner's session `auth_time` is recent enough — never a client-supplied instant. */
export function assertRecentAuthenticationForOwnershipAdministration(
  sessionAuthenticatedAt: Date,
  now: Date,
): void {
  if (
    now.getTime() - sessionAuthenticatedAt.getTime() >
    OWNERSHIP_ADMINISTRATION_RECENT_AUTHENTICATION_MAX_AGE_MS
  ) {
    throw new ForbiddenError(
      CollaborationErrorCode.RecentAuthenticationRequired,
      'Owner administration requires a recent sign-in. Sign in again and retry.',
    );
  }
}

/**
 * The narrow actor shape every owner-administration command needs: who is
 * acting, and when their sign-in actually happened — structurally identical
 * to `shared/deletion/deletion-policy.ts`'s `DeletionActor`, so a transport
 * layer passes `request.actorContext` unchanged here too.
 */
export interface OwnershipAdministrationActor {
  readonly profileId: Uuid;
  readonly authenticatedAt: Date;
}

export function beginOwnershipTransfer(input: {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly fromProfileId: Uuid;
  readonly toProfileId: Uuid;
  readonly fromResultingRole: OwnershipTransferResultingRole;
  readonly authenticatedAt: Date;
  readonly now: Date;
}): OwnershipTransfer {
  return {
    id: input.id,
    gardenId: input.gardenId,
    fromProfileId: input.fromProfileId,
    toProfileId: input.toProfileId,
    fromResultingRole: input.fromResultingRole,
    state: 'pending',
    authenticatedAt: input.authenticatedAt,
    requestedAt: input.now,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  };
}

export function completeOwnershipTransfer(
  transfer: OwnershipTransfer,
  now: Date,
): OwnershipTransfer {
  return { ...transfer, state: 'completed', completedAt: now };
}

export function cancelOwnershipTransfer(
  transfer: OwnershipTransfer,
  now: Date,
  reason: string | null,
): OwnershipTransfer {
  return { ...transfer, state: 'cancelled', cancelledAt: now, cancellationReason: reason };
}
