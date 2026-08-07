/**
 * Shared builders for rule-engine tests and the reviewable fixture suite
 * (`tests/rule-fixtures/`): minimal valid facts, prior-state entries, and
 * a synthetic rule definition with every field overridable. Not a
 * `*.test.ts` file — vitest never runs it as a suite; it exists only to be
 * imported by ones that do (the `tasks-recommendations-test-doubles.ts`
 * convention, applied to the domain layer).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenFacts,
  PlantFact,
  PriorCandidateFact,
  PriorRecommendationState,
} from './garden-facts.js';
import type { RuleDefinition } from './rule-definition.js';

export const TEST_GARDEN_ID = '019a0000-0000-7000-8000-00000000aaaa';
export const TEST_EVALUATED_AT = new Date('2026-07-25T09:00:00Z');

export function buildPlantFact(overrides: Partial<PlantFact> & { plantId: Uuid }): PlantFact {
  return {
    displayName: 'Cherry tomato',
    lifecycleStage: 'growing',
    status: 'active',
    createdAt: new Date('2026-05-01T08:00:00Z'),
    // P9D-SEASON-RULES-01: unknown by default, matching `fixture-support
    // .ts`'s own `plantFact` convention.
    taxonomyReferenceId: null,
    gardenAreaMapObjectId: null,
    ...overrides,
  };
}

/** A garden with no plants, observations, tasks, or weather — every field overridable. */
export function buildGardenFacts(overrides: Partial<GardenFacts> = {}): GardenFacts {
  return {
    gardenId: TEST_GARDEN_ID,
    evaluatedAt: TEST_EVALUATED_AT,
    plants: [],
    observations: [],
    openTasks: [],
    completedTasks: [],
    weatherObservation: { availability: 'missing' },
    weatherForecast: { availability: 'missing' },
    recentPrecipitation: null,
    hemisphere: null,
    taxonomyFacts: [],
    priorBedOccupants: [],
    ...overrides,
  };
}

export function noPriorState(): PriorRecommendationState {
  return { liveCandidates: [], latestPerRuleAndTarget: [] };
}

export function buildPriorCandidateFact(
  overrides: Partial<PriorCandidateFact> & { candidateId: Uuid },
): PriorCandidateFact {
  return {
    ruleKey: 'test.rule',
    ruleVersion: 1,
    state: 'generated',
    revision: 1,
    target: { kind: 'garden', gardenAreaMapObjectId: null, plantId: null },
    windowEnd: null,
    createdAt: new Date('2026-07-24T09:00:00Z'),
    postponedUntil: null,
    ...overrides,
  };
}

/**
 * A minimal valid synthetic rule: garden-targeted, weather-free, one
 * `garden_context` evidence row, one factor, a one-placeholder template.
 * Engine tests override the parts each case exercises.
 */
export function buildRuleDefinition(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    ruleKey: 'test.rule',
    version: 1,
    safetyTier: 'ordinary_care',
    careCategory: 'general_maintenance',
    actionTitle: 'Do the test action',
    description: 'A synthetic rule for engine tests.',
    urgency: 'normal',
    timing: { validityWindowMs: 24 * 60 * 60 * 1000, recurrenceIntervalMs: 48 * 60 * 60 * 1000 },
    weatherPolicy: { use: 'notUsed' },
    requiredEvidenceKinds: ['garden_context'],
    explanationTemplate: 'Test explanation for {garden.name}.',
    parameters: {},
    review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' },
    evaluate: () => ({
      outcome: 'evaluated',
      targets: [
        {
          outcome: 'eligible',
          target: { kind: 'garden', gardenAreaMapObjectId: null, plantId: null },
          evidence: [
            {
              kind: 'garden_context',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: null,
              sourceWeatherRecordId: null,
              factKey: 'garden.context',
              factValue: { note: 'test' },
            },
          ],
          factors: [{ kind: 'confidence', contribution: 20, basis: { source: 'test' } }],
          explanationFacts: { 'garden.name': 'Test garden' },
          windowEnd: null,
        },
      ],
    }),
    ...overrides,
  };
}
