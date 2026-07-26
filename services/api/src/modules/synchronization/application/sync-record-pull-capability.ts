/**
 * The capability each synced record family requires to be READ through the
 * pull path (`GetSyncChanges`) — G-9, `docs/development/garden-capability-matrix.md`.
 *
 * Every entry is `viewGarden` today because every per-record reader
 * `GetSyncChanges` fans an upsert row's `record` out to (`GetGarden`,
 * `GetMapObject`, `GetCalibration`, `GetPlant`, `GetObservationForSync`,
 * `GetTask`) already gates on `viewGarden` internally — verified by
 * inspection of each one's own `requireCapability` call, the same way
 * `sync-operation-capability.ts` verifies the push side's families.
 *
 * This map performs no authorization check by itself — each reader's own
 * `GardenAuthorization.requireCapability` call remains the real enforcement,
 * unchanged. What this pins is the INVARIANT that makes splitting the pull
 * partition on `state === 'active'` alone (`get-sync-changes.ts`) correct
 * without ever consulting role: every role that can be active on a garden
 * (`owner`, `editor`, `viewer`) already holds every declared capability here,
 * confirmed in `sync-record-pull-capability.test.ts`. `GetSyncChanges` also
 * asserts the declared capability against the caller's actual role as a
 * defence-in-depth boundary check (mirroring the push side's own G-8 fix),
 * not merely as documentation.
 *
 * A `Record`, not a function that ignores its argument: `Record<SyncRecordType,
 * GardenCapability>` is exhaustive BY CONSTRUCTION over `SyncRecordType`, so a
 * future record family cannot be added to that union without this map failing
 * to compile until someone decides its required capability — the same
 * "cannot silently inherit" guarantee `garden-role.ts`'s own
 * `CAPABILITY_LIFECYCLE_STATES` documents for its own exhaustive record.
 */

import type { SyncRecordType } from '../../../platform/sync/sync-record-type.js';
import type { GardenCapability } from '../../gardens-mapping/public.js';

export const SYNC_RECORD_PULL_CAPABILITY: Readonly<Record<SyncRecordType, GardenCapability>> = {
  garden: 'viewGarden',
  gardenObject: 'viewGarden',
  calibration: 'viewGarden',
  plant: 'viewGarden',
  observation: 'viewGarden',
  task: 'viewGarden',
};

export function requiredPullCapability(recordType: SyncRecordType): GardenCapability {
  return SYNC_RECORD_PULL_CAPABILITY[recordType];
}
