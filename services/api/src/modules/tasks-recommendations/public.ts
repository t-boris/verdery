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
 * P7-RULE-01 adds the deterministic rule engine: the versioned rule model
 * and launch catalog (every launch rule awaiting horticultural review —
 * P7-SAFE-01), the pure `evaluateGardenRules` engine, the
 * `EvaluateGardenRecommendations` use case, and the recommendation
 * persistence surface.
 *
 * P7-ASYNC-01 wires the first caller: the scheduled recommendation sweep
 * (`RunRecommendationEvaluationSweep` — full-drain evaluation plus the
 * deferred candidate-expiry phase) and its internal route, both composed in
 * `app.ts`; `EvaluateGardenRecommendations` now also appends one
 * `recommendation.candidate_created` outbox event per created candidate for
 * P7-NOTIF-01's coming notification flow.
 *
 * P7-BE-01 adds the Today surface — the first client-facing recommendation
 * HTTP surface: `GetTodayView` (the prioritized presentable set, marking
 * first presentation), the four FR-24 feedback commands
 * (`CompleteRecommendation`/`PostponeRecommendation`/`DismissRecommendation`/
 * `MarkRecommendationIrrelevant`), `ConvertRecommendationToTask`, and their
 * routes under the `Recommendations` tag. The engine now persists each
 * candidate's rendered deterministic explanation and records the
 * `generated -> eligible` transition at creation; the postponed-prior
 * re-surfacing rule joins the engine (`rule-evaluation.ts`, phase 4).
 *
 * P7-AI-01 adds the bounded AI-explanation half of section 10: the
 * AI-explanation record (per-candidate/locale verdict rows carrying
 * provenance versions, evidence references, generated text, validation
 * outcome), the bilingual deterministic validation
 * (`validateAiExplanationDraft` over the action-concept and
 * prohibited-content lexicons), the sweep-driven
 * `EmbellishRecommendationExplanations` phase, and the Today serving of
 * accepted embellishments behind the `RECOMMENDATION_AI_EXPLANATION_ENABLED`
 * kill-switch (off everywhere today — pure deterministic behavior, zero
 * Vertex calls). The provider machinery itself lives in `integrations`
 * (`GenerateAiExplanation`, the Vertex adapter), the module that owns
 * provider adapters.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  CreateTaskFromRecommendationInput,
  CreateTaskInput,
  Task,
  TaskDetailChanges,
  TaskSource,
  TaskTarget,
  TaskTargetKind,
  TaskTimeWindow,
  TaskUrgency,
} from './domain/task.js';
export { assignTask, createTaskFromRecommendation } from './domain/task.js';
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
  validateRecommendationExplanation,
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
export {
  aggregatePriorityContributions,
  createRecommendationPriorityFactors,
  derivePriorityScoreFromStoredFactors,
  parseStoredPriorityFactorValue,
} from './domain/recommendation-priority.js';
export type {
  NewRecommendationPriorityFactor,
  RecommendationPriorityFactor,
  RecommendationPriorityFactorKind,
  StoredPriorityFactorValue,
} from './domain/recommendation-priority.js';
export { createRecommendationFeedback } from './domain/recommendation-feedback.js';
export type {
  CreateRecommendationFeedbackInput,
  RecommendationFeedback,
  RecommendationFeedbackKind,
} from './domain/recommendation-feedback.js';

