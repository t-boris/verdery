/**
 * Evaluates the launch rule catalog against one garden and persists the
 * outcome: new recommendation candidates (with evidence and priority
 * factors) and `superseded` transitions on the stale candidates they
 * replace — the transactional shell around the pure
 * `evaluateGardenRules` engine.
 *
 * Called by the scheduled recommendation sweep (P7-ASYNC-01,
 * `run-recommendation-evaluation-sweep.ts`) per eligible garden; the Today
 * surface (P7-BE-01) may additionally call it on demand. It is IDEMPOTENT
 * per evaluation
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
 * Hemisphere (P9D-SEASON-DATA-01) is read the SAME way, for the SAME
 * reason: `gardens_mapping.georeference` is another module's read-only
 * fact from this module's side (see `GeoreferenceRepository`'s own header,
 * "none of the thirteen map commands mutate georeferencing") that a
 * transaction over THIS module's own tables cannot make any more
 * consistent, so it is fetched before the transaction via
 * `GeoreferenceRepository.findCurrentForGarden` (gardens-mapping's own
 * public port) and derived with `deriveHemisphere`, then threaded into
 * `gatherGardenFacts` exactly like `weatherObservation`/`weatherForecast`
 * are. NOTE ON THE DESIGN RECORD: tasks/todo.md's own design notes name
 * `KyselyEvaluationGardenSource` as where this wiring happens; that class
 * only ever selects ELIGIBLE GARDEN IDS for the sweep
 * (`EvaluationGardenSource.listEligibleGardenIds`) and has no access to a
 * single garden's `GardenFacts` at all, so that reference cannot be
 * literal. This file, the one place `GardenFacts` is actually assembled, is
 * the most conservative, most consistent-with-existing-pattern resolution:
 * it mirrors weather's own already-established fetch-then-thread shape
 * exactly, rather than inventing a new one.
 *
 * Seasonal facts and bed-occupancy history (P9D-SEASON-RULES-01) are
 * gathered INSIDE the transaction too, via three more `plants-inventory`
 * read ports now bound on `TasksRecommendationsTransactionContext`
 * (`taxonomyReferences`, `taxonomySeasonalFacts`, `bedOccupancyHistory`) —
 * see that interface's own header for why this is the `plants`/
 * `observations` in-transaction shape, NOT weather/hemisphere's
 * pre-transaction fetch-then-thread shape, despite both being facts from
 * modules THIS module does not own. In short: these are per-plant/per-bed
 * queries whose inputs are only known once the plant list itself has been
 * read (which happens inside the transaction already), and their values
 * are quoted verbatim as `seasonal_calendar` evidence, so they need the
 * same snapshot consistency `observations` already gets.
 *
 * `PlantFact.taxonomyReferenceId`/`gardenAreaMapObjectId`: both already
 * exist on the `Plant` record this function reads per plant (see
 * `plants-inventory/domain/plant.ts`); this is threading an existing value
 * through, the same way every other `PlantFact` field already does, not a
 * new query.
 *
 * No authorization, deliberately: this use case has no user-facing
 * transport — the same server-side posture `RefreshGardenWeather`
 * documents. The stage that first exposes evaluation to an actor adds
 * the authorization its surface needs.
 *
 * Outbox emission (P7-ASYNC-01): one `recommendation.candidate_created`
 * event per created candidate, appended in the SAME transaction as the
 * candidate insert — notifications.md section 5's flow begins at "domain
 * event", and the outbox is how the commit "cannot silently lose its
 * publication intent". No consumer claims the type yet (P7-NOTIF-01 owns
 * that); see the contract's own header
 * (`@verdery/api-contracts`' `recommendation-events.ts`) for why emitting
 * now, unclaimed, is the honest ordering.
 *
 * Source: architecture/recommendations-and-ai.md, sections "3.
 * Recommendation Pipeline", "5. Rule Engine", "19. Completion Criteria";
 * implementation-plan.md work package P7-RULE-01.
 */

import {
  RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
  type RecommendationCandidateCreatedEventPayload,
} from '@verdery/api-contracts';
import { ConflictError, InternalError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GeoreferenceRepository } from '../../gardens-mapping/public.js';
import type { GetGardenWeather, GetGardenWeatherResult } from '../../integrations/public.js';
import type {
  PlantFact,
  GardenFacts,
  Hemisphere,
  PriorCandidateFact,
  WeatherFact,
} from '../domain/garden-facts.js';
import { deriveHemisphere } from '../domain/garden-facts.js';
import type {
  RecommendationTarget,
  RecommendationUrgency,
} from '../domain/recommendation-candidate.js';
import { createRecommendationCandidate } from '../domain/recommendation-candidate.js';
import {
  markRecommendationCandidateEligible,
  supersedeRecommendationCandidate,
} from '../domain/recommendation-lifecycle.js';
import { createRecommendationPriorityFactors } from '../domain/recommendation-priority.js';
import { createRuleVersion } from '../domain/rule-version.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import type { RuleDecision } from '../domain/rule-evaluation.js';
import { evaluateGardenRules } from '../domain/rule-evaluation.js';
import { gatherPriorBedOccupants, gatherTaxonomyFacts } from './gather-seasonal-facts.js';
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
  /** The stored backward reference: a replaced live prior, or a re-surfaced postponed prior (P7-BE-01). */
  readonly supersedesCandidateId: Uuid | null;
  /** `true` when the referenced prior was live and transitioned to `superseded` in this evaluation; `false` for a postponed re-surface (the prior is terminal and untouched) and for unlinked candidates. */
  readonly supersededLivePrior: boolean;
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
    postponedUntil: stored.postponedUntil,
  };
}

