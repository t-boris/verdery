import { describe, expect, it } from 'vitest';
import { InternalError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { Plant } from '../../plants-inventory/public.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import { createLaunchRuleCatalog } from '../domain/rules/launch-rule-catalog.js';
import { GetTodayView } from './get-today-view.js';
import { seedRecommendationCandidate } from './recommendation-test-doubles.js';
import {
  FakeTasksRecommendationsUnitOfWork,
  authorizationDenying,
  authorizationGranting,
  createTasksRecommendationsFakes,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019a3000-0000-7000-8000-000000000001';
const PLANT_ID = '019a3000-0000-7000-8000-000000000002';
const PROFILE_ID = '019a3000-0000-7000-8000-000000000003';
const CANDIDATE_A = '019a3000-0000-7000-8000-00000000000a';
const CANDIDATE_B = '019a3000-0000-7000-8000-00000000000b';
const CANDIDATE_C = '019a3000-0000-7000-8000-00000000000c';
const NOW = new Date('2026-07-25T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: PLANT_ID,
    gardenId: GARDEN_ID,
    displayName: 'Cherry tomato',
    taxonomyReferenceId: null,
    varietyLabel: null,
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'ready_to_harvest',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId: PROFILE_ID,
    createdAt: new Date('2026-07-20T09:00:00Z'),
    updatedAt: new Date('2026-07-20T09:00:00Z'),
    ...overrides,
  };
}

function makeQuery(
  fakes: ReturnType<typeof createTasksRecommendationsFakes>,
  options: { authorized?: boolean; catalog?: RuleCatalog } = {},
): GetTodayView {
  return new GetTodayView(
    new FakeTasksRecommendationsUnitOfWork(fakes),
    options.authorized === false
      ? authorizationDenying()
      : authorizationGranting({
          id: 'membership-1',
          gardenId: GARDEN_ID,
          profileId: PROFILE_ID,
          role: 'viewer',
        }),
    options.catalog ?? createLaunchRuleCatalog(),
    fixedClock(NOW),
  );
}

describe('GetTodayView', () => {
  it('orders by the score re-derived from stored factors, resolves action title and target name, and returns evidence', async () => {
    const fakes = createTasksRecommendationsFakes({ plants: new Map([[PLANT_ID, plant()]]) });
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
      ruleKey: 'observation.routine-check-reminder',
      urgency: 'low',
      targetPlantId: PLANT_ID,
      factors: [
        { kind: 'urgency_window', contribution: 10 },
        { kind: 'plant_impact', contribution: 10 },
        { kind: 'confidence', contribution: 20 },
      ],
    });
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_B,
      gardenId: GARDEN_ID,
      ruleKey: 'lifecycle.harvest-readiness-check',
      targetPlantId: PLANT_ID,
      factors: [
        { kind: 'urgency_window', contribution: 30 },
        { kind: 'plant_impact', contribution: 25 },
        { kind: 'confidence', contribution: 20 },
      ],
    });

    const today = await makeQuery(fakes).execute(GARDEN_ID, PROFILE_ID, 10);

    expect(today.gardenId).toBe(GARDEN_ID);
    expect(today.generatedAt).toBe(NOW.toISOString());
    expect(today.items.map((item) => [item.id, item.priorityScore])).toEqual([
      [CANDIDATE_B, 75],
      [CANDIDATE_A, 40],
    ]);
    const [harvest] = today.items;
    expect(harvest).toMatchObject({
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 1,
      actionTitle: 'Check ripeness and harvest what is ready',
      explanation: 'Stored deterministic explanation.',
      targetDisplayName: 'Cherry tomato',
      state: 'presented',
    });
    expect(harvest?.priorityFactors.map((factor) => factor.kind).sort()).toEqual([
      'confidence',
      'plant_impact',
      'urgency_window',
    ]);
    expect(harvest?.evidence).toHaveLength(1);
    expect(harvest?.evidence[0]).toMatchObject({ factKey: 'seed.fact' });
  });

  it('marks first inclusion presented — revision bumped, presentedAt stamped — and leaves it untouched on the repeat read', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
      revision: 2,
    });

    const first = await makeQuery(fakes).execute(GARDEN_ID, PROFILE_ID, 10);
    expect(first.items[0]).toMatchObject({
      state: 'presented',
      revision: 3,
      presentedAt: NOW.toISOString(),
    });
    const stored = fakes.recommendationCandidates.candidates.get(CANDIDATE_A);
    expect(stored).toMatchObject({ state: 'presented', revision: 3, presentedAt: NOW });

    const second = await makeQuery(fakes).execute(GARDEN_ID, PROFILE_ID, 10);
    expect(second.items[0]).toMatchObject({ state: 'presented', revision: 3 });
    expect(fakes.recommendationCandidates.candidates.get(CANDIDATE_A)?.revision).toBe(3);
    // The whole read-mark cycle ran under the per-garden advisory lock both times.
    expect(fakes.recommendationCandidates.lockedGardenIds).toEqual([GARDEN_ID, GARDEN_ID]);
  });

  it('caps the set at the limit and never presents the candidates beyond it', async () => {
    const fakes = createTasksRecommendationsFakes();
    for (const [id, contribution] of [
      [CANDIDATE_A, 80],
      [CANDIDATE_B, 60],
      [CANDIDATE_C, 40],
    ] as const) {
      seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
        id,
        gardenId: GARDEN_ID,
        factors: [{ kind: 'urgency_window', contribution }],
      });
    }

    const today = await makeQuery(fakes).execute(GARDEN_ID, PROFILE_ID, 2);

    expect(today.items.map((item) => item.id)).toEqual([CANDIDATE_A, CANDIDATE_B]);
    expect(fakes.recommendationCandidates.candidates.get(CANDIDATE_C)).toMatchObject({
      state: 'eligible',
      presentedAt: null,
    });
  });

  it('excludes out-of-window and legacy generated candidates', async () => {
    const fakes = createTasksRecommendationsFakes();
    // Window already passed.
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
      windowEnd: new Date(NOW.getTime() - 1),
    });
    // Window not yet open.
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_B,
      gardenId: GARDEN_ID,
      windowStart: new Date(NOW.getTime() + DAY_MS),
      windowEnd: new Date(NOW.getTime() + 2 * DAY_MS),
    });
    // A legacy pre-P7-BE-01 row: still `generated`, no stored explanation.
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_C,
      gardenId: GARDEN_ID,
      state: 'generated',
      explanation: null,
      revision: 1,
    });

    const today = await makeQuery(fakes).execute(GARDEN_ID, PROFILE_ID, 10);
    expect(today.items).toEqual([]);
  });

  it('fails loudly when a candidate pins a rule version this build does not ship', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 99,
    });

    await expect(makeQuery(fakes).execute(GARDEN_ID, PROFILE_ID, 10)).rejects.toThrow(
      InternalError,
    );
  });

  it('rejects a caller with no membership on the garden, concealing it as not found', async () => {
    const fakes = createTasksRecommendationsFakes();
    await expect(
      makeQuery(fakes, { authorized: false }).execute(GARDEN_ID, PROFILE_ID, 10),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
