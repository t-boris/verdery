/**
 * The Today feedback commands (P7-BE-01): FR-24's four controls, each
 * appending one immutable `recommendation_feedback` row AND driving the
 * paired section-6 lifecycle transition in the SAME transaction — the
 * wiring `recommendation-feedback.ts`'s header deliberately left to this
 * layer. The kind -> state mapping, exactly as P7-DATA-01 documented it:
 *
 * - `CompleteRecommendation`:        feedback `completed`  -> state `completed`
 * - `PostponeRecommendation`:        feedback `postponed`  -> state `postponed`
 *   (with the user's optional `postponedUntil` horizon on the feedback
 *   row; re-surfacing is the ENGINE's job on a later evaluation — a NEW
 *   candidate referencing the postponed one backward, see
 *   `rule-evaluation.ts` phase 4)
 * - `DismissRecommendation`:         feedback `dismissed`  -> state `rejected`
 *   (FR-24 says "dismissal" where section 6's lifecycle says "rejected")
 * - `MarkRecommendationIrrelevant`:  feedback `irrelevant` -> NO state of
 *   its own — "the explicit quality signal that accompanies or follows a
 *   dismissal" (the migration's own words), legal on a still-visible
 *   `presented` candidate or on an already-`rejected` one, appending only.
 *
 * Every command is revision-guarded (`expectedRevision` from `If-Match`)
 * and idempotent (`Idempotency-Key` through `runIdempotentCommand`).
 * Candidate-state preconditions come from the lifecycle functions
 * themselves (`presented` only — the migration's `presented_at` CHECK pins
 * the same fact). The commands deliberately do NOT take the per-garden
 * advisory lock: they touch only `presented` rows, which neither the Today
 * query (writes `eligible` rows) nor an evaluation's supersession of a
 * STALE row is guaranteed to avoid — that one legitimate race resolves by
 * revision guard, with the sweeps counting a loss as `lostRaces` and the
 * user's command reporting a stale revision.
 *
 * No sync-change rows: recommendations are not a synced record family
 * (offline Today actions are a client-stage decision — see
 * deferred-capabilities.md).
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { RecommendationCandidate } from '../domain/recommendation-candidate.js';
import { createRecommendationFeedback } from '../domain/recommendation-feedback.js';
import type { RecommendationFeedbackKind } from '../domain/recommendation-feedback.js';
import {
  completeRecommendationCandidate,
  postponeRecommendationCandidate,
  rejectRecommendationCandidate,
} from '../domain/recommendation-lifecycle.js';
import type { RecommendationCandidateRepository } from './recommendation-candidate-repository.js';
import {
  recommendationNotFoundError,
  recommendationStaleRevisionError,
} from './recommendation-errors.js';
import { requireRecommendationAndAuthorize } from './require-recommendation-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { RecommendationResource } from './recommendation-view.js';
import { toRecommendationResource } from './recommendation-view.js';
import type {
  TasksRecommendationsTransactionContext,
  TasksRecommendationsUnitOfWork,
} from './tasks-recommendations-unit-of-work.js';

/** Everything the four sibling commands share — see this file's header. */
interface FeedbackCommandDependencies {
  readonly candidates: RecommendationCandidateRepository;
  readonly idempotency: IdempotencyStore;
  readonly unitOfWork: TasksRecommendationsUnitOfWork;
  readonly authorization: GardenAuthorization;
  readonly clock: Clock;
}

/** Re-reads the candidate inside the transaction and enforces the caller's revision guard against the fresh snapshot. */
async function requireCurrentCandidate(
  context: TasksRecommendationsTransactionContext,
  recommendationId: Uuid,
  expectedRevision: number,
): Promise<{ candidate: RecommendationCandidate; ruleKey: string; ruleVersion: number }> {
  const [stored] = await context.recommendationCandidates.findWithRuleByIds([recommendationId]);
  if (stored === undefined) {
    throw recommendationNotFoundError();
  }
  if (stored.candidate.revision !== expectedRevision) {
    throw recommendationStaleRevisionError(stored.candidate.revision);
  }
  return { candidate: stored.candidate, ruleKey: stored.ruleKey, ruleVersion: stored.ruleVersion };
}

/**
 * One command's precondition-and-transition: returns the transitioned
 * candidate to write, or `null` when the (validated) kind is append-only
 * and the row must not be touched (`irrelevant`). State-conflict checks
 * throw from inside.
 */
type FeedbackTransition = (
  candidate: RecommendationCandidate,
  now: Date,
) => RecommendationCandidate | null;

/**
 * The shared transaction body: transition (when the kind has one), guarded
 * write, feedback append — one commit or none.
 */
