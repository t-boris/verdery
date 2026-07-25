/**
 * Converts a presented recommendation candidate into a real task
 * (P7-BE-01) — FR-25's "The application may suggest tasks from ...
 * recommendations", made concrete as one transaction:
 *
 * 1. The candidate transitions `presented -> completed`: converting IS
 *    acting on the recommendation affirmatively — the surface's purpose is
 *    fulfilled, the work now lives on the task list, and a still-live
 *    candidate would duplicate the very task it produced in Today (the
 *    engine's own suppression treats the open converted task as the
 *    candidate's equivalent). Section 6's closed state vocabulary offers
 *    exactly one affirmative terminal state, so `completed` is the honest
 *    mapping; the converted task's `originRecommendationId` is what
 *    distinguishes a conversion-completion from a did-it-now completion in
 *    the outcome history.
 * 2. A `completed` feedback row is appended — FR-24's closed feedback
 *    vocabulary has no separate conversion verb, and the task linkage
 *    above carries the distinction.
 * 3. The task is created with `source: 'suggested'` and
 *    `originRecommendationId` set together (the migration's equivalence
 *    CHECK admits exactly this pairing), `status: 'planned'` (the user
 *    explicitly asked — accepted work, not a proposal), the rule version's
 *    own `actionTitle` as title (section 5's "Suggested action template"),
 *    the candidate's stored deterministic explanation as notes (FR-24's
 *    "Reason" survives onto the task), and the candidate's target,
 *    urgency, and validity window verbatim. Journaled and sync-recorded
 *    exactly like `CreateManualTask` — the task IS a synced record family,
 *    so offline clients replicate it immediately.
 *
 * A second conversion attempt with a different idempotency key finds the
 * candidate `completed` and reports the state conflict; a retried request
 * replays through `runIdempotentCommand`.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { InternalError } from '../../../platform/errors/application-error.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { createRecommendationFeedback } from '../domain/recommendation-feedback.js';
import { completeRecommendationCandidate } from '../domain/recommendation-lifecycle.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import { createTaskFromRecommendation } from '../domain/task.js';
import type { RecommendationCandidateRepository } from './recommendation-candidate-repository.js';
import {
  recommendationNotFoundError,
  recommendationStaleRevisionError,
} from './recommendation-errors.js';
import { requireRecommendationAndAuthorize } from './require-recommendation-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { RecommendationResource } from './recommendation-view.js';
import { toRecommendationResource } from './recommendation-view.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';
import type { TaskResource } from './task-view.js';
import { toTaskResource } from './task-view.js';

const OPERATION = 'recommendations.convertRecommendationToTask';

export interface ConvertRecommendationToTaskResult {
  readonly recommendation: RecommendationResource;
  readonly task: TaskResource;
}

export class ConvertRecommendationToTask {
  constructor(
    private readonly candidates: RecommendationCandidateRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly catalog: RuleCatalog,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    recommendationId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<ConvertRecommendationToTaskResult> {
    await requireRecommendationAndAuthorize(
      this.candidates,
      this.authorization,
      gardenId,
      recommendationId,
      profileId,
    );

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      {
        actorProfileId: profileId,
        operation: OPERATION,
        idempotencyKey,
        requestFingerprint: JSON.stringify({ gardenId, recommendationId, expectedRevision }),
      },
      201,
      async (context) => {
        const [stored] = await context.recommendationCandidates.findWithRuleByIds([
          recommendationId,
        ]);
        if (stored === undefined) {
          throw recommendationNotFoundError();
        }
        if (stored.candidate.revision !== expectedRevision) {
          throw recommendationStaleRevisionError(stored.candidate.revision);
        }
        const { candidate, ruleKey, ruleVersion } = stored;

        const definition = this.catalog.find(ruleKey, ruleVersion);
        if (definition === null) {
          throw new InternalError(
            'tasks_recommendations.recommendation.rule_version_unshipped',
            `Candidate '${candidate.id}' pins rule '${ruleKey}' v${String(ruleVersion)}, which this build's catalog does not ship.`,
          );
        }

        const now = this.clock.now();
        const completed = completeRecommendationCandidate(candidate, now);
        const written = await context.recommendationCandidates.update(
          completed,
          candidate.revision,
        );
        if (!written) {
          throw recommendationStaleRevisionError(candidate.revision);
        }

        await context.recommendationCandidates.appendFeedback(
          createRecommendationFeedback({
            id: generateUuidV7(),
            candidateId: recommendationId,
            kind: 'completed',
            actorProfileId: profileId,
            postponedUntil: null,
            now,
          }),
        );

        const task = createTaskFromRecommendation({
          id: generateUuidV7(),
          gardenId,
          target: {
            kind: candidate.targetKind,
            gardenAreaMapObjectId: candidate.targetGardenAreaMapObjectId,
            plantId: candidate.targetPlantId,
          },
          rawTitle: definition.actionTitle,
          notes: candidate.explanation,
          timeWindowStart: candidate.windowStart,
          timeWindowEnd: candidate.windowEnd,
          urgency: candidate.urgency,
          originRecommendationId: recommendationId,
          createdByProfileId: profileId,
          now,
        });

        await context.tasks.insert(task);
        await context.revisionJournal.record({
          taskId: task.id,
          revision: task.revision,
          commandType: 'convertRecommendationToTask',
          status: task.status,
          dueDate: task.dueDate,
          actorProfileId: profileId,
        });
        await context.syncChanges.record({
          gardenId: task.gardenId,
          recordId: task.id,
          recordType: 'task',
          operation: 'upsert',
          recordRevision: task.revision,
        });

        return {
          recommendation: toRecommendationResource(completed, ruleKey, ruleVersion),
          task: toTaskResource(task),
        };
      },
    );
  }
}
