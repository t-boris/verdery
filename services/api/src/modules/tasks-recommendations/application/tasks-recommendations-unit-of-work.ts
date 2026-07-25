/**
 * Transaction boundary for tasks-recommendations commands.
 *
 * Every port a command handler needs is bound to the same transaction, so a
 * task's new state, its attachment rows, its revision-journal entry, its
 * sync-change entry, and its idempotency record commit or roll back together
 * — the same rule `PlantsInventoryUnitOfWork` documents for plant commands.
 * `syncChanges` is the platform-level `SyncChangeRecorder` (see
 * `platform/sync/sync-change-recorder.ts`), not a module-local port.
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
 * `observations` IS transaction-bound, by the same reasoning read the other
 * way: `EvaluateGardenRecommendations` (P7-RULE-01) reads the garden's whole
 * observation history as engine input whose values its own writes then quote
 * as evidence rows, so that read must be snapshot-consistent with those
 * writes. `ruleVersions` and `recommendationCandidates` are this module's
 * own new recommendation tables (P7-DATA-01's schema, first written by the
 * same engine stage).
 *
 * `outbox` (P7-ASYNC-01): `EvaluateGardenRecommendations` appends one
 * `recommendation.candidate_created` event per created candidate in the
 * SAME transaction as the candidate/evidence/factor inserts — the ordinary
 * "domain state and its outbox events commit atomically" rule `media`'s own
 * `MediaUnitOfWork` documents for `media.processing_requested`.
 * notifications.md section 5's flow starts at "domain event"; emitting here
 * is what spares P7-NOTIF-01 from reopening this transaction path. No
 * `auditLogger` still: this module carries no audit trail of its own.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { MediaRepository } from '../../media/public.js';
import type { ObservationRepository } from '../../observations-history/public.js';
import type { PlantRepository } from '../../plants-inventory/public.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { RecommendationCandidateRepository } from './recommendation-candidate-repository.js';
import type { RuleVersionRepository } from './rule-version-repository.js';
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
  readonly observations: ObservationRepository;
  readonly syncChanges: SyncChangeRecorder;
  readonly ruleVersions: RuleVersionRepository;
  readonly recommendationCandidates: RecommendationCandidateRepository;
  readonly outbox: OutboxAppender;
}

export interface TasksRecommendationsUnitOfWork {
  run<T>(work: (context: TasksRecommendationsTransactionContext) => Promise<T>): Promise<T>;
}
