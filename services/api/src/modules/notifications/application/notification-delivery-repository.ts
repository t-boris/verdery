/**
 * Port for the delivery worker's own intent operations and the append-only
 * attempt records (P7-NOTIF-02).
 *
 * CLAIM SEMANTICS — `claimDueForDelivery` is one atomic statement that
 * selects due rows `FOR UPDATE SKIP LOCKED` and advances
 * `next_delivery_attempt_at` to a lease horizon in the same UPDATE, so:
 * - two concurrent sweep runs can never claim (and therefore never push)
 *   the same intent — the second run skips locked rows and, after commit,
 *   the lease keeps the row out of the due set;
 * - a run that crashes mid-batch loses nothing durably: its claims
 *   resurface when the lease lapses, making push delivery at-least-once
 *   across crashes (the outbox relay's own publish/record posture).
 *
 * Every terminal write is a state-conditional UPDATE (`WHERE state =
 * 'pending'`) — the established SQL form of the intent state machine — so
 * a concurrent content close (supersession racing a send) is a counted
 * lost race, never an overwrite.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { NotificationIntent } from '../domain/notification-intent.js';

/** One append-only FCM send-attempt record — written in the same transaction as the intent's delivery outcome. */
export interface NewDeliveryAttempt {
  readonly id: Uuid;
  readonly intentId: Uuid;
  readonly deviceId: Uuid;
  readonly outcome: 'accepted' | 'token_invalid' | 'transient_failure' | 'permanent_failure';
  /** The provider's error identifier; `null` exactly when accepted. */
  readonly errorCode: string | null;
  readonly attemptedAt: Date;
}

export interface NotificationDeliveryRepository {
  /**
   * Atomically claims up to `limit` due intents — pending, push-eligible,
   * `earliestDeliveryAt` reached, not leased, not expired — leasing each
   * until `leaseUntil`. Returns the claimed rows as they now stand.
   */
  claimDueForDelivery(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<readonly NotificationIntent[]>;

  /**
   * Closes up to `limit` past-expiry pending intents as `expired` — the
   * at-scale close P7-NOTIF-01 deferred to this worker (recipients who
   * never open their inbox), any channel. Returns how many transitioned.
   */
  expireDuePending(now: Date, limit: number): Promise<number>;

  /** `pending -> sent`, recording the consumed attempt round. Returns whether this call transitioned the row. */
  markSent(id: Uuid, attemptCount: number, now: Date): Promise<boolean>;

  /** `pending -> failed | skipped | expired` with the typed reason (`null` for `expired` — the state explains itself). */
  closeDelivery(
    id: Uuid,
    state: 'failed' | 'skipped' | 'expired',
    reason: string | null,
    now: Date,
  ): Promise<boolean>;

  /** Parks a still-pending intent at `nextAttemptAt` (quiet-hours deferral or bounded transient retry), recording the rounds consumed so far. */
  scheduleRetry(id: Uuid, nextAttemptAt: Date, attemptCount: number, now: Date): Promise<boolean>;

  /** Appends attempt records — insert-only, no updates ever. */
  recordAttempts(attempts: readonly NewDeliveryAttempt[]): Promise<void>;
}
