/**
 * Transaction boundary for tasks-recommendations commands.
 *
 * Every port a command handler needs is bound to the same transaction, so a
 * task's new state, its attachment rows, its revision-journal entry, and its
 * idempotency record commit or roll back together — the same rule
 * `PlantsInventoryUnitOfWork` documents for plant commands.
 *
 * `mapObjects`, `plants`, and `media` are bound here too, transaction-scoped,
 * even though this module does not own any of those tables:
 * `CreateManualTask` validates a `garden_area`/`plant` target against
 * gardens-mapping's `garden_object` table and plants-inventory's `plant`
 * table (`require-task-target-references.ts`), and `AttachTaskFile`
 * validates a `mediaId` against media's `media_record` table, in the same
 * transaction as the write each check guards — reusing each sibling module's
 * own exported repository port (via its `public.ts`), never duplicating its
 * query logic, the exact same three-sibling shape
 * `PlantsInventoryUnitOfWork` already established for two of them
 * (`mapObjects`, `media`) plus one more.
 *
 * `originObservationId` validation is the one exception: it goes through the
 * already-constructed `GetObservation` use case (see `create-manual-task.ts`),
 * not a transaction-bound `ObservationRepository` here — `GetObservation` is
 * this module's one explicitly-instructed way to reach observations-history's
 * read path, and it is a plain existence/ownership check with no write of
 * its own to stay snapshot-consistent with, so binding it to this
 * transaction would add complexity without a corresponding correctness
 * benefit.
 *
 * No `outbox`/`auditLogger` here: this module carries no eventing or audit
 * trail of its own this pass, the same deliberate omission `media`'s own
 * `MediaUnitOfWork` and `PlantsInventoryUnitOfWork` document for the
 * identical reason.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { MediaRepository } from '../../media/public.js';
import type { PlantRepository } from '../../plants-inventory/public.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { TaskAttachmentRepository } from './task-attachment-repository.js';
import type { TaskRepository } from './task-repository.js';
import type { TaskRevisionJournalWriter } from './task-revision-journal-writer.js';

export interface TasksRecommendationsTransactionContext {
  readonly tasks: TaskRepository;
  readonly taskAttachments: TaskAttachmentRepository;
  readonly revisionJournal: TaskRevisionJournalWriter;
  readonly idempotency: IdempotencyStore;
  readonly mapObjects: MapObjectRepository;
  readonly plants: PlantRepository;
  readonly media: MediaRepository;
}

export interface TasksRecommendationsUnitOfWork {
  run<T>(work: (context: TasksRecommendationsTransactionContext) => Promise<T>): Promise<T>;
}
