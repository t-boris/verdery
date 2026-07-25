/**
 * Evaluates the launch rule catalog against one garden and persists the
 * outcome: new recommendation candidates (with evidence and priority
 * factors) and `superseded` transitions on the stale candidates they
 * replace — the transactional shell around the pure
 * `evaluateGardenRules` engine.
 *
 * Built for two future callers, neither wired yet: the scheduler
 * (P7-ASYNC-01) calls it per garden on refresh, and the Today surface
 * (P7-BE-01) may call it on demand. It is IDEMPOTENT per evaluation
 * window by construction, not by idempotency key: re-running over
 * unchanged facts finds every would-be candidate already live and
 * suppresses it (`liveCandidateExists`), writing nothing — proven by the
 * integration suite's double-run test. Concurrent evaluations of the same
 * garden serialize on a transaction-scoped advisory lock
 * (`lockGardenForEvaluation`), so the read-decide-write cycle cannot
 * interleave and duplicate.
 *
 * Fact gathering: plants, observations, open tasks, and prior candidates
 * are read INSIDE the transaction, snapshot-consistent with the writes
 * they justify (the evidence rows quote these exact reads). Weather is
 * read just before the transaction through `GetGardenWeather` —
 * integrations' own exported read surface, the `GetObservation` injection
 * precedent — because weather rows are append-only fetch facts a
 * transaction cannot make more consistent, and the evidence row pins the
 * exact record id consulted either way. With no weather provider
 * configured (today's reality) both reads return `noRecord`, and every
 * weather-dependent rule records a typed `weatherMissing` skip — the
 * documented degradation, never an invented value.
 *
 * No authorization, deliberately: this use case has no user-facing
 * transport — the same server-side posture `RefreshGardenWeather`
 * documents. The stage that first exposes evaluation to an actor adds
 * the authorization its surface needs.
 *
 * Source: architecture/recommendations-and-ai.md, sections "3.
 * Recommendation Pipeline", "5. Rule Engine", "19. Completion Criteria";
 * implementation-plan.md work package P7-RULE-01.
 */

import { ConflictError, InternalError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GetGardenWeather, GetGardenWeatherResult } from '../../integrations/public.js';
import type {
  PlantFact,
  GardenFacts,
  PriorCandidateFact,
  WeatherFact,
} from '../domain/garden-facts.js';
import type {
  RecommendationTarget,
  RecommendationUrgency,
} from '../domain/recommendation-candidate.js';
import { createRecommendationCandidate } from '../domain/recommendation-candidate.js';
import { supersedeRecommendationCandidate } from '../domain/recommendation-lifecycle.js';
import { createRecommendationPriorityFactors } from '../domain/recommendation-priority.js';
import { createRuleVersion } from '../domain/rule-version.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import type { RuleDecision } from '../domain/rule-evaluation.js';
import { evaluateGardenRules } from '../domain/rule-evaluation.js';
import type { StoredCandidateWithRule } from './recommendation-candidate-repository.js';
import type { RuleVersionIdMap } from './rule-version-repository.js';
import { ruleVersionIdentity } from './rule-version-repository.js';
import type {
  TasksRecommendationsTransactionContext,
  TasksRecommendationsUnitOfWork,
} from './tasks-recommendations-unit-of-work.js';

/** Page size for the in-transaction plant scan — a paging mechanic, not a tuning knob. */
const PLANT_PAGE_SIZE = 200;

export interface EvaluateGardenRecommendationsInput {
  readonly gardenId: Uuid;
}

export interface CreatedRecommendationSummary {
  readonly candidateId: Uuid;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly target: RecommendationTarget;
  readonly urgency: RecommendationUrgency;
  readonly priorityScore: number;
  /** The deterministic explanation, rendered at generation time. */
  readonly explanation: string;
  readonly supersededCandidateId: Uuid | null;
}

export interface EvaluateGardenRecommendationsResult {
  readonly gardenId: Uuid;
  readonly evaluatedAt: Date;
  /** The full decision trace — what observability counts and fixtures assert. */
  readonly decisions: readonly RuleDecision[];
  readonly createdCandidates: readonly CreatedRecommendationSummary[];
}

function toWeatherFact(result: GetGardenWeatherResult): WeatherFact {
  if (result.outcome === 'noRecord') {
    return { availability: 'missing' };
  }
  return {
    availability: 'available',
    weatherRecordId: result.record.id,
    kind: result.record.kind,
    freshness: result.freshness,
    effectiveAt: result.record.effectiveAt,
    measurements: result.record.measurements,
  };
}