export type {
  CompletedTaskFact,
  DailyPrecipitationFact,
  GardenFacts,
  ObservationFact,
  OpenTaskFact,
  PlantFact,
  PrecipitationSummary,
  PrecipitationWindowFact,
  PriorBedOccupantFact,
  PriorCandidateFact,
  PriorRecommendationState,
  TaxonomyFact,
  WeatherFact,
  WeatherMeasurementFacts,
} from './domain/garden-facts.js';
export {
  // Exported so the composition root can satisfy `plants-inventory`'s own
  // `GardenHemisphereSource` with THIS derivation rather than a second copy.
  // That module cannot import this one — this one already imports it — so
  // the root is where the two meet. See that port's own header.
  deriveHemisphere,
  latestCompletedForRuleAndTarget,
  latestObservationForPlant,
  priorBedOccupantFor,
  summarizePrecipitationSince,
  sameRecommendationTarget,
  taxonomyFactFor,
} from './domain/garden-facts.js';
export {
  EXCLUDED_RULE_CONTENT_CATEGORIES,
  normalizeContentCategory,
  requireAllowedContentCategory,
  validateFactorContribution,
  validateRuleDefinition,
} from './domain/rule-definition.js';
export type {
  GeneratableSafetyTier,
  RuleDefinition,
  RuleEvaluation,
  RuleEvaluator,
  RuleEvidenceSpec,
  RuleFactorContribution,
  RuleReviewMetadata,
  RuleSkipReason,
  RuleTargetEvaluation,
  RuleTimingSpec,
  RuleWeatherPolicy,
} from './domain/rule-definition.js';
export { RuleCatalog } from './domain/rule-catalog.js';
export { listExplanationPlaceholders, renderRuleExplanation } from './domain/rule-explanation.js';
export { TASK_OVERLAP_CONTRIBUTION, evaluateGardenRules } from './domain/rule-evaluation.js';
export type {
  GardenRuleEvaluationPlan,
  PlannedCandidate,
  RuleDecision,
  SuppressionReason,
} from './domain/rule-evaluation.js';
export { createLaunchRuleCatalog } from './domain/rules/launch-rule-catalog.js';

// P7-AI-01: the AI-explanation record, its bilingual bounded validation,
// and the lexicons behind it.
export {
  AI_EXPLANATION_LOCALES,
  AI_EXPLANATION_VALIDATION_OUTCOMES,
  createAiExplanationRecord,
} from './domain/ai-explanation.js';
export type {
  AiExplanationRecord,
  AiExplanationRejectionOutcome,
  AiExplanationValidationOutcome,
  CreateAiExplanationRecordInput,
} from './domain/ai-explanation.js';
export {
  MAX_EMBELLISHED_EXPLANATION_LENGTH,
  validateAiExplanationDraft,
} from './domain/ai-explanation-validation.js';
export type {
  AiExplanationValidationInput,
  AiExplanationValidationVerdict,
} from './domain/ai-explanation-validation.js';
export {
  ACTION_CONCEPTS,
  PROHIBITED_CATEGORIES,
  findProhibitedCategory,
  scanActionConcepts,
} from './domain/ai-explanation-lexicon.js';

export type { TaskRepository } from './application/task-repository.js';
export type { TaskAttachmentRepository } from './application/task-attachment-repository.js';
export type {
  RuleVersionRepository,
  RuleVersionIdMap,
} from './application/rule-version-repository.js';
export { ruleVersionIdentity } from './application/rule-version-repository.js';
export type {
  RecommendationCandidateRepository,
  StoredCandidateWithRule,
} from './application/recommendation-candidate-repository.js';
export { GetGardenCareRules } from './application/get-garden-care-rules.js';
export type {
  CareRuleBlocker,
  CareRulePlantReadinessSource,
  CareRuleResource,
  GardenCareRulesResource,
} from './application/get-garden-care-rules.js';
export { KyselyCareRulePlantReadinessSource } from './persistence/kysely-care-rule-plant-readiness-source.js';
export { registerCareRuleRoutes } from './transport/care-rule-routes.js';
export type { CareRuleRoutesDependencies } from './transport/care-rule-routes.js';
export { EvaluateGardenRecommendations } from './application/evaluate-garden-recommendations.js';
export type {
  CreatedRecommendationSummary,
  EvaluateGardenRecommendationsInput,
  EvaluateGardenRecommendationsResult,
} from './application/evaluate-garden-recommendations.js';
export type { EvaluationGardenSource } from './application/evaluation-garden-source.js';
export {
  EVALUATION_SWEEP_PAGE_SIZE,
  EXPIRY_SWEEP_GARDEN_LIMIT,
  RunRecommendationEvaluationSweep,
} from './application/run-recommendation-evaluation-sweep.js';
export type {
  GardenRecommendationEvaluator,
  RecommendationEvaluationSweepResult,
} from './application/run-recommendation-evaluation-sweep.js';
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
// Collaboration: task assignment, completion attribution, and shared
// activity history (P9A-TASK-01).
export { AssignTask } from './application/assign-task.js';
export { GetTaskActivity } from './application/get-task-activity.js';
export type {
  TaskActivityEntry,
  TaskActivityRepository,
} from './application/task-activity-repository.js';
export type { TaskActivityResource } from './application/task-activity-view.js';
export { KyselyTaskActivityRepository } from './persistence/kysely-task-activity-repository.js';

