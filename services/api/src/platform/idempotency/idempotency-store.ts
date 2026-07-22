/**
 * Port for the idempotency records every retryable mutation writes through.
 *
 * Source: architecture/backend-modular-monolith.md, section "15. Idempotency";
 * architecture/data-and-geospatial-design.md, section "17. Idempotency Records".
 */

import type { Uuid } from '../../shared/identifiers/uuid.js';

export type IdempotencyCheck =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'replay';
      readonly responseStatusCode: number;
      readonly responseBody: unknown;
    };

export interface IdempotencyRecordInput {
  readonly actorProfileId: Uuid;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

export interface IdempotencyStore {
  /**
   * Checks for a prior attempt under this key before doing any domain work.
   * An optimistic check, not a lock: it only ever prevents *wasted* work,
   * since `save` below is what actually enforces the guarantee.
   *
   * Returns `'new'` when nothing is recorded yet, and the caller should
   * proceed. Returns `'replay'` when a prior attempt already completed with
   * the same key and fingerprint — the caller must return the stored result
   * unchanged rather than re-running the command. Throws `ConflictError`
   * (`request.idempotency.key_reused`) when the key was already used with a
   * *different* request fingerprint.
   */
  check(input: IdempotencyRecordInput): Promise<IdempotencyCheck>;

  /**
   * Saves the accepted result, in the same transaction as the command's
   * domain writes, immediately before it commits. On a conflicting concurrent
   * writer (the true race `check` cannot catch), this throws a unique-
   * violation that aborts the whole transaction — see the comment on
   * `platform.idempotency_record` in migrations/
   * 1784736116655_identity-and-gardens-baseline.sql for why a `check`-only
   * guard is optimistic rather than a lock, and why the command handler,
   * not this method, is what re-reads and resolves that case afterward.
   */
  save(
    input: IdempotencyRecordInput,
    responseStatusCode: number,
    responseBody: unknown,
    ttlMilliseconds: number,
  ): Promise<void>;
}
