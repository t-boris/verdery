import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { RecommendationCandidate } from '../domain/recommendation-candidate.js';
import type { EvaluateGardenRecommendationsResult } from './evaluate-garden-recommendations.js';
import type { EvaluationGardenSource } from './evaluation-garden-source.js';
import type { GardenRecommendationEvaluator } from './run-recommendation-evaluation-sweep.js';
import {
  EVALUATION_SWEEP_PAGE_SIZE,
  RunRecommendationEvaluationSweep,
} from './run-recommendation-evaluation-sweep.js';
import {
  createTasksRecommendationsFakes,
  FakeTasksRecommendationsUnitOfWork,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';
import type { TasksRecommendationsFakes } from './tasks-recommendations-test-doubles.js';

const NOW = new Date('2026-07-25T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const GARDEN_A = '018f0000-0000-7000-8000-00000000000a';
const GARDEN_B = '018f0000-0000-7000-8000-00000000000b';

/** Serves one fixed eligible set through real keyset paging, so the sweep's own pagination is exercised. */
function pagedSource(ids: readonly Uuid[]): EvaluationGardenSource & { pageRequests: number } {
  const sorted = [...ids].sort();
  const source = {
    pageRequests: 0,
    listEligibleGardenIds(afterGardenId: Uuid | null, limit: number): Promise<readonly Uuid[]> {
      source.pageRequests += 1;
      const start = afterGardenId === null ? 0 : sorted.findIndex((id) => id > afterGardenId);
      const from = start === -1 ? sorted.length : start;
      return Promise.resolve(sorted.slice(from, from + limit));
    },
  };
  return source;
}

function evaluationResult(
  gardenId: Uuid,
  created: readonly { supersededCandidateId: Uuid | null }[],
): EvaluateGardenRecommendationsResult {
  return {
    gardenId,
    evaluatedAt: NOW,
    decisions: [],
    createdCandidates: created.map((item, index) => ({
      candidateId: `018f0000-0000-7000-8000-10000000000${String(index)}`,
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 1,
      target: { kind: 'garden', gardenAreaMapObjectId: null, plantId: null },
      urgency: 'high',
      priorityScore: 75,
      explanation: 'explanation',
      supersededCandidateId: item.supersededCandidateId,
    })),
  };
}

function evaluator(
  behavior: Readonly<Record<string, EvaluateGardenRecommendationsResult | ConflictError>>,
): GardenRecommendationEvaluator & { calls: Uuid[] } {
  const calls: Uuid[] = [];
  return {
    calls,
    execute({ gardenId }): Promise<EvaluateGardenRecommendationsResult> {
      calls.push(gardenId);
      const scripted = behavior[gardenId];
      if (scripted === undefined) {
        throw new Error(`No scripted evaluation for garden ${gardenId}`);
      }
      if (scripted instanceof ConflictError) {
        return Promise.reject(scripted);
      }
      return Promise.resolve(scripted);
    },
  };
}

function seedLiveCandidate(
  fakes: TasksRecommendationsFakes,
  gardenId: Uuid,
  windowEnd: Date | null,
): RecommendationCandidate {
  const ruleVersionId = '018f0000-0000-7000-8000-200000000000';
  fakes.ruleVersions.rows.set(ruleVersionId, {
    id: ruleVersionId,
    ruleKey: 'lifecycle.harvest-readiness-check',
    version: 1,
    safetyTier: 'ordinary_care',
    createdAt: new Date(NOW.getTime() - 10 * DAY_MS),
  });
  const candidate: RecommendationCandidate = {
    id: randomUUID(),
    gardenId,
    targetKind: 'garden',
    targetGardenAreaMapObjectId: null,
    targetPlantId: null,
    careCategory: 'harvest',
    ruleVersionId,
    safetyTier: 'ordinary_care',
    state: 'generated',
    urgency: 'high',
    windowStart: new Date(NOW.getTime() - 10 * DAY_MS),
    windowEnd,
    primaryEvidenceId: randomUUID(),
    supersedesCandidateId: null,
    presentedAt: null,
    revision: 1,
    createdAt: new Date(NOW.getTime() - 10 * DAY_MS),
    updatedAt: new Date(NOW.getTime() - 10 * DAY_MS),
  };
  fakes.recommendationCandidates.candidates.set(candidate.id, candidate);
  return candidate;
}

function buildSweep(
  source: EvaluationGardenSource,
  evaluate: GardenRecommendationEvaluator,
  fakes: TasksRecommendationsFakes,
): RunRecommendationEvaluationSweep {
  return new RunRecommendationEvaluationSweep(
    source,
    evaluate,
    new FakeTasksRecommendationsUnitOfWork(fakes),
    fixedClock(NOW),
  );
}

describe('RunRecommendationEvaluationSweep', () => {
  it('evaluates every eligible garden and aggregates created/superseded counts', async () => {
    const fakes = createTasksRecommendationsFakes();
    const source = pagedSource([GARDEN_A, GARDEN_B]);
    const evaluate = evaluator({
      [GARDEN_A]: evaluationResult(GARDEN_A, [
        { supersededCandidateId: null },
        { supersededCandidateId: '018f0000-0000-7000-8000-300000000000' },
      ]),
      [GARDEN_B]: evaluationResult(GARDEN_B, []),
    });

    const result = await buildSweep(source, evaluate, fakes).execute();

    expect(evaluate.calls).toEqual([GARDEN_A, GARDEN_B]);
    expect(result).toEqual({
      gardensEvaluated: 2,
      candidatesCreated: 2,
      candidatesSuperseded: 1,
      candidatesExpired: 0,
      lostRaces: 0,
    });
  });

  it('drains the whole eligible set through keyset pages, never capping the run', async () => {
    const gardenIds = Array.from(
      { length: EVALUATION_SWEEP_PAGE_SIZE + 3 },
      (_, index) => `018f0000-0000-7000-8000-4000000000${String(index).padStart(2, '0')}`,
    );
    const source = pagedSource(gardenIds);
    const evaluate = evaluator(
      Object.fromEntries(gardenIds.map((id) => [id, evaluationResult(id, [])])),
    );

    const result = await buildSweep(source, evaluate, createTasksRecommendationsFakes()).execute();

    expect(result.gardensEvaluated).toBe(gardenIds.length);
    expect(new Set(evaluate.calls).size).toBe(gardenIds.length);
    expect(source.pageRequests).toBe(2);
  });

  it('counts a supersession revision conflict as a lost race and keeps sweeping', async () => {
    const source = pagedSource([GARDEN_A, GARDEN_B]);
    const evaluate = evaluator({
      [GARDEN_A]: new ConflictError('tasks_recommendations.test.conflict', 'concurrent writer'),
      [GARDEN_B]: evaluationResult(GARDEN_B, []),
    });

    const result = await buildSweep(source, evaluate, createTasksRecommendationsFakes()).execute();

    expect(evaluate.calls).toEqual([GARDEN_A, GARDEN_B]);
    expect(result.gardensEvaluated).toBe(1);
    expect(result.lostRaces).toBe(1);
  });

  it('expires live candidates whose window passed, under the garden evaluation lock, after evaluation', async () => {
    const fakes = createTasksRecommendationsFakes();
    const passed = seedLiveCandidate(fakes, GARDEN_A, new Date(NOW.getTime() - DAY_MS));
    const stillOpen = seedLiveCandidate(fakes, GARDEN_A, new Date(NOW.getTime() + DAY_MS));
    const unbounded = seedLiveCandidate(fakes, GARDEN_A, null);

    const result = await buildSweep(pagedSource([]), evaluator({}), fakes).execute();

    expect(result.candidatesExpired).toBe(1);
    expect(fakes.recommendationCandidates.candidates.get(passed.id)?.state).toBe('expired');
    expect(fakes.recommendationCandidates.candidates.get(passed.id)?.revision).toBe(2);
    expect(fakes.recommendationCandidates.candidates.get(stillOpen.id)?.state).toBe('generated');
    expect(fakes.recommendationCandidates.candidates.get(unbounded.id)?.state).toBe('generated');
    // The expiry phase serialized on the same per-garden lock evaluation uses.
    expect(fakes.recommendationCandidates.lockedGardenIds).toEqual([GARDEN_A]);
  });

  it('a second run over unchanged state is a no-op — nothing left to expire, nothing evaluated twice into duplicates', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedLiveCandidate(fakes, GARDEN_A, new Date(NOW.getTime() - DAY_MS));
    const sweep = buildSweep(pagedSource([]), evaluator({}), fakes);

    const first = await sweep.execute();
    const second = await sweep.execute();

    expect(first.candidatesExpired).toBe(1);
    expect(second).toEqual({
      gardensEvaluated: 0,
      candidatesCreated: 0,
      candidatesSuperseded: 0,
      candidatesExpired: 0,
      lostRaces: 0,
    });
  });
});
