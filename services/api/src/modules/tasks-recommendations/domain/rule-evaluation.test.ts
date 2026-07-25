import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { GardenFacts, WeatherFact } from './garden-facts.js';
import type { RecommendationTarget } from './recommendation-candidate.js';
import type { RuleDefinition, RuleTargetEvaluation } from './rule-definition.js';
import { RuleCatalog } from './rule-catalog.js';
import {
  buildGardenFacts,
  buildPriorCandidateFact,
  buildRuleDefinition,
  noPriorState,
  TEST_EVALUATED_AT,
} from './rule-engine-test-support.js';
import { evaluateGardenRules, TASK_OVERLAP_CONTRIBUTION } from './rule-evaluation.js';

const GARDEN_TARGET: RecommendationTarget = {
  kind: 'garden',
  gardenAreaMapObjectId: null,
  plantId: null,
};
const CANDIDATE_ID = '019a0000-0000-7000-8000-00000000cccc';
const TASK_ID = '019a0000-0000-7000-8000-00000000dddd';

const AVAILABLE_WEATHER: WeatherFact = {
  availability: 'available',
  weatherRecordId: '019a0000-0000-7000-8000-00000000eeee',
  kind: 'observation',
  freshness: 'fresh',
  effectiveAt: new Date('2026-07-25T08:00:00Z'),
  measurements: {
    temperatureCelsius: 20,
    precipitationMm: 0,
    windSpeedMps: null,
    humidityPercent: null,
  },
};

function run(rule: RuleDefinition, facts: GardenFacts, prior = noPriorState()) {
  return evaluateGardenRules(new RuleCatalog([rule]), facts, prior);
}

describe('evaluateGardenRules — weather gate', () => {
  const weatherRule = (whenStale: 'skip' | 'useLabeledStale') =>
    buildRuleDefinition({
      weatherPolicy: { use: 'required', kind: 'observation', whenStale },
    });

  it('skips a weather-dependent rule with a typed reason when no record exists, recording nothing', () => {
    const plan = run(weatherRule('skip'), buildGardenFacts());
    expect(plan.plannedCandidates).toEqual([]);
    expect(plan.decisions).toEqual([
      {
        kind: 'ruleSkipped',
        ruleKey: 'test.rule',
        ruleVersion: 1,
        reason: { kind: 'weatherMissing', requiredKind: 'observation' },
      },
    ]);
  });

  it("skips on stale weather when the rule's policy says skip", () => {
    const facts = buildGardenFacts({
      weatherObservation: { ...AVAILABLE_WEATHER, freshness: 'stale' },
    });
    const plan = run(weatherRule('skip'), facts);
    expect(plan.decisions[0]).toMatchObject({
      kind: 'ruleSkipped',
      reason: { kind: 'weatherStale', requiredKind: 'observation' },
    });
  });

  it("proceeds on stale weather when the rule's policy permits labeled use", () => {
    const facts = buildGardenFacts({
      weatherObservation: { ...AVAILABLE_WEATHER, freshness: 'stale' },
    });
    const plan = run(weatherRule('useLabeledStale'), facts);
    expect(plan.plannedCandidates).toHaveLength(1);
  });
});

