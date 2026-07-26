import { describe, expect, it } from 'vitest';
import { roleHasCapability } from '../../gardens-mapping/public.js';
import type { SyncRecordType } from '../../../platform/sync/sync-record-type.js';
import {
  SYNC_RECORD_PULL_CAPABILITY,
  requiredPullCapability,
} from './sync-record-pull-capability.js';

const EVERY_SYNC_RECORD_TYPE: readonly SyncRecordType[] = [
  'garden',
  'gardenObject',
  'calibration',
  'plant',
  'observation',
  'task',
];

const EVERY_GARDEN_ROLE = ['owner', 'editor', 'viewer'] as const;

describe('SYNC_RECORD_PULL_CAPABILITY (G-9 pinned invariant)', () => {
  it('covers every SyncRecordType — the same exhaustiveness check contract.test.ts runs for SyncRecordSnapshot', () => {
    for (const recordType of EVERY_SYNC_RECORD_TYPE) {
      expect(SYNC_RECORD_PULL_CAPABILITY).toHaveProperty(recordType);
    }
    expect(Object.keys(SYNC_RECORD_PULL_CAPABILITY).sort()).toEqual(
      [...EVERY_SYNC_RECORD_TYPE].sort(),
    );
  });

  it.each(EVERY_SYNC_RECORD_TYPE)(
    'every active garden role can read %s — the invariant that makes state-only partitioning correct',
    (recordType) => {
      const capability = requiredPullCapability(recordType);
      for (const role of EVERY_GARDEN_ROLE) {
        expect(roleHasCapability(role, capability)).toBe(true);
      }
    },
  );

  it('would fail the moment a record family stopped being viewer-readable', () => {
    // Pins the exact regression G-9 names: if a future change narrowed some
    // family's declared capability below `viewGarden` (the only capability
    // every role holds — `manageGarden`/`editGardenContent`/`exportGarden`/
    // `administerOwnership` are all narrower), a `viewer`'s pull of that
    // family would need to stop being byte-identical to an `owner`'s. This
    // test is the tripwire: it fails the moment that declared capability
    // stops being one `viewer` holds.
    for (const recordType of EVERY_SYNC_RECORD_TYPE) {
      expect(roleHasCapability('viewer', requiredPullCapability(recordType))).toBe(true);
    }
  });
});
