/**
 * Public interface of the tasks-recommendations module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Two different audiences use this file, mirroring the three sibling Phase 4
 * modules' own two-audience convention:
 *
 * - Other modules: none this pass. This module is the last of Phase 4's
 *   three sibling modules (`media`, `plants-inventory`, `observations-history`
 *   already merged) in the dependency chain — it depends on all three of
 *   them (`MediaRepository`, `PlantRepository`, `MapObjectRepository`,
 *   `GetObservation`), but nothing built this phase depends on it back.
 *   Said explicitly, not omitted, matching this file's own convention of
 *   naming its audiences even when one is empty.
 * - The composition root (`app.ts`) needs the concrete classes below — every
 *   command class, `ListTasksForGarden`, and the three Kysely repositories/
 *   writer/unit-of-work implementations — to construct this module's
 *   dependency graph, the same way it already does for gardens-mapping,
 *   media, observations-history, and plants-inventory.
 *
 * P4-CONTRACT-01 additionally lands this module's HTTP transport
 * (`registerTaskRoutes`, `TaskRoutesDependencies`) against the `Tasks` tag
 * `packages/api-contracts/openapi.yaml` now declares. No new query or
 * command was needed — every route maps onto a command or query this module
 * already had.
 *
 * P7-DATA-01 adds the recommendation data model's domain surface (rule
 * versions, candidates, evidence, lifecycle transitions, priority factors,
 * feedback) — pure types and functions only. No application command,
 * repository, or route touches these tables yet: the rule engine
 * (P7-RULE-01), scheduled generation (P7-ASYNC-01), and Today commands
 * (P7-BE-01) are the stages that will, mirroring how `media`'s
 * quota-reservation domain shipped mechanism-only in P6-DATA-01.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  CreateTaskInput,
  Task,
  TaskDetailChanges,
  TaskSource,
  TaskTarget,
  TaskTargetKind,
  TaskTimeWindow,
  TaskUrgency,
} from './domain/task.js';
export type { TaskStatus, TaskTerminalStatus } from './domain/task-lifecycle.js';
export type { TaskAttachment } from './domain/task-attachment.js';

export {
  createRuleVersion,
  validateRuleKey,
  validateRuleVersionNumber,
} from './domain/rule-version.js';
export type {
  CreateRuleVersionInput,
  RecommendationSafetyTier,
  RuleVersion,
} from './domain/rule-version.js';
export {
  createRecommendationCandidate,
  requireGeneratableSafetyTier,
  validateCareCategory,
  validateRecommendationTarget,
  validateRecommendationWindow,
} from './domain/recommendation-candidate.js';
export type {
  CreateRecommendationCandidateInput,
  RecommendationCandidate,
  RecommendationCandidateAggregate,
  RecommendationTarget,
  RecommendationTargetKind,
  RecommendationUrgency,
} from './domain/recommendation-candidate.js';
export type {
  NewRecommendationEvidence,
  RecommendationEvidence,
  RecommendationEvidenceKind,
} from './domain/recommendation-evidence.js';
export {
  LIVE_RECOMMENDATION_CANDIDATE_STATES,
  completeRecommendationCandidate,
  expireRecommendationCandidate,
  markRecommendationCandidateEligible,
  postponeRecommendationCandidate,
  presentRecommendationCandidate,
  rejectRecommendationCandidate,
  supersedeRecommendationCandidate,
} from './domain/recommendation-lifecycle.js';
export type { RecommendationCandidateState } from './domain/recommendation-lifecycle.js';
export { createRecommendationPriorityFactors } from './domain/recommendation-priority.js';
export type {
  NewRecommendationPriorityFactor,
  RecommendationPriorityFactor,
  RecommendationPriorityFactorKind,
} from './domain/recommendation-priority.js';
export { createRecommendationFeedback } from './domain/recommendation-feedback.js';
export type {
  CreateRecommendationFeedbackInput,
  RecommendationFeedback,
  RecommendationFeedbackKind,
} from './domain/recommendation-feedback.js';

export type { TaskRepository } from './application/task-repository.js';
export type { TaskAttachmentRepository } from './application/task-attachment-repository.js';
export type {
  TaskCommandType,
  TaskRevisionJournalEntry,
  TaskRevisionJournalWriter,
} from './application/task-revision-journal-writer.js';
export type {
  TasksRecommendationsTransactionContext,
  TasksRecommendationsUnitOfWork,
} from './application/tasks-recommendations-unit-of-work.js';
export { TaskErrorCode } from './application/task-errors.js';
export type { TaskResource } from './application/task-view.js';
export type { TaskAttachmentResource } from './application/task-attachment-view.js';

export { CreateManualTask } from './application/create-manual-task.js';
export type {
  CreateManualTaskInput,
  CreateManualTaskTargetInput,
  CreateManualTaskTimeWindowInput,
} from './application/create-manual-task.js';
export { EditTask } from './application/edit-task.js';
export type { EditTaskChanges, EditTaskTimeWindowInput } from './application/edit-task.js';
export { RescheduleTask } from './application/reschedule-task.js';
export type {
  RescheduleTaskInput,
  RescheduleTaskTimeWindowInput,
} from './application/reschedule-task.js';
export { CompleteTask } from './application/complete-task.js';
export { DismissTask } from './application/dismiss-task.js';
export { SkipTask } from './application/skip-task.js';
export { DeleteTask } from './application/delete-task.js';
export { GetTask } from './application/get-task.js';
export { ListTasksForGarden } from './application/list-tasks-for-garden.js';
export { AttachTaskFile } from './application/attach-task-file.js';
export type { AttachTaskFileInput } from './application/attach-task-file.js';

export { registerTaskRoutes } from './transport/task-routes.js';
export type { TaskRoutesDependencies } from './transport/task-routes.js';

export { KyselyTaskRepository } from './persistence/kysely-task-repository.js';
export { KyselyTaskAttachmentRepository } from './persistence/kysely-task-attachment-repository.js';
export { KyselyTaskRevisionJournalWriter } from './persistence/kysely-task-revision-journal-writer.js';
export { KyselyTasksRecommendationsUnitOfWork } from './persistence/kysely-tasks-recommendations-unit-of-work.js';
export type { TasksRecommendationsDatabaseSchema } from './persistence/schema.js';
