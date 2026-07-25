/**
 * Composition-root helper for the tasks-recommendations module — split out
 * of `app.ts` for the same 600-line reason `compose-media.ts` and
 * `compose-integrations.ts` were. Still composition-root code, not a
 * module boundary.
 *
 * Wires three surfaces of one module:
 * - the task commands and routes (P4-BE-03 / P4-CONTRACT-01), unchanged;
 * - the scheduled recommendation-evaluation sweep and its internal
 *   machine-to-machine route (P7-ASYNC-01);
 * - the Today query, the four feedback commands, and the task conversion
 *   (P7-BE-01) — the first client-facing recommendation surface, sharing
 *   the module's one unit of work, idempotency store, and the SAME
 *   `RuleCatalog` instance the evaluation uses, so the versions Today
 *   resolves are exactly the versions evaluation registers.
 */

import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import type { GetGardenWeather } from './modules/integrations/public.js';
import type { GetObservation } from './modules/observations-history/public.js';
import {
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
  EvaluateGardenRecommendations,
  GetTodayView,
  KyselyEvaluationGardenSource,
  KyselyRecommendationCandidateRepository,
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
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
): TasksRecommendationsComposition {
  const taskRepository = new KyselyTaskRepository(database.queries);
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
  const recommendationEvaluationSweepRouteDependencies: RecommendationEvaluationSweepRouteDependencies =
    {
      runRecommendationEvaluationSweep: new RunRecommendationEvaluationSweep(
        new KyselyEvaluationGardenSource(database.queries),
        evaluateGardenRecommendations,
        unitOfWork,
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
    getTodayView: new GetTodayView(unitOfWork, gardenAuthorization, catalog, clock),
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
