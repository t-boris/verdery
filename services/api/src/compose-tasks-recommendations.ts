/**
 * Composition-root helper for the tasks-recommendations module — split out
 * of `app.ts` for the same 600-line reason `compose-media.ts` and
 * `compose-integrations.ts` were. Still composition-root code, not a
 * module boundary.
 *
 * Wires three surfaces of one module:
 * - the task commands and routes (P4-BE-03 / P4-CONTRACT-01), unchanged;
 * - the scheduled recommendation-evaluation sweep and its internal
 *   machine-to-machine route (P7-ASYNC-01), now carrying the optional
 *   AI-embellishment phase (P7-AI-01) — composed ONLY when the
 *   `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch is on;
 * - the Today query, the four feedback commands, and the task conversion
 *   (P7-BE-01) — the first client-facing recommendation surface, sharing
 *   the module's one unit of work, idempotency store, and the SAME
 *   `RuleCatalog` instance the evaluation uses, so the versions Today
 *   resolves are exactly the versions evaluation registers. The Today
 *   query serves stored AI embellishments behind the same switch.
 */

import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import type {
  AiExplanationLocale,
  GenerateAiExplanation,
  GetGardenWeather,
} from './modules/integrations/public.js';
import type { GetObservation } from './modules/observations-history/public.js';
import {
  AssignTask,
  AttachTaskFile,
  CompleteRecommendation,
  CompleteTask,
  ConvertRecommendationToTask,
  createLaunchRuleCatalog,
  CreateManualTask,
  DeleteTask,
  DismissRecommendation,
  DismissTask,
  EditTask,
  EmbellishRecommendationExplanations,
  EvaluateGardenRecommendations,
  GetTaskActivity,
  GetTodayView,
  KyselyEvaluationGardenSource,
  KyselyRecommendationCandidateRepository,
  KyselyTaskActivityRepository,
  KyselyTaskRepository,
  KyselyTasksRecommendationsUnitOfWork,
  ListTasksForGarden,
  MarkRecommendationIrrelevant,
  PostponeRecommendation,
  RescheduleTask,
  RunRecommendationEvaluationSweep,
  SkipTask,
} from './modules/tasks-recommendations/public.js';
import type {
  RecommendationEvaluationSweepRouteDependencies,
  RecommendationRoutesDependencies,
  TaskRoutesDependencies,
} from './modules/tasks-recommendations/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

/**
 * The one runtime embellishment/serving locale (P7-AI-01): the stored
 * deterministic baseline is English rule content and no serving surface
 * negotiates a locale yet, so runtime generation targets the language of
 * the text it rephrases. The validation machinery is already bilingual
 * (the `tests/ai-explanation-fixtures/` harness proves both languages);
 * Russian runtime generation is a serving-surface decision recorded in
 * deferred-capabilities.md.
 */
const RUNTIME_EMBELLISHMENT_LOCALE: AiExplanationLocale = 'en';

export interface TasksRecommendationsComposition {
  readonly taskRoutesDependencies: TaskRoutesDependencies;
  readonly recommendationRoutesDependencies: RecommendationRoutesDependencies;
  readonly recommendationEvaluationSweepRouteDependencies: RecommendationEvaluationSweepRouteDependencies;
}