export {
  GetTodayView,
  TODAY_DEFAULT_LIMIT,
  TODAY_MAX_LIMIT,
} from './application/get-today-view.js';
export type { AiExplanationServingPolicy, TodayViewOutcome } from './application/get-today-view.js';
export type { AiExplanationRecordRepository } from './application/ai-explanation-record-repository.js';
export {
  EMBELLISHMENT_BATCH_LIMIT,
  EmbellishRecommendationExplanations,
} from './application/embellish-recommendation-explanations.js';
export type {
  AiExplanationGenerator,
  EmbellishmentRunResult,
  RecommendationExplanationEmbellisher,
} from './application/embellish-recommendation-explanations.js';
export {
  CompleteRecommendation,
  DismissRecommendation,
  MarkRecommendationIrrelevant,
  PostponeRecommendation,
} from './application/recommendation-feedback-commands.js';
export { ConvertRecommendationToTask } from './application/convert-recommendation-to-task.js';
export type { ConvertRecommendationToTaskResult } from './application/convert-recommendation-to-task.js';
export { RecommendationErrorCode } from './application/recommendation-errors.js';
export type {
  RecommendationEvidenceResource,
  RecommendationPriorityFactorResource,
  RecommendationResource,
  TodayRecommendationResource,
  TodayViewResource,
} from './application/recommendation-view.js';

export { registerTaskRoutes } from './transport/task-routes.js';
export type { TaskRoutesDependencies } from './transport/task-routes.js';
export { registerRecommendationRoutes } from './transport/recommendation-routes.js';
export type { RecommendationRoutesDependencies } from './transport/recommendation-routes.js';
export { registerRecommendationEvaluationSweepRoute } from './transport/recommendation-evaluation-sweep-route.js';
export type { RecommendationEvaluationSweepRouteDependencies } from './transport/recommendation-evaluation-sweep-route.js';

// Seasonal plan (P9D-SEASON-API-01): the garden-wide forward-looking
// seasonal-fact and continuous bed-rotation-status read, distinct from the
// rule-fired Today/Recommendations surface above — see
// `application/get-garden-seasonal-plan.ts`'s own header for the module-
// ownership and reuse reasoning.
export { GetGardenSeasonalPlan } from './application/get-garden-seasonal-plan.js';
export type {
  GardenSeasonalPlan,
  SeasonalPlanPlantEntry,
  SeasonalPlanRotationStatusEntry,
  SeasonalPlanTaxonomyStatus,
  SeasonalPlanTiming,
} from './application/get-garden-seasonal-plan.js';
// `SeasonalPlanResult` and its nested resource shapes are the contract's own
// generated types (`@verdery/api-contracts`), not re-exported here — see
// `get-garden-seasonal-plan-view.ts`'s own header for why the mapping is
// typed directly against them instead of a hand-rolled duplicate.
export { toGardenSeasonalPlanResource } from './application/get-garden-seasonal-plan-view.js';
export { registerSeasonalPlanRoutes } from './transport/seasonal-plan-routes.js';
export type { SeasonalPlanRoutesDependencies } from './transport/seasonal-plan-routes.js';

export { KyselyTaskRepository } from './persistence/kysely-task-repository.js';
export { KyselyTaskAttachmentRepository } from './persistence/kysely-task-attachment-repository.js';
export { KyselyTaskRevisionJournalWriter } from './persistence/kysely-task-revision-journal-writer.js';
export { KyselyTasksRecommendationsUnitOfWork } from './persistence/kysely-tasks-recommendations-unit-of-work.js';
export { KyselyRuleVersionRepository } from './persistence/kysely-rule-version-repository.js';
export { KyselyRecommendationCandidateRepository } from './persistence/kysely-recommendation-candidate-repository.js';
export { KyselyEvaluationGardenSource } from './persistence/kysely-evaluation-garden-source.js';
export { KyselyAiExplanationRecordRepository } from './persistence/kysely-ai-explanation-record-repository.js';
export type { TasksRecommendationsDatabaseSchema } from './persistence/schema.js';