export class EvaluateGardenRecommendations {
  constructor(
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly catalog: RuleCatalog,
    private readonly getGardenWeather: GetGardenWeather,
    private readonly georeferenceRepository: GeoreferenceRepository,
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
    const georeference = await this.georeferenceRepository.findCurrentForGarden(gardenId);
    const hemisphere: Hemisphere | null = deriveHemisphere(georeference?.geographicAnchor ?? null);

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
        hemisphere,
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
        if (planned.supersedesLiveCandidate !== null) {
          const prior = liveById.get(planned.supersedesLiveCandidate.candidateId);
          if (prior === undefined) {
            throw new InternalError(
              'tasks_recommendations.evaluate_recommendations.superseded_not_loaded',
              `Candidate '${planned.supersedesLiveCandidate.candidateId}' was planned for supersession but is not among the loaded live candidates.`,
            );
          }
          const transitioned = supersedeRecommendationCandidate(prior.candidate, evaluatedAt);
          const written = await context.recommendationCandidates.update(
            transitioned,
            planned.supersedesLiveCandidate.expectedRevision,
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
          rawExplanation: planned.explanation,
          ruleVersionId: versionId,
          ruleSafetyTier: planned.safetyTier,
          urgency: planned.urgency,
          windowStart: planned.windowStart,
          windowEnd: planned.windowEnd,
          supersedesCandidateId: planned.supersedesCandidateId,
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
        // The engine's own section-3 eligibility and safety filters passed
        // by the moment this candidate was planned, so the persisted row
        // records that already-decided outcome (P7-DATA-01's lifecycle
        // comment names the engine as exactly this transition's decider):
        // candidates land `eligible`, the state the Today surface
        // (P7-BE-01) reads. `generated` remains the in-construction state.
        const eligible = markRecommendationCandidateEligible(aggregate.candidate, evaluatedAt);
        const factors = createRecommendationPriorityFactors(
          candidateId,
          planned.factors.map((factor) => ({
            id: generateUuidV7(),
            factorKind: factor.kind,
            factorValue: { contribution: factor.contribution, basis: factor.basis },
          })),
          evaluatedAt,
        );
        await context.recommendationCandidates.insertAggregate(
          { candidate: eligible, evidence: aggregate.evidence },
          factors,
        );

        // Same transaction as the candidate insert — see the header comment.
        const eventPayload: RecommendationCandidateCreatedEventPayload = {
          candidateId,
          gardenId,
          ruleKey: planned.ruleKey,
          ruleVersion: planned.ruleVersion,
          targetKind: planned.target.kind,
          targetPlantId: planned.target.plantId,
          targetGardenAreaMapObjectId: planned.target.gardenAreaMapObjectId,
          urgency: planned.urgency,
          priorityScore: planned.priorityScore,
          windowStart: planned.windowStart.toISOString(),
          windowEnd: planned.windowEnd.toISOString(),
          supersedesCandidateId: planned.supersedesCandidateId,
        };
        await context.outbox.append({
          eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
          aggregateType: 'recommendation_candidate',
          aggregateId: candidateId,
          payload: eventPayload,
        });

        createdCandidates.push({
          candidateId,
          ruleKey: planned.ruleKey,
          ruleVersion: planned.ruleVersion,
          target: planned.target,
          urgency: planned.urgency,
          priorityScore: planned.priorityScore,
          explanation: planned.explanation,
          supersedesCandidateId: planned.supersedesCandidateId,
          supersededLivePrior: planned.supersedesLiveCandidate !== null,
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

/** Reads the garden's plants (all pages, id-ordered for deterministic engine input), observations, open tasks with their origin rule keys resolved, and the P9D-SEASON-RULES-01 taxonomy/bed-occupancy facts those plants' own taxa and placements justify. */
async function gatherGardenFacts(
  context: TasksRecommendationsTransactionContext,
  gardenId: Uuid,
  evaluatedAt: Date,
  weatherObservation: WeatherFact,
  weatherForecast: WeatherFact,
  hemisphere: Hemisphere | null,
): Promise<GardenFacts> {
  const plants: PlantFact[] = [];
  let cursor: string | null = null;
  do {
    const page = await context.plants.search(
      gardenId,
      { query: null, lifecycleStage: null, status: null, groupingKind: null, identified: null },
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
        // P9D-SEASON-RULES-01: both already present on the `Plant` record
        // just read above — see this file's own header for why this is a
        // thread-through, not a new query.
        taxonomyReferenceId: plant.taxonomyReferenceId,
        gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
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

  const taxonomyFacts = await gatherTaxonomyFacts(context, plants, hemisphere);
  const priorBedOccupants = await gatherPriorBedOccupants(
    context,
    plants,
    taxonomyFacts,
    evaluatedAt,
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
    hemisphere,
    taxonomyFacts,
    priorBedOccupants,
  };
}
