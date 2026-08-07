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
 * `aiExplanations` (P7-AI-01): the AI-explanation verdict rows. Bound here
 * rather than read through a second pooled connection because
 * `GetTodayView` reads accepted records INSIDE its advisory-lock
 * transaction — acquiring a second pool connection while holding one is
 * the pool-exhaustion deadlock shape this module's context exists to
 * prevent. Provider CALLS never happen inside a transaction; only the
 * selection reads and the single-row verdict writes do.
 *
 * `taxonomyReferences`, `taxonomySeasonalFacts`, `bedOccupancyHistory`
 * (P9D-SEASON-RULES-01): three more `plants-inventory`-owned read ports,
 * bound here transaction-scoped for the SAME reason `plants`/`observations`
 * already are, NOT the pre-transaction fetch-then-thread shape
 * `weatherObservation`/`weatherForecast`/`hemisphere` use in
 * `evaluate-garden-recommendations.ts`. Two independent reasons, either one
 * sufficient on its own:
 *
 * 1. Weather and hemisphere are each ONE fixed-shape fact per garden,
 *    resolvable before the transaction even opens. Seasonal facts and
 *    bed-occupancy history are PER-PLANT and PER-BED queries whose inputs
 *    (which taxa, which beds) are only known once the plant list itself has
 *    been read — and that read happens INSIDE the transaction (the existing
 *    `context.plants.search` scan). There is no "before the transaction"
 *    moment at which these queries could even be issued.
 * 2. `EvaluateGardenRecommendations`'s own header already states the rule
 *    for facts whose evidence rows quote them: "that read must be
 *    snapshot-consistent with those writes" (given for `observations`).
 *    Family, seasonal timing, and bed history are exactly such facts here —
 *    `seasonal-sowing-window-check`/`succession-replanting-reminder`/
 *    `crop-rotation-caution` (P9D-SEASON-RULES-01) quote them as
 *    `seasonal_calendar` evidence — so the same rule places them in the
 *    transaction, not before it.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { MapObjectRepository } from '../../gardens-mapping/public.js';
import type { MediaRepository } from '../../media/public.js';
import type { ObservationRepository } from '../../observations-history/public.js';
import type {
  BedOccupancyHistoryReader,
  PlantRepository,
  TaxonomyReferenceRepository,
  TaxonomySeasonalFactRepository,
} from '../../plants-inventory/public.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { AiExplanationRecordRepository } from './ai-explanation-record-repository.js';
import type { GardenEvaluationStateRepository } from './garden-evaluation-state-repository.js';
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
  /** The sweep's per-garden watermark, written in the same transaction as the evaluation it describes. */
  readonly gardenEvaluationState: GardenEvaluationStateRepository;
  readonly outbox: OutboxAppender;
  readonly aiExplanations: AiExplanationRecordRepository;
  readonly taxonomyReferences: TaxonomyReferenceRepository;
  readonly taxonomySeasonalFacts: TaxonomySeasonalFactRepository;
  readonly bedOccupancyHistory: BedOccupancyHistoryReader;
}

export interface TasksRecommendationsUnitOfWork {
  run<T>(work: (context: TasksRecommendationsTransactionContext) => Promise<T>): Promise<T>;
}
