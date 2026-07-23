/**
 * A plant's attached photo. Append-only, like `media.media_record` itself —
 * no update function exists here beyond the `is_primary` flag flip, which
 * `SetPrimaryPlantPhoto` implements as clear-then-set across the whole
 * table, not a mutation of one row's own fields (see
 * `application/plant-photo-repository.ts`).
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `plants_inventory.plant_photo`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface PlantPhoto {
  readonly id: Uuid;
  readonly plantId: Uuid;
  readonly mediaId: Uuid;
  readonly isPrimary: boolean;
  readonly createdAt: Date;
}

export function createPlantPhoto(
  id: Uuid,
  plantId: Uuid,
  mediaId: Uuid,
  isPrimary: boolean,
  now: Date,
): PlantPhoto {
  return { id, plantId, mediaId, isPrimary, createdAt: now };
}
