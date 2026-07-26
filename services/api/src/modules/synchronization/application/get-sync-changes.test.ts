/**
 * Unit tests for `GetSyncChanges`'s G-10 fix
 * (`docs/development/garden-capability-matrix.md`): a per-record read that
 * fails with an `ApplicationError` mid-pull must be distinguished by a FRESH
 * membership check, not treated uniformly as an internal error — this is the
 * one branch genuinely hard to provoke through a real database (it requires
 * a true concurrent revocation racing a single page's own row reads), so it
 * is exercised here with hand-built fakes rather than `sync-test-harness.ts`.
 *
 * Every other `GetSyncChanges` behaviour (ordinary pulls, cursors, protocol
 * version, revocation tombstone visibility) is already covered end to end in
 * `tests/integration/synchronization-pull.test.ts` against real PostgreSQL —
 * not duplicated here.
 */

import { GardenErrorCode } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type {
  GardenPartitionMembership,
  MembershipDetail,
  MembershipRepository,
} from '../../gardens-mapping/public.js';
import type { GetGarden, GetMapObject, GetCalibration } from '../../gardens-mapping/public.js';
import type { GetObservationForSync } from '../../observations-history/public.js';
import type { GetPlant } from '../../plants-inventory/public.js';
import type { GetTask } from '../../tasks-recommendations/public.js';
import type { SyncChangeQuery, SyncChangeRecord } from './sync-change-query.js';
import { GetSyncChanges } from './get-sync-changes.js';

const PROFILE_ID = 'profile-0000-0000-0000-000000000000';
const GARDEN_ID = 'garden-0000-0000-0000-000000000000';
const NOW = new Date('2026-07-22T12:00:00Z');

function notUsed(name: string) {
  return () => {
    throw new Error(`not used by this test: ${name}`);
  };
}

class FakeMembershipRepository implements MembershipRepository {
  constructor(
    private readonly ownProfileMemberships: readonly GardenPartitionMembership[],
    private readonly activeCheckResult: MembershipDetail | null,
  ) {}

  findGardenAccess = notUsed('findGardenAccess');
  insertOwner = notUsed('insertOwner');
  insert = notUsed('insert');
  listActiveForGarden = notUsed('listActiveForGarden');
  lockActiveOwnerIds = notUsed('lockActiveOwnerIds');
  lockMembership = notUsed('lockMembership');
  changeRole = notUsed('changeRole');
  openPeriod = notUsed('openPeriod');
  closeOpenPeriod = notUsed('closeOpenPeriod');
  listForGarden = notUsed('listForGarden');
  listDetailsForProfile = notUsed('listDetailsForProfile');
  setState = notUsed('setState');

  listMembershipsForProfile(): Promise<GardenPartitionMembership[]> {
    return Promise.resolve([...this.ownProfileMemberships]);
  }

  findActiveByGardenAndProfile(): Promise<MembershipDetail | null> {
    return Promise.resolve(this.activeCheckResult);
  }
}

function fakeSyncChangeQuery(rows: readonly SyncChangeRecord[]): SyncChangeQuery {
  return {
    listAfter() {
      return Promise.resolve([...rows]);
    },
  };
}

function throwingGardenReader(error: Error): GetGarden {
  return { execute: () => Promise.reject(error) } as unknown as GetGarden;
}

function unusedReaders() {
  return {
    getMapObject: { execute: notUsed('getMapObject') } as unknown as GetMapObject,
    getCalibration: { execute: notUsed('getCalibration') } as unknown as GetCalibration,
    getPlant: { execute: notUsed('getPlant') } as unknown as GetPlant,
    getObservationForSync: {
      execute: notUsed('getObservationForSync'),
    } as unknown as GetObservationForSync,
    getTask: { execute: notUsed('getTask') } as unknown as GetTask,
  };
}

const upsertRow: SyncChangeRecord = {
  sequence: 1,
  gardenId: GARDEN_ID,
  recordId: GARDEN_ID,
  recordType: 'garden',
  operation: 'upsert',
  recordRevision: 3,
  committedAt: NOW,
};

describe('GetSyncChanges (G-10: authorization failure mid-pull)', () => {
  it('surfaces a confirmed revocation as the ordinary garden/delete tombstone, not an InternalError', async () => {
    const memberships = new FakeMembershipRepository(
      [{ gardenId: GARDEN_ID, state: 'active', role: 'owner' }],
      null, // the fresh re-check confirms access is now gone
    );
    const getSyncChanges = new GetSyncChanges(
      memberships,
      fakeSyncChangeQuery([upsertRow]),
      {
        getGarden: throwingGardenReader(
          new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.'),
        ),
        ...unusedReaders(),
      },
      { now: () => NOW },
    );

    const result = await getSyncChanges.execute(PROFILE_ID, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sequence: 1,
      gardenId: GARDEN_ID,
      recordId: GARDEN_ID,
      recordType: 'garden',
      operation: 'delete',
    });
    expect(result.items[0]).not.toHaveProperty('record');
  });

  it('still raises an InternalError when the failure is NOT a revocation (access confirmed still active)', async () => {
    const stillActive: MembershipDetail = {
      id: 'membership-0000-0000-0000-000000000000',
      gardenId: GARDEN_ID,
      profileId: PROFILE_ID,
      role: 'owner',
      state: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const memberships = new FakeMembershipRepository(
      [{ gardenId: GARDEN_ID, state: 'active', role: 'owner' }],
      stillActive,
    );
    const getSyncChanges = new GetSyncChanges(
      memberships,
      fakeSyncChangeQuery([upsertRow]),
      {
        getGarden: throwingGardenReader(
          new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.'),
        ),
        ...unusedReaders(),
      },
      { now: () => NOW },
    );

    await expect(
      getSyncChanges.execute(PROFILE_ID, { after: null, limit: 50, protocolVersion: 1 }),
    ).rejects.toMatchObject({ code: 'synchronization.changes.record_missing' });
  });
});
