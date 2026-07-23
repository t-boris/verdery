import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';

/**
 * The plant commands that write a `plant_revision` row — every command that
 * changes `plant` (all nine minus `AttachPlantPhoto` and
 * `SetPrimaryPlantPhoto`, which only touch `plant_photo` and never bump
 * `plant.revision`).
 */
export type PlantCommandType =
  | 'addPlant'
  | 'addPlantFromPhoto'
  | 'updateDetails'
  | 'confirmIdentification'
  | 'transitionLifecycleStage'
  | 'setStatus'
  | 'movePlant';

export interface PlantRevisionJournalEntry {
  readonly plantId: Uuid;
  readonly revision: number;
  readonly commandType: PlantCommandType;
  /** Nullable: populated only when this command changed the field — see the migration's own comment on `plants_inventory.plant_revision`. */
  readonly lifecycleStage: LifecycleStage | null;
  readonly status: PlantStatus | null;
  readonly actorProfileId: Uuid;
}

/**
 * Writes one immutable row to `plants_inventory.plant_revision` per accepted
 * command, in the same transaction as the command's own `plant` write —
 * mirrors `gardens-mapping`'s `RevisionJournalWriter` for
 * `garden_object_revision` exactly.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * comment on `plants_inventory.plant_revision`.
 */
export interface PlantRevisionJournalWriter {
  record(entry: PlantRevisionJournalEntry): Promise<void>;
}
