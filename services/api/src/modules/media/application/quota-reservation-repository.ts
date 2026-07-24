import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { QuotaReservation } from '../domain/quota-reservation.js';

/**
 * Port for `media.quota_reservation`.
 *
 * P6-DATA-01 built the table and the pure reserve/commit/release transition
 * functions in `domain/quota-reservation.ts` but wired no repository to it —
 * that module's own doc comment says persistence and enforcement are "a
 * future API-layer command's job." P6-API-01's `RegisterMediaUpload` and
 * `CompleteMediaUpload` are that future command: `RegisterMediaUpload`
 * inserts one `reserved` row per upload, and `CompleteMediaUpload` commits or
 * releases it depending on the verification outcome.
 *
 * `findByMediaId` returns at most one row: `domain/quota-reservation.ts`'s
 * own header comment states "every reservation this stage's domain model
 * produces is for one specific upload's media row," and `RegisterMediaUpload`
 * creates exactly one reservation per registration, so a lookup by
 * `mediaId` is unambiguous for every reservation this module itself writes.
 *
 * No numeric quota LIMIT is read or enforced here, matching the migration's
 * own posture: "no numeric quota LIMIT exists anywhere in this repository's
 * docs today ... nothing here sums reservations against a limit or rejects a
 * reservation for exceeding one." This repository is pure bookkeeping.
 */
export interface QuotaReservationRepository {
  insert(reservation: QuotaReservation): Promise<void>;
  findByMediaId(mediaId: Uuid): Promise<QuotaReservation | null>;
  /** Persists a `state` transition produced by `commitQuotaReservation`/`releaseQuotaReservation`. */
  updateState(reservation: QuotaReservation): Promise<void>;
}
