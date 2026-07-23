import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import {
  commitQuotaReservation,
  releaseQuotaReservation,
  reserveMediaQuota,
} from './quota-reservation.js';

const RESERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const T0 = new Date('2026-07-21T09:00:00Z');
const T1 = new Date('2026-07-21T09:05:00Z');

describe('reserveMediaQuota', () => {
  it('creates a garden-scoped reservation in the reserved state', () => {
    const reservation = reserveMediaQuota(
      RESERVATION_ID,
      'garden',
      GARDEN_ID,
      null,
      MEDIA_ID,
      500,
      T0,
    );

    expect(reservation).toEqual({
      id: RESERVATION_ID,
      scopeKind: 'garden',
      scopeGardenId: GARDEN_ID,
      scopeProfileId: null,
      mediaId: MEDIA_ID,
      reservedBytes: 500,
      state: 'reserved',
      createdAt: T0,
      updatedAt: T0,
    });
  });

  it('creates an account-scoped reservation in the reserved state', () => {
    const reservation = reserveMediaQuota(
      RESERVATION_ID,
      'account',
      null,
      PROFILE_ID,
      MEDIA_ID,
      500,
      T0,
    );
    expect(reservation.scopeKind).toBe('account');
    expect(reservation.scopeProfileId).toBe(PROFILE_ID);
    expect(reservation.scopeGardenId).toBeNull();
  });

  it('rejects a garden scope missing scopeGardenId, or naming scopeProfileId too', () => {
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'garden', null, null, MEDIA_ID, 500, T0),
    ).toThrow(ValidationError);
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, PROFILE_ID, MEDIA_ID, 500, T0),
    ).toThrow(ValidationError);
  });

  it('rejects an account scope missing scopeProfileId, or naming scopeGardenId too', () => {
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'account', null, null, MEDIA_ID, 500, T0),
    ).toThrow(ValidationError);
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'account', GARDEN_ID, PROFILE_ID, MEDIA_ID, 500, T0),
    ).toThrow(ValidationError);
  });

  it('rejects a non-positive or non-integer reservedBytes', () => {
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, null, MEDIA_ID, 0, T0),
    ).toThrow(ValidationError);
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, null, MEDIA_ID, -1, T0),
    ).toThrow(ValidationError);
    expect(() =>
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, null, MEDIA_ID, 1.5, T0),
    ).toThrow(ValidationError);
  });
});

describe('commitQuotaReservation', () => {
  it('moves reserved to committed and stamps updatedAt', () => {
    const reservation = reserveMediaQuota(
      RESERVATION_ID,
      'garden',
      GARDEN_ID,
      null,
      MEDIA_ID,
      500,
      T0,
    );

    const committed = commitQuotaReservation(reservation, T1);
    expect(committed.state).toBe('committed');
    expect(committed.updatedAt).toEqual(T1);
    expect(committed.reservedBytes).toBe(500);
  });

  it('rejects committing an already-committed reservation', () => {
    const committed = commitQuotaReservation(
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, null, MEDIA_ID, 500, T0),
      T0,
    );
    expect(() => commitQuotaReservation(committed, T1)).toThrow(DomainRuleViolatedError);
  });

  it('rejects committing an already-released reservation', () => {
    const released = releaseQuotaReservation(
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, null, MEDIA_ID, 500, T0),
      T0,
    );
    expect(() => commitQuotaReservation(released, T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('releaseQuotaReservation', () => {
  it('moves reserved to released', () => {
    const reservation = reserveMediaQuota(
      RESERVATION_ID,
      'garden',
      GARDEN_ID,
      null,
      MEDIA_ID,
      500,
      T0,
    );

    const released = releaseQuotaReservation(reservation, T1);
    expect(released.state).toBe('released');
    expect(released.updatedAt).toEqual(T1);
  });

  it('is idempotent: releasing an already-released reservation is a no-op that returns it unchanged', () => {
    const reservation = reserveMediaQuota(
      RESERVATION_ID,
      'garden',
      GARDEN_ID,
      null,
      MEDIA_ID,
      500,
      T0,
    );
    const released = releaseQuotaReservation(reservation, T1);

    const releasedAgain = releaseQuotaReservation(released, new Date('2026-07-21T09:10:00Z'));
    expect(releasedAgain).toEqual(released);
  });

  it('rejects releasing an already-committed reservation', () => {
    const committed = commitQuotaReservation(
      reserveMediaQuota(RESERVATION_ID, 'garden', GARDEN_ID, null, MEDIA_ID, 500, T0),
      T0,
    );
    expect(() => releaseQuotaReservation(committed, T1)).toThrow(DomainRuleViolatedError);
  });
});
