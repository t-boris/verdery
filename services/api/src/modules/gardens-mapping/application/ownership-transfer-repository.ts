import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OwnershipTransfer } from '../domain/ownership-transfer.js';

/**
 * Persistence port for `collaboration.ownership_transfer` (P9A-OWNER-01).
 * Lives beside `MembershipRepository`/`InvitationRepository` for the same
 * "temporary consolidation" reason those files' own headers record.
 */
export interface OwnershipTransferRepository {
  /**
   * Inserts a new PENDING transfer. The `ownership_transfer_pending_key`
   * partial unique index is the authority for "at most one pending transfer
   * per garden"; `TransferOwnership` catches this constraint's violation and
   * translates it to a clean conflict, exactly as `CreateInvitation` already
   * does for its own pending-uniqueness index.
   */
  insertPending(transfer: OwnershipTransfer): Promise<void>;

  /**
   * The garden's current PENDING transfer, or `null` — the UNLOCKED
   * pre-check `TransferOwnership` runs before its own insert. Safe to leave
   * unlocked there specifically because a genuine concurrent double-insert is
   * caught by `ownership_transfer_pending_key` itself, not by this read; this
   * method is not the authority for any command that goes on to CHANGE the
   * pending row it finds — see `lockPendingForGarden` for that.
   */
  findPendingForGarden(gardenId: Uuid): Promise<OwnershipTransfer | null>;

  /**
   * Row-locks (`SELECT ... FOR UPDATE`) and returns the garden's currently
   * PENDING transfer, or `null` — the authoritative re-read every command
   * that can MOVE a pending transfer out of `pending` runs immediately before
   * deciding its fate: `AcceptOwnershipTransfer`, `DeclineOwnershipTransfer`,
   * and `CancelOwnershipTransfer`. `KyselyOwnershipTransferRepository.update`
   * carries no `WHERE state = 'pending'` guard of its own — it persists
   * whatever `state` the caller computed, unconditionally — so without this
   * lock, two of these three commands racing the SAME pending row could both
   * pass a stale unlocked read and then race to `update()`, with the later
   * write silently overwriting the earlier one's outcome (worst case: a
   * transfer `AcceptOwnershipTransfer` already completed — with both
   * membership periods already closed and reopened — gets its `state`
   * clobbered back to `cancelled` by a `CancelOwnershipTransfer` that read
   * `pending` before the accept committed, leaving the transfer ROW
   * contradicting the MEMBERSHIP rows it is supposed to describe). Locking
   * this row first, before any of the three commands touches a membership
   * row, serializes all three against each other exactly the way
   * `lockMembership` already serializes concurrent role changes on one
   * membership row.
   */
  lockPendingForGarden(gardenId: Uuid): Promise<OwnershipTransfer | null>;

  /** Persists every mutable field of `transfer` — state, and whichever of the completion/cancellation columns that state implies. */
  update(transfer: OwnershipTransfer): Promise<void>;
}