describe('evaluateGardenRules — suppression and supersession', () => {
  it('suppresses on an open task provably converted from the same rule and target', () => {
    const facts = buildGardenFacts({
      openTasks: [{ taskId: TASK_ID, target: GARDEN_TARGET, originRuleKey: 'test.rule' }],
    });
    const plan = run(buildRuleDefinition(), facts);
    expect(plan.plannedCandidates).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      kind: 'targetSuppressed',
      reason: { kind: 'openTaskExists', taskId: TASK_ID },
    });
  });

  it('does NOT suppress on a manual open task — it applies the task-overlap penalty instead', () => {
    const facts = buildGardenFacts({
      openTasks: [{ taskId: TASK_ID, target: GARDEN_TARGET, originRuleKey: null }],
    });
    const plan = run(buildRuleDefinition(), facts);
    expect(plan.plannedCandidates).toHaveLength(1);
    const planned = plan.plannedCandidates[0];
    expect(planned?.factors).toContainEqual({
      kind: 'task_overlap',
      contribution: TASK_OVERLAP_CONTRIBUTION,
      basis: { openTaskIds: [TASK_ID] },
    });
    // 20 (rule confidence) - 15 (overlap) = 5.
    expect(planned?.priorityScore).toBe(5);
  });

  it('suppresses on a live candidate of the same rule version whose window has not passed', () => {
    const prior = {
      liveCandidates: [
        buildPriorCandidateFact({
          candidateId: CANDIDATE_ID,
          windowEnd: new Date(TEST_EVALUATED_AT.getTime() + 60_000),
        }),
      ],
      latestPerRuleAndTarget: [],
    };
    const plan = run(buildRuleDefinition(), buildGardenFacts(), prior);
    expect(plan.plannedCandidates).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      kind: 'targetSuppressed',
      reason: { kind: 'liveCandidateExists', candidateId: CANDIDATE_ID },
    });
  });

  it('supersedes a live candidate produced by an OLDER rule version', () => {
    const rule = buildRuleDefinition({ version: 2 });
    const prior = {
      liveCandidates: [
        buildPriorCandidateFact({
          candidateId: CANDIDATE_ID,
          ruleVersion: 1,
          revision: 3,
          windowEnd: new Date(TEST_EVALUATED_AT.getTime() + 60_000),
        }),
      ],
      latestPerRuleAndTarget: [],
    };
    const plan = run(rule, buildGardenFacts(), prior);
    expect(plan.plannedCandidates[0]?.supersedesLiveCandidate).toEqual({
      candidateId: CANDIDATE_ID,
      expectedRevision: 3,
    });
    expect(plan.decisions[0]).toMatchObject({
      kind: 'fire',
      supersedesCandidateId: CANDIDATE_ID,
    });
  });

  it('supersedes a live candidate whose validity window passed while the condition persists, exempt from recurrence', () => {
    const stale = buildPriorCandidateFact({
      candidateId: CANDIDATE_ID,
      windowEnd: new Date(TEST_EVALUATED_AT.getTime() - 1),
      // Created recently enough that recurrence WOULD suppress, proving
      // the supersession exemption.
      createdAt: new Date(TEST_EVALUATED_AT.getTime() - 60_000),
    });
    const plan = run(buildRuleDefinition(), buildGardenFacts(), {
      liveCandidates: [stale],
      latestPerRuleAndTarget: [stale],
    });
    expect(plan.plannedCandidates[0]?.supersedesLiveCandidate?.candidateId).toBe(CANDIDATE_ID);
  });

  it('suppresses within the recurrence interval of the latest (resolved) candidate', () => {
    const completed = buildPriorCandidateFact({
      candidateId: CANDIDATE_ID,
      state: 'completed',
      createdAt: new Date(TEST_EVALUATED_AT.getTime() - 60_000),
    });
    const plan = run(buildRuleDefinition(), buildGardenFacts(), {
      liveCandidates: [],
      latestPerRuleAndTarget: [completed],
    });
    expect(plan.plannedCandidates).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      kind: 'targetSuppressed',
      reason: {
        kind: 'withinRecurrenceInterval',
        priorCandidateId: CANDIDATE_ID,
        priorCreatedAt: completed.createdAt,
      },
    });
  });

  it('fires again once the recurrence interval has fully elapsed', () => {
    const rule = buildRuleDefinition();
    const longAgo = buildPriorCandidateFact({
      candidateId: CANDIDATE_ID,
      state: 'completed',
      createdAt: new Date(TEST_EVALUATED_AT.getTime() - rule.timing.recurrenceIntervalMs),
    });
    const plan = run(rule, buildGardenFacts(), {
      liveCandidates: [],
      latestPerRuleAndTarget: [longAgo],
    });
    expect(plan.plannedCandidates).toHaveLength(1);
    expect(plan.plannedCandidates[0]?.supersedesLiveCandidate).toBeNull();
  });
});