function toPriorCandidateFact(stored: StoredCandidateWithRule): PriorCandidateFact {
  return {
    candidateId: stored.candidate.id,
    ruleKey: stored.ruleKey,
    ruleVersion: stored.ruleVersion,
    state: stored.candidate.state,
    revision: stored.candidate.revision,
    target: {
      kind: stored.candidate.targetKind,
      gardenAreaMapObjectId: stored.candidate.targetGardenAreaMapObjectId,
      plantId: stored.candidate.targetPlantId,
    },
    windowEnd: stored.candidate.windowEnd,
    createdAt: stored.candidate.createdAt,
  };
}

export class EvaluateGardenRecommendations {
  constructor(
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly catalog: RuleCatalog,
    private readonly getGardenWeather: GetGardenWeather,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: EvaluateGardenRecommendationsInput,
  ): Promise<EvaluateGardenRecommendationsResult> {
    const { gardenId } = input;
    const weatherObservation = toWeatherFact(
      await this.getGardenWeather.execute({ gardenId, kind: 'observation' }),
    );
    const weatherForecast = toWeatherFact(
      await this.getGardenWeather.execute({ gardenId, kind: 'forecast' }),
    );

    return this.unitOfWork.run(async (context) => {
      await context.recommendationCandidates.lockGardenForEvaluation(gardenId);
      const evaluatedAt = this.clock.now();

      const ruleVersionIds = await this.registerRuleVersions(context, evaluatedAt);
      const facts = await gatherGardenFacts(
        context,
        gardenId,
        evaluatedAt,
        weatherObservation,
        weatherForecast,
      );

      const liveStored = await context.recommendationCandidates.listLiveForGarden(gardenId);
      const latestStored =
        await context.recommendationCandidates.listLatestPerRuleAndTarget(gardenId);
      const liveById = new Map(liveStored.map((stored) => [stored.candidate.id, stored]));

      const plan = evaluateGardenRules(this.catalog, facts, {
        liveCandidates: liveStored.map(toPriorCandidateFact),
        latestPerRuleAndTarget: latestStored.map(toPriorCandidateFact),
      });

      const createdCandidates: CreatedRecommendationSummary[] = [];
      for (const planned of plan.plannedCandidates) {
        if (planned.supersedes !== null) {
          const prior = liveById.get(planned.supersedes.candidateId);
          if (prior === undefined) {
            throw new InternalError(
              'tasks_recommendations.evaluate_recommendations.superseded_not_loaded',
              `Candidate '${planned.supersedes.candidateId}' was planned for supersession but is not among the loaded live candidates.`,
            );
          }
          const transitioned = supersedeRecommendationCandidate(prior.candidate, evaluatedAt);
          const written = await context.recommendationCandidates.update(
            transitioned,
            planned.supersedes.expectedRevision,
          );
          if (!written) {
            // The advisory lock makes this unreachable from a concurrent
            // evaluation; reaching it means some other writer touched the
            // candidate mid-transaction — abort rather than fork history.
            throw new ConflictError(
              'tasks_recommendations.evaluate_recommendations.supersession_conflict',
              `Candidate '${prior.candidate.id}' changed concurrently while being superseded.`,
            );
          }
        }

        const candidateId = generateUuidV7();
        const versionId = ruleVersionIds.get(
          ruleVersionIdentity(planned.ruleKey, planned.ruleVersion),
        );
        if (versionId === undefined) {
          throw new InternalError(
            'tasks_recommendations.evaluate_recommendations.rule_version_unregistered',
            `Rule '${planned.ruleKey}' v${String(planned.ruleVersion)} produced a candidate but was never registered.`,
          );
        }
        const aggregate = createRecommendationCandidate({
          id: candidateId,
          gardenId,
          target: planned.target,
          rawCareCategory: planned.careCategory,
          ruleVersionId: versionId,
          ruleSafetyTier: planned.safetyTier,
          urgency: planned.urgency,
          windowStart: planned.windowStart,
          windowEnd: planned.windowEnd,
          supersedesCandidateId: planned.supersedes?.candidateId ?? null,
          evidence: planned.evidence.map((spec) => ({
            id: generateUuidV7(),
            kind: spec.kind,
            sourceObservationId: spec.sourceObservationId,
            sourceTaskId: spec.sourceTaskId,
            sourcePlantId: spec.sourcePlantId,
            sourceWeatherRecordId: spec.sourceWeatherRecordId,
            rawFactKey: spec.factKey,
            factValue: spec.factValue,
          })),
          now: evaluatedAt,
        });
        const factors = createRecommendationPriorityFactors(
          candidateId,
          planned.factors.map((factor) => ({
            id: generateUuidV7(),
            factorKind: factor.kind,
            factorValue: { contribution: factor.contribution, basis: factor.basis },
          })),
          evaluatedAt,
        );
        await context.recommendationCandidates.insertAggregate(aggregate, factors);

        createdCandidates.push({
          candidateId,
          ruleKey: planned.ruleKey,
          ruleVersion: planned.ruleVersion,
          target: planned.target,
          urgency: planned.urgency,
          priorityScore: planned.priorityScore,
          explanation: planned.explanation,
          supersededCandidateId: planned.supersedes?.candidateId ?? null,
        });
      }

      return { gardenId, evaluatedAt, decisions: plan.decisions, createdCandidates };
    });
  }