export function composeTasksRecommendations(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  getObservation: GetObservation,
  getGardenWeather: GetGardenWeather,
  generateAiExplanation: GenerateAiExplanation,
  aiExplanationEnabled: boolean,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
): TasksRecommendationsComposition {
  const taskRepository = new KyselyTaskRepository(database.queries);
  const taskActivityRepository = new KyselyTaskActivityRepository(database.queries);
  const idempotency = new KyselyIdempotencyStore(database.queries, clock);
  const unitOfWork = new KyselyTasksRecommendationsUnitOfWork(database.queries, clock);

  const taskRoutesDependencies: TaskRoutesDependencies = {
    createManualTask: new CreateManualTask(
      idempotency,
      unitOfWork,
      gardenAuthorization,
      getObservation,
      clock,
    ),
    listTasksForGarden: new ListTasksForGarden(taskRepository, gardenAuthorization),
    editTask: new EditTask(taskRepository, idempotency, unitOfWork, gardenAuthorization, clock),
    rescheduleTask: new RescheduleTask(
      taskRepository,
      idempotency,
      unitOfWork,
      gardenAuthorization,
      clock,
    ),
    completeTask: new CompleteTask(
      taskRepository,
      idempotency,
      unitOfWork,
      gardenAuthorization,
      clock,
    ),
    dismissTask: new DismissTask(
      taskRepository,
      idempotency,
      unitOfWork,
      gardenAuthorization,
      clock,
    ),
    skipTask: new SkipTask(taskRepository, idempotency, unitOfWork, gardenAuthorization, clock),
    deleteTask: new DeleteTask(taskRepository, idempotency, unitOfWork, gardenAuthorization, clock),
    attachTaskFile: new AttachTaskFile(
      taskRepository,
      idempotency,
      unitOfWork,
      gardenAuthorization,
      clock,
    ),
    assignTask: new AssignTask(taskRepository, idempotency, unitOfWork, gardenAuthorization, clock),
    getTaskActivity: new GetTaskActivity(
      taskRepository,
      taskActivityRepository,
      gardenAuthorization,
    ),
  };

  // One catalog instance for evaluation AND the Today surface — see this
  // file's header.
  const catalog = createLaunchRuleCatalog();

  const evaluateGardenRecommendations = new EvaluateGardenRecommendations(
    unitOfWork,
    catalog,
    getGardenWeather,
    clock,
  );
  // P7-AI-01: the embellishment phase exists ONLY when the kill-switch is
  // on — a `null` embellisher means the sweep's third phase is skipped
  // structurally and zero provider calls can happen (the rollback
  // guarantee at the composition level, on top of main.ts's null adapter).
  const embellisher = aiExplanationEnabled
    ? new EmbellishRecommendationExplanations(
        unitOfWork,
        catalog,
        generateAiExplanation,
        RUNTIME_EMBELLISHMENT_LOCALE,
        clock,
      )
    : null;
  const recommendationEvaluationSweepRouteDependencies: RecommendationEvaluationSweepRouteDependencies =
    {
      runRecommendationEvaluationSweep: new RunRecommendationEvaluationSweep(
        new KyselyEvaluationGardenSource(database.queries),
        evaluateGardenRecommendations,
        unitOfWork,
        embellisher,
        clock,
      ),
      cloudTasksInvocationVerifier,
    };

  // P7-BE-01: the Today surface. The pooled candidate repository serves
  // the commands' pre-transaction authorization reads, the way
  // `taskRepository` serves the task commands'.
  const candidateRepository = new KyselyRecommendationCandidateRepository(database.queries);
  const feedbackCommandDependencies = {
    candidates: candidateRepository,
    idempotency,
    unitOfWork,
    authorization: gardenAuthorization,
    clock,
  };
  const recommendationRoutesDependencies: RecommendationRoutesDependencies = {
    getTodayView: new GetTodayView(
      unitOfWork,
      gardenAuthorization,
      catalog,
      { enabled: aiExplanationEnabled, locale: RUNTIME_EMBELLISHMENT_LOCALE },
      clock,
    ),
    completeRecommendation: new CompleteRecommendation(feedbackCommandDependencies),
    postponeRecommendation: new PostponeRecommendation(feedbackCommandDependencies),
    dismissRecommendation: new DismissRecommendation(feedbackCommandDependencies),
    markRecommendationIrrelevant: new MarkRecommendationIrrelevant(feedbackCommandDependencies),
    convertRecommendationToTask: new ConvertRecommendationToTask(
      candidateRepository,
      idempotency,
      unitOfWork,
      gardenAuthorization,
      catalog,
      clock,
    ),
  };

  return {
    taskRoutesDependencies,
    recommendationRoutesDependencies,
    recommendationEvaluationSweepRouteDependencies,
  };
}