describe('evaluateGardenRules — priority, window, explanation', () => {
  it('clamps the priority score into [0, 100]', () => {
    const overloaded = buildRuleDefinition({
      evaluate: () => ({
        outcome: 'evaluated',
        targets: [
          {
            outcome: 'eligible',
            target: GARDEN_TARGET,
            evidence: [
              {
                kind: 'garden_context',
                sourceObservationId: null,
                sourceTaskId: null,
                sourcePlantId: null,
                sourceWeatherRecordId: null,
                factKey: 'garden.context',
                factValue: null,
              },
            ],
            factors: [
              { kind: 'urgency_window', contribution: 90, basis: {} },
              { kind: 'plant_impact', contribution: 90, basis: {} },
            ],
            explanationFacts: { 'garden.name': 'Test garden' },
            windowEnd: null,
          },
        ],
      }),
    });
    const plan = run(overloaded, buildGardenFacts());
    expect(plan.plannedCandidates[0]?.priorityScore).toBe(100);
  });

  it('derives the default window from timing and honors a fact-derived override', () => {
    const defaultPlan = run(buildRuleDefinition(), buildGardenFacts());
    expect(defaultPlan.plannedCandidates[0]?.windowStart).toEqual(TEST_EVALUATED_AT);
    expect(defaultPlan.plannedCandidates[0]?.windowEnd).toEqual(
      new Date(TEST_EVALUATED_AT.getTime() + 24 * 60 * 60 * 1000),
    );

    const overrideEnd = new Date(TEST_EVALUATED_AT.getTime() + 5 * 60_000);
    const overridden = buildRuleDefinition({
      evaluate: () => ({
        outcome: 'evaluated',
        targets: [eligibleTarget({ windowEnd: overrideEnd })],
      }),
    });
    expect(run(overridden, buildGardenFacts()).plannedCandidates[0]?.windowEnd).toEqual(
      overrideEnd,
    );
  });

  it('renders the deterministic explanation on every fired candidate', () => {
    const plan = run(buildRuleDefinition(), buildGardenFacts());
    expect(plan.plannedCandidates[0]?.explanation).toBe('Test explanation for Test garden.');
  });

  it('produces deeply equal output for the same inputs, run twice', () => {
    const rule = buildRuleDefinition();
    const facts = buildGardenFacts({
      openTasks: [{ taskId: TASK_ID, target: GARDEN_TARGET, originRuleKey: null }],
    });
    expect(run(rule, facts)).toEqual(run(rule, facts));
  });
});

function eligibleTarget(
  overrides: Partial<Extract<RuleTargetEvaluation, { outcome: 'eligible' }>>,
): RuleTargetEvaluation {
  return {
    outcome: 'eligible',
    target: GARDEN_TARGET,
    evidence: [
      {
        kind: 'garden_context',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: null,
        sourceWeatherRecordId: null,
        factKey: 'garden.context',
        factValue: null,
      },
    ],
    factors: [{ kind: 'confidence', contribution: 20, basis: {} }],
    explanationFacts: { 'garden.name': 'Test garden' },
    windowEnd: null,
    ...overrides,
  };
}

