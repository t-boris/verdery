/**
 * Quota reservations: a pure reserve/commit/release state machine over
 * `media.quota_reservation`, scoped to a garden or an account (this
 * codebase's own name — `identity_access.profile` — for what
 * architecture/media-storage-and-processing.md section 17 calls an
 * account).
 *
 * This is the *mechanism* section 17 asks for, not the enforced numbers:
 * no numeric quota LIMIT exists anywhere in this repository's docs today
 * (implementation-plan.md, section "14.2 Implementation-Time Selections"
 * lists "Quotas" as a still-undecided implementation-time selection), so
 * nothing here sums reservations against a limit or rejects a reservation
 * for exceeding one — that is explicitly a future API-layer command's job,
 * per work package P6-DATA-01's own scope ("enough to let a future
 * API-layer command atomically check-and-reserve before authorizing an
 * upload").
 *
 * Source: migrations/1785100000000_media-lifecycle-and-quotas.sql;
 * architecture/media-storage-and-processing.md, section "17. Quotas".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type QuotaReservationScopeKind = 'garden' | 'account';
export type QuotaReservationState = 'reserved' | 'committed' | 'released';

export interface QuotaReservation {
  readonly id: Uuid;
  readonly scopeKind: QuotaReservationScopeKind;
  /** Set only for `scopeKind = 'garden'`; `null` otherwise. */
  readonly scopeGardenId: Uuid | null;
  /** Set only for `scopeKind = 'account'`; `null` otherwise. */
  readonly scopeProfileId: Uuid | null;
  /** The one upload this reservation exists for — see this module's own header comment on why this is required, not optional. */
  readonly mediaId: Uuid;
  readonly reservedBytes: number;
  readonly state: QuotaReservationState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Mirrors the migration's `quota_reservation_scope_consistency_check`: exactly one of the two scope references must be set, matching the one `scopeKind`. */
function requireScopeConsistency(
  scopeKind: QuotaReservationScopeKind,
  scopeGardenId: Uuid | null,
  scopeProfileId: Uuid | null,
): void {
  const isGardenScope = scopeKind === 'garden' && scopeGardenId !== null && scopeProfileId === null;
  const isAccountScope =
    scopeKind === 'account' && scopeProfileId !== null && scopeGardenId === null;

  if (!isGardenScope && !isAccountScope) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "scopeKind must be 'garden' with only scopeGardenId set, or 'account' with only scopeProfileId set.",
      {
        details: [
          {
            code: 'media.quota_reservation.scope.inconsistent',
            pointer: '/scopeKind',
          },
        ],
      },
    );
  }
}

/** Mirrors the migration's `quota_reservation_reserved_bytes_positive_check`, the same "clean ValidationError instead of a raw CHECK violation" precedent `validateDeclaredByteSize` follows. */
function validateReservedBytes(rawReservedBytes: number): number {
  if (!Number.isInteger(rawReservedBytes) || rawReservedBytes <= 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'reservedBytes must be a positive integer.',
      {
        details: [
          { code: 'media.quota_reservation.reserved_bytes.invalid', pointer: '/reservedBytes' },
        ],
      },
    );
  }

  return rawReservedBytes;
}

/** Creates a new reservation in the `reserved` state. */
export function reserveMediaQuota(
  id: Uuid,
  scopeKind: QuotaReservationScopeKind,
  scopeGardenId: Uuid | null,
  scopeProfileId: Uuid | null,
  mediaId: Uuid,
  rawReservedBytes: number,
  now: Date,
): QuotaReservation {
  requireScopeConsistency(scopeKind, scopeGardenId, scopeProfileId);

  return {
    id,
    scopeKind,
    scopeGardenId,
    scopeProfileId,
    mediaId,
    reservedBytes: validateReservedBytes(rawReservedBytes),
    state: 'reserved',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * `reserved` -> `committed`. Not documented as idempotent by section 17
 * (only "reservation and release" are named there), so — unlike
 * `releaseQuotaReservation` below — this rejects a source state other than
 * `reserved` outright, including an already-`committed` one.
 */
export function commitQuotaReservation(reservation: QuotaReservation, now: Date): QuotaReservation {
  if (reservation.state !== 'reserved') {
    throw new DomainRuleViolatedError(
      'media.quota_reservation.commit_conflict',
      `commitQuotaReservation requires reservation '${reservation.id}' to be 'reserved', but it is '${reservation.state}'.`,
    );
  }

  return { ...reservation, state: 'committed', updatedAt: now };
}

/**
 * `reserved` -> `released`, idempotently: section 17's own words, "Quota
 * reservation and release are idempotent." An already-`released`
 * reservation is returned unchanged rather than rejected, the same
 * "transition to the value already held is accepted rather than rejected"
 * precedent `plants-inventory/domain/plant-lifecycle.ts` already sets for
 * this codebase. A `committed` reservation cannot be released: its bytes
 * are already counted as durably consumed by that point, so releasing them
 * would silently under-count real usage — a genuine invalid transition,
 * not an idempotent replay of the same call.
 */
export function releaseQuotaReservation(
  reservation: QuotaReservation,
  now: Date,
): QuotaReservation {
  if (reservation.state === 'released') {
    return reservation;
  }

  if (reservation.state !== 'reserved') {
    throw new DomainRuleViolatedError(
      'media.quota_reservation.release_conflict',
      `releaseQuotaReservation requires reservation '${reservation.id}' to be 'reserved' or already 'released', but it is '${reservation.state}'.`,
    );
  }

  return { ...reservation, state: 'released', updatedAt: now };
}
