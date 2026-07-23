/**
 * Transaction boundary for plants-inventory commands.
 *
 * Every port a command handler needs is bound to the same transaction, so a
 * plant's new state, its photo/identification rows, its revision-journal
 * entry, its sync-change entry, and its idempotency record commit or roll
 * back together — the same rule `GardensMappingUnitOfWork` documents for map
 * commands. `syncChanges` is the platform-level `SyncChangeRecorder` (see
 * `platform/sync/sync-change-recorder.ts`), not a module-local port.
 *
 * `mapObjects` and `media` are bound here too, transaction-scoped, even
 * though this module does not own either table: `AddPlant`, `AddPlantFromPhoto`,
 * and `MovePlant` validate a placement against gardens-mapping's
 * `garden_object` table, and `AddPlantFromPhoto`/`AttachPlantPhoto` validate a
 * `mediaId` against media's `media_record` table, in the same transaction as
 * the write those checks guard — reusing each sibling module's own exported
 * repository port (via its `public.ts`), never duplicating its query logic.
 *
 * No `outbox`/`auditLogger` here: this module carries no eventing or audit
 * trail of its own this pass, the same deliberate omission `media`'s own
 * `MediaUnitOfWork` documents for the identical reason — see that module's
 * `application/media-unit-of-work.ts`.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { MediaRepository } from '../../media/public.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { PlantIdentificationRepository } from './plant-identification-repository.js';
import type { PlantPhotoRepository } from './plant-photo-repository.js';
import type { PlantRepository } from './plant-repository.js';
import type { PlantRevisionJournalWriter } from './plant-revision-journal-writer.js';

export interface PlantsInventoryTransactionContext {
  readonly plants: PlantRepository;
  readonly plantPhotos: PlantPhotoRepository;
  readonly plantIdentifications: PlantIdentificationRepository;
  readonly revisionJournal: PlantRevisionJournalWriter;
  readonly idempotency: IdempotencyStore;
  readonly mapObjects: MapObjectRepository;
  readonly media: MediaRepository;
  readonly syncChanges: SyncChangeRecorder;
}

export interface PlantsInventoryUnitOfWork {
  run<T>(work: (context: PlantsInventoryTransactionContext) => Promise<T>): Promise<T>;
}
