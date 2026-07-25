import { MEDIA_DELETION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  authorizeMediaUpload,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
} from '../domain/media-lifecycle.js';
import { STALE_UPLOAD_RECONCILIATION_DAYS } from '../domain/media-retention.js';
import { registerMediaRecord } from '../domain/media-record.js';
import type { MediaClass, MediaRecord } from '../domain/media-record.js';
import { reserveMediaQuota } from '../domain/quota-reservation.js';
import { objectKeyPrefixForMedia } from './media-storage-target.js';
import {
  createMediaFakes,
  FakeMediaUnitOfWork,
  fixedClock,
  TEST_BUCKETS,
} from './media-test-doubles.js';
import { RunMediaRetentionSweep } from './run-media-retention-sweep.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f0a';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f0b';
const NOW = new Date('2026-07-21T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_AGO = new Date(NOW.getTime() - (STALE_UPLOAD_RECONCILIATION_DAYS + 1) * DAY_MS);

let uuidCounter = 0;
function nextId(): string {
  uuidCounter += 1;
  return `019827ab-4c1d-7e3f-9a2b-5c6d7e8f${(0xa000 + uuidCounter).toString(16)}`;
}

function registeredAt(at: Date, mediaClass: MediaClass = 'garden_photo'): MediaRecord {
  return registerMediaRecord(
    nextId(),
    GARDEN_ID,
    PROFILE_ID,
    mediaClass,
    'file.jpg',
    'image/jpeg',
    123_456,
    null,
    null,
    null,
    null,
    at,
  );
}

function availableAt(at: Date, mediaClass: MediaClass = 'garden_photo'): MediaRecord {
  const registered = registeredAt(at, mediaClass);
  const authorized = authorizeMediaUpload(
    registered,
    TEST_BUCKETS.userMedia,
    `${objectKeyPrefixForMedia(registered.id)}object-uuid`,
    at,
  );
  return markMediaAvailable(
    beginMediaVerification(beginMediaUpload(authorized, at), at),
    'image/jpeg',
    123_456,
    null,
    at,
  );
}

function buildSweep() {
  const fakes = createMediaFakes();
  const sweep = new RunMediaRetentionSweep(
    new FakeMediaUnitOfWork(fakes),
    TEST_BUCKETS,
    fixedClock(NOW),
  );
  return { sweep, fakes };
}

describe('RunMediaRetentionSweep', () => {
  it('schedules deletion for an available record whose retention deadline has passed', async () => {
    const { sweep, fakes } = buildSweep();
    const expired = {
      ...availableAt(new Date(NOW.getTime() - 10 * DAY_MS)),
      retentionDeadlineAt: new Date(NOW.getTime() - DAY_MS),
    };
    fakes.media.records.set(expired.id, expired);

    const result = await sweep.execute();

    expect(result).toMatchObject({ retentionScheduled: 1, staleScheduled: 0 });
    expect(fakes.media.records.get(expired.id)?.uploadState).toBe('deletion_scheduled');
    expect(fakes.outbox.events).toEqual([
      expect.objectContaining({ eventType: MEDIA_DELETION_REQUESTED_EVENT_TYPE }),
    ]);
    expect(fakes.audit.events[0]).toMatchObject({
      eventType: 'media.deletion_requested',
      actorType: 'system',
    });
    expect(fakes.audit.events[0]?.details).toMatchObject({ reason: 'retention_deadline' });
  });

  it('leaves an available record whose deadline has NOT passed, and a deadline-less record, untouched', async () => {
    const { sweep, fakes } = buildSweep();
    const future = {
      ...availableAt(NOW),
      retentionDeadlineAt: new Date(NOW.getTime() + DAY_MS),
    };
    const deadlineLess = availableAt(NOW);
    fakes.media.records.set(future.id, future);
    fakes.media.records.set(deadlineLess.id, deadlineLess);

    const result = await sweep.execute();

    expect(result).toMatchObject({ retentionScheduled: 0, staleScheduled: 0 });
    expect(fakes.outbox.events).toHaveLength(0);
  });

  it('skips a retention-expired record still referenced by attachments, counting it', async () => {
    const { sweep, fakes } = buildSweep();
    const expired = {
      ...availableAt(new Date(NOW.getTime() - 10 * DAY_MS)),
      retentionDeadlineAt: new Date(NOW.getTime() - DAY_MS),
    };
    fakes.media.records.set(expired.id, expired);
    fakes.references.kinds = ['imported_background'];

    const result = await sweep.execute();

    expect(result).toMatchObject({ retentionScheduled: 0, retentionSkippedReferenced: 1 });
  });

  it('orphan reconciliation: a stale authorized upload is scheduled through the deletion workflow (bytes may exist), reason stale_upload', async () => {
    const { sweep, fakes } = buildSweep();
    const stale = authorizeMediaUpload(
      registeredAt(LONG_AGO),
      TEST_BUCKETS.userMedia,
      'ab/some-media/object-uuid',
      LONG_AGO,
    );
    fakes.media.records.set(stale.id, stale);

    const result = await sweep.execute();

    expect(result).toMatchObject({ staleScheduled: 1 });
    expect(fakes.media.records.get(stale.id)?.uploadState).toBe('deletion_scheduled');
    expect(fakes.outbox.events).toHaveLength(1);
    expect(fakes.audit.events[0]?.details).toMatchObject({ reason: 'stale_upload' });
  });

  it('orphan reconciliation: a stale registered row with no storage target completes to deleted in place and releases its reservation', async () => {
    const { sweep, fakes } = buildSweep();
    const stale = registeredAt(LONG_AGO);
    fakes.media.records.set(stale.id, stale);
    await fakes.quotaReservations.insert(
      reserveMediaQuota(nextId(), 'garden', GARDEN_ID, null, stale.id, 123_456, LONG_AGO),
    );

    const result = await sweep.execute();

    expect(result).toMatchObject({ staleScheduled: 1 });
    expect(fakes.media.records.get(stale.id)?.uploadState).toBe('deleted');
    expect(fakes.outbox.events).toHaveLength(0);
    expect(
      [...fakes.quotaReservations.reservations.values()].find((r) => r.mediaId === stale.id)?.state,
    ).toBe('released');
  });

  it('a recent (not yet stale) registration is left alone — the window exists so a resumable upload can still finish', async () => {
    const { sweep, fakes } = buildSweep();
    const recent = registeredAt(new Date(NOW.getTime() - DAY_MS));
    fakes.media.records.set(recent.id, recent);

    const result = await sweep.execute();

    expect(result).toMatchObject({ staleScheduled: 0 });
    expect(fakes.media.records.get(recent.id)?.uploadState).toBe('registered');
  });
});