async function applyFeedbackAndTransition(
  context: TasksRecommendationsTransactionContext,
  recommendationId: Uuid,
  profileId: Uuid,
  expectedRevision: number,
  kind: RecommendationFeedbackKind,
  postponedUntil: Date | null,
  transition: FeedbackTransition,
  now: Date,
): Promise<RecommendationResource> {
  const { candidate, ruleKey, ruleVersion } = await requireCurrentCandidate(
    context,
    recommendationId,
    expectedRevision,
  );

  let current = candidate;
  const transitioned = transition(candidate, now);
  if (transitioned !== null) {
    current = transitioned;
    const written = await context.recommendationCandidates.update(current, candidate.revision);
    if (!written) {
      // The in-transaction re-read makes this a same-instant foreign
      // write; report it as the stale revision it is.
      throw recommendationStaleRevisionError(candidate.revision);
    }
  }

  await context.recommendationCandidates.appendFeedback(
    createRecommendationFeedback({
      id: generateUuidV7(),
      candidateId: recommendationId,
      kind,
      actorProfileId: profileId,
      postponedUntil,
      now,
    }),
  );

  return toRecommendationResource(current, ruleKey, ruleVersion);
}

/** Shared `execute` shape — authorization, idempotency envelope, transaction. */
async function executeFeedbackCommand(
  deps: FeedbackCommandDependencies,
  operation: string,
  gardenId: Uuid,
  recommendationId: Uuid,
  profileId: Uuid,
  expectedRevision: number,
  idempotencyKey: string,
  postponedUntil: Date | null,
  kind: RecommendationFeedbackKind,
  transition: FeedbackTransition,
): Promise<RecommendationResource> {
  await requireRecommendationAndAuthorize(
    deps.candidates,
    deps.authorization,
    gardenId,
    recommendationId,
    profileId,
  );

  return runIdempotentCommand(
    deps.idempotency,
    deps.unitOfWork,
    {
      actorProfileId: profileId,
      operation,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        gardenId,
        recommendationId,
        expectedRevision,
        postponedUntil: postponedUntil === null ? null : postponedUntil.toISOString(),
      }),
    },
    200,
    (context) =>
      applyFeedbackAndTransition(
        context,
        recommendationId,
        profileId,
        expectedRevision,
        kind,
        postponedUntil,
        transition,
        deps.clock.now(),
      ),
  );
}

/** Feedback `completed` -> state `completed`: the user did the recommended work now. */
export class CompleteRecommendation {
  constructor(private readonly deps: FeedbackCommandDependencies) {}

  async execute(
    gardenId: Uuid,
    recommendationId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<RecommendationResource> {
    return executeFeedbackCommand(
      this.deps,
      'recommendations.completeRecommendation',
      gardenId,
      recommendationId,
      profileId,
      expectedRevision,
      idempotencyKey,
      null,
      'completed',
      completeRecommendationCandidate,
    );
  }
}

/** Feedback `postponed` (optional user horizon) -> state `postponed` (terminal; the engine re-surfaces via a NEW candidate). */
export class PostponeRecommendation {
  constructor(private readonly deps: FeedbackCommandDependencies) {}

  async execute(
    gardenId: Uuid,
    recommendationId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    postponedUntil: Date | null,
    idempotencyKey: string,
  ): Promise<RecommendationResource> {
    return executeFeedbackCommand(
      this.deps,
      'recommendations.postponeRecommendation',
      gardenId,
      recommendationId,
      profileId,
      expectedRevision,
      idempotencyKey,
      postponedUntil,
      'postponed',
      postponeRecommendationCandidate,
    );
  }
}

/** Feedback `dismissed` -> state `rejected` (FR-24's verb, section 6's state). */
export class DismissRecommendation {
  constructor(private readonly deps: FeedbackCommandDependencies) {}

  async execute(
    gardenId: Uuid,
    recommendationId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<RecommendationResource> {
    return executeFeedbackCommand(
      this.deps,
      'recommendations.dismissRecommendation',
      gardenId,
      recommendationId,
      profileId,
      expectedRevision,
      idempotencyKey,
      null,
      'dismissed',
      rejectRecommendationCandidate,
    );
  }
}

/**
 * Feedback `irrelevant`, append-only — no lifecycle transition and no
 * revision bump. Legal on a still-visible `presented` candidate (the user
 * flags it without dismissing) or on an already-`rejected` one (the signal
 * "follows a dismissal"); every other state conflicts.
 */
export class MarkRecommendationIrrelevant {
  constructor(private readonly deps: FeedbackCommandDependencies) {}

  async execute(
    gardenId: Uuid,
    recommendationId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<RecommendationResource> {
    return executeFeedbackCommand(
      this.deps,
      'recommendations.markRecommendationIrrelevant',
      gardenId,
      recommendationId,
      profileId,
      expectedRevision,
      idempotencyKey,
      null,
      'irrelevant',
      (candidate) => {
        if (candidate.state !== 'presented' && candidate.state !== 'rejected') {
          throw new DomainRuleViolatedError(
            'tasks_recommendations.recommendation_candidate.state_conflict',
            `Irrelevant feedback requires candidate '${candidate.id}' to be in state 'presented' or 'rejected', but it is '${candidate.state}'.`,
          );
        }
        // Append-only: validated, never written.
        return null;
      },
    );
  }
}