  /**
   * Registers every catalog version idempotently (same `(key, version)` =
   * no-op) and verifies the one content field the database also stores:
   * a stored tier disagreeing with the definition means rule content
   * changed without a version bump — a release defect, refused loudly.
   */
  private async registerRuleVersions(
    context: TasksRecommendationsTransactionContext,
    now: Date,
  ): Promise<RuleVersionIdMap> {
    const ids = new Map<string, Uuid>();
    for (const definition of this.catalog.allVersions()) {
      const stored = await context.ruleVersions.ensure(
        createRuleVersion({
          id: generateUuidV7(),
          rawRuleKey: definition.ruleKey,
          rawVersion: definition.version,
          safetyTier: definition.safetyTier,
          now,
        }),
      );
      if (stored.safetyTier !== definition.safetyTier) {
        throw new InternalError(
          'tasks_recommendations.evaluate_recommendations.rule_version_content_drift',
          `Rule '${definition.ruleKey}' v${String(definition.version)} is registered with safety tier '${stored.safetyTier}' but the catalog declares '${definition.safetyTier}': rule content changed without a version bump.`,
        );
      }
      ids.set(ruleVersionIdentity(definition.ruleKey, definition.version), stored.id);
    }
    return ids;
  }
}

/** Reads the garden's plants (all pages, id-ordered for deterministic engine input), observations, and open tasks with their origin rule keys resolved. */
async function gatherGardenFacts(
  context: TasksRecommendationsTransactionContext,
  gardenId: Uuid,
  evaluatedAt: Date,
  weatherObservation: WeatherFact,
  weatherForecast: WeatherFact,
): Promise<GardenFacts> {
  const plants: PlantFact[] = [];
  let cursor: string | null = null;
  do {
    const page = await context.plants.search(
      gardenId,
      { query: null, lifecycleStage: null, status: null, groupingKind: null },
      cursor,
      PLANT_PAGE_SIZE,
    );
    for (const plant of page.items) {
      plants.push({
        plantId: plant.id,
        displayName: plant.displayName,
        lifecycleStage: plant.lifecycleStage,
        status: plant.status,
        createdAt: plant.createdAt,
      });
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  plants.sort((a, b) => a.plantId.localeCompare(b.plantId));

  const observationEntries = await context.observations.listForGarden(gardenId);
  const observations = observationEntries.map((entry) => ({
    observationId: entry.observation.id,
    plantId: entry.observation.plantId,
    observedAt: entry.observation.observedAt,
  }));

  const openTasks = await context.tasks.listForGarden(gardenId, ['planned', 'suggested']);
  const originIds = openTasks
    .map((task) => task.originRecommendationId)
    .filter((id): id is Uuid => id !== null);
  const originCandidates = await context.recommendationCandidates.findWithRuleByIds(originIds);
  const ruleKeyByCandidateId = new Map(
    originCandidates.map((stored) => [stored.candidate.id, stored.ruleKey]),
  );

  return {
    gardenId,
    evaluatedAt,
    plants,
    observations,
    openTasks: openTasks.map((task) => ({
      taskId: task.id,
      target: {
        kind: task.targetKind,
        gardenAreaMapObjectId: task.targetGardenAreaMapObjectId,
        plantId: task.targetPlantId,
      },
      originRuleKey:
        task.originRecommendationId === null
          ? null
          : (ruleKeyByCandidateId.get(task.originRecommendationId) ?? null),
    })),
    weatherObservation,
    weatherForecast,
  };
}