describe('evaluateGardenRules — rule defects fail loudly', () => {
  it('rejects an eligible target missing a required evidence kind', () => {
    const rule = buildRuleDefinition({ requiredEvidenceKinds: ['weather'] });
    expect(() => run(rule, buildGardenFacts())).toThrowError(InternalError);
  });

  it('rejects a rule contributing the engine-owned task_overlap factor', () => {
    const rule = buildRuleDefinition({
      evaluate: () => ({
        outcome: 'evaluated',
        targets: [
          eligibleTarget({
            factors: [{ kind: 'task_overlap', contribution: -5, basis: {} }],
          }),
        ],
      }),
    });
    expect(() => run(rule, buildGardenFacts())).toThrowError(InternalError);
  });

  it('rejects duplicate factor kinds and duplicate targets', () => {
    const duplicateFactors = buildRuleDefinition({
      evaluate: () => ({
        outcome: 'evaluated',
        targets: [
          eligibleTarget({
            factors: [
              { kind: 'confidence', contribution: 10, basis: {} },
              { kind: 'confidence', contribution: 10, basis: {} },
            ],
          }),
        ],
      }),
    });
    expect(() => run(duplicateFactors, buildGardenFacts())).toThrowError(InternalError);

    const duplicateTargets = buildRuleDefinition({
      evaluate: () => ({
        outcome: 'evaluated',
        targets: [eligibleTarget({}), eligibleTarget({})],
      }),
    });
    expect(() => run(duplicateTargets, buildGardenFacts())).toThrowError(InternalError);
  });

  it('rejects a derived window ending at or before its start', () => {
    const rule = buildRuleDefinition({
      evaluate: () => ({
        outcome: 'evaluated',
        targets: [eligibleTarget({ windowEnd: TEST_EVALUATED_AT })],
      }),
    });
    expect(() => run(rule, buildGardenFacts())).toThrowError(InternalError);
  });
});

describe('evaluateGardenRules — postponed prior (P7-BE-01)', () => {
  it('suppresses until the user’s own postponedUntil horizon, even past the recurrence interval', () => {
    const rule = buildRuleDefinition();
    const resurfaceAt = new Date(TEST_EVALUATED_AT.getTime() + 60_000);
    const postponed = buildPriorCandidateFact({
      candidateId: CANDIDATE_ID,
      state: 'postponed',
      // Created long enough ago that plain recurrence would have elapsed —
      // proving the horizon, not the interval, is the boundary.
      createdAt: new Date(TEST_EVALUATED_AT.getTime() - 2 * rule.timing.recurrenceIntervalMs),
      postponedUntil: resurfaceAt,
    });
    const plan = run(rule, buildGardenFacts(), {
      liveCandidates: [],
      latestPerRuleAndTarget: [postponed],
    });
    expect(plan.plannedCandidates).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      kind: 'targetSuppressed',
      reason: {
        kind: 'postponedAwaitingResurface',
        priorCandidateId: CANDIDATE_ID,
        resurfaceAt,
      },
    });
  });

  it('re-surfaces past the horizon as a NEW candidate referencing the postponed record WITHOUT transitioning it', () => {
    const rule = buildRuleDefinition();
    const postponed = buildPriorCandidateFact({
      candidateId: CANDIDATE_ID,
      state: 'postponed',
      // Recent enough that plain recurrence WOULD still suppress — the
      // user's elapsed horizon wins in this direction too.
      createdAt: new Date(TEST_EVALUATED_AT.getTime() - 60_000),
      postponedUntil: new Date(TEST_EVALUATED_AT.getTime() - 1),
    });
    const plan = run(rule, buildGardenFacts(), {
      liveCandidates: [],
      latestPerRuleAndTarget: [postponed],
    });
    expect(plan.plannedCandidates).toHaveLength(1);
    expect(plan.plannedCandidates[0]?.supersedesCandidateId).toBe(CANDIDATE_ID);
    // Reference only: the postponed prior is terminal, so no live-prior
    // transition is planned.
    expect(plan.plannedCandidates[0]?.supersedesLiveCandidate).toBeNull();
  });

  it('falls back to the recurrence interval for a horizon-less postponement — no horizon is invented', () => {
    const rule = buildRuleDefinition();
    const postponed = buildPriorCandidateFact({
      candidateId: CANDIDATE_ID,
      state: 'postponed',
      createdAt: new Date(TEST_EVALUATED_AT.getTime() - 60_000),
      postponedUntil: null,
    });
    const plan = run(rule, buildGardenFacts(), {
      liveCandidates: [],
      latestPerRuleAndTarget: [postponed],
    });
    expect(plan.plannedCandidates).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      kind: 'targetSuppressed',
      reason: {
        kind: 'postponedAwaitingResurface',
        priorCandidateId: CANDIDATE_ID,
        resurfaceAt: new Date(
          TEST_EVALUATED_AT.getTime() - 60_000 + rule.timing.recurrenceIntervalMs,
        ),
      },
    });
  });
});
