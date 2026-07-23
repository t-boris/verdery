/**
 * Read-only, authorized lookup for a single calibration revision.
 *
 * Added for the synchronization module's `GET /v1/sync/changes` (P5-BE-02):
 * a `record: 'calibration'`, `operation: 'upsert'` change needs the current
 * authorized server representation of exactly the revision it names, per
 * architecture/offline-synchronization.md's own requirement that a change
 * "contains enough information to upsert... a local read-model record".
 * Mirrors `GetGarden`'s/`GetPlant`'s/`GetMapObject`'s own shape: authorize
 * against the caller-supplied `gardenId` before any repository read.
 *
 * Unlike `GetPlant`/`GetTask`, this does not additionally check that the
 * fetched record belongs to `gardenId`: `Calibration` carries no `gardenId`
 * field of its own (only `backgroundObjectId` — see
 * `calibration-repository.ts`), and there is no confused-deputy risk to
 * guard against here regardless, since the only caller of this class
 * (`GetSyncChanges`) always supplies the `gardenId` a `platform.sync_change`
 * row itself carries — written, in the same transaction as the calibration
 * insert it describes, by `UpsertMapCalibration` from the exact `gardenId`
 * parameter that command was authorized against. That pairing cannot
 * mismatch without a bug in that command's own transaction, not a caller
 * error this lookup could meaningfully defend against.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Calibration, CalibrationRepository } from './calibration-repository.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { mapObjectNotFoundError } from './map-object-errors.js';

export class GetCalibration {
  constructor(
    private readonly calibrations: CalibrationRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, calibrationId: Uuid, profileId: Uuid): Promise<Calibration> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const calibration = await this.calibrations.findById(calibrationId);
    if (calibration === null) {
      // Reuses the map-object "not found" code: a calibration is a child
      // record of the map/geometry aggregate, and this branch is not
      // reachable in practice for the same reason `GetMapObject`'s own
      // "record changed again" fallback in `execute-and-map-outcome.ts` is
      // narrow — `UpsertMapCalibration` inserts this row in the same
      // transaction as the `platform.sync_change` entry that names it, and
      // nothing in this codebase ever deletes a calibration row.
      throw mapObjectNotFoundError();
    }

    return calibration;
  }
}
