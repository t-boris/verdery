/**
 * Persistence port for `gardens_mapping.garden_context_fact` (P9D-CONTEXT-01).
 *
 * `recordOrUpdate` is a single atomic upsert keyed on `(gardenId, contextKind)`
 * — no prior `SELECT`, matching `NotificationDeviceRepository.registerOrRefresh`'s
 * own "one statement decides insert-versus-update" shape (see that port's
 * header). `id` is a freshly generated candidate the caller always supplies;
 * it is used only when the row does not already exist — on conflict the
 * existing row's `id` (and `createdAt`) are left untouched, only `revision`
 * advances.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenContextFact,
  GardenContextFactProvenance,
  GardenContextFactValue,
} from '../domain/garden-context-fact.js';

export interface GardenContextFactRepository {
  /** Creates (revision 1) or updates in place (revision + 1) the fact at `(gardenId, contextKind)`. `input` is the already-validated shape `validateGardenContextFactInput` returns — the type itself is the guarantee that only validated input reaches this port. */
  recordOrUpdate(
    id: Uuid,
    gardenId: Uuid,
    input: GardenContextFactValue & GardenContextFactProvenance,
    recordedByProfileId: Uuid,
    now: Date,
  ): Promise<GardenContextFact>;

  /** Every fact currently recorded for this garden, in no particular guaranteed order beyond being stable across calls (`contextKind` ascending). */
  listForGarden(gardenId: Uuid): Promise<readonly GardenContextFact[]>;
}
