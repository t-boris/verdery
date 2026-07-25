/**
 * Fixtures for `lifecycle.harvest-readiness-check` v1 — see README.md for
 * how to review. Covers: firing on the user-declared readiness stage,
 * TIMING suppression (a recently resolved candidate blocks regeneration
 * for the recurrence interval), the refire after that interval fully
 * elapses, and SUPERSESSION of a live candidate whose validity window
 * passed while readiness persists.
 */

import type { PlannedCandidate } from '../../src/modules/tasks-recommendations/public.js';
import type { RuleFixture } from './fixture-support.js';
import {
  DAY_MS,
  FIXTURE_NOW,
  PLANT_A_ID,
  PRIOR_CANDIDATE_A_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  priorCandidate,
  ruleSkippedDecision,
  suppressedDecision,
} from './fixture-support.js';

const BOTH_WEATHER_RULES_SKIP = [
  ruleSkippedDecision('watering.dry-spell-check', {
    kind: 'weatherMissing',
    requiredKind: 'observation',
  }),
  ruleSkippedDecision('weather.frost-watch', {
    kind: 'weatherMissing',
    requiredKind: 'forecast',
  }),
] as const;

const READY_PLANT = plantFact({ plantId: PLANT_A_ID, lifecycleStage: 'ready_to_harvest' });

function harvestCandidate(supersedes: PlannedCandidate['supersedes'] = null): PlannedCandidate {
  return {
    ruleKey: 'lifecycle.harvest-readiness-check',
    ruleVersion: 1,
    safetyTier: 'ordinary_care',
    careCategory: 'harvest',
    target: plantTarget(PLANT_A_ID),
    urgency: 'high',
    windowStart: FIXTURE_NOW,
    windowEnd: new Date(FIXTURE_NOW.getTime() + 5 * DAY_MS),
    evidence: [
      {
        kind: 'lifecycle_stage',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: PLANT_A_ID,
        sourceWeatherRecordId: null,
        factKey: 'plant.lifecycle_stage',
        factValue: { lifecycleStage: 'ready_to_harvest' },
      },
    ],
    factors: [
      {
        kind: 'urgency_window',
        contribution: 30,
        basis: { urgency: 'high', validityWindowDays: 5 },
      },
      {
        kind: 'plant_impact',
        contribution: 25,
        basis: { note: 'unharvested_readiness_loses_yield' },
      },
      {
        kind: 'confidence',
        contribution: 20,
        basis: { source: 'user_declared_lifecycle_stage' },
      },
    ],
    priorityScore: 75,
    explanation:
      'Cherry tomato is marked ready to harvest. Check ripeness and harvest what is ready ' +
      'before the window passes.',
    supersedes,
  };
}

const QUIET_OTHER_RULES = [
  notEligibleDecision('observation.routine-check-reminder', PLANT_A_ID, 'plant.recently_observed'),
] as const;

export const lifecycleHarvestReadinessCheckFixtures: readonly RuleFixture[] = [
  {
    name: 'fires a high-urgency harvest check for a plant the user marked ready to harvest',
    reviewNotes:
      'The user set the plant’s lifecycle stage to ready_to_harvest; the rule adds timing ' +
      'pressure (priority 75, 5-day window) without judging ripeness itself. Review: are the ' +
      '5-day validity window and 7-day recurrence interval sensible for a harvest nudge?',
    facts: gardenFacts({ plants: [READY_PLANT] }),
    prior: noPrior(),
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
        ...QUIET_OTHER_RULES,
        fireDecision('lifecycle.harvest-readiness-check', PLANT_A_ID, 75),
        BOTH_WEATHER_RULES_SKIP[1],
      ],
      plannedCandidates: [harvestCandidate()],
    },
  },
  {
    name: 'timing suppression: a candidate resolved two days ago blocks regeneration inside the 7-day recurrence interval',
    reviewNotes:
      'The user completed the previous harvest recommendation two days ago and the plant is ' +
      'still marked ready. The rule stays quiet — regeneration is suppressed until the ' +
      'recurrence interval elapses, so the user is not re-nagged about work just resolved.',
    facts: gardenFacts({ plants: [READY_PLANT] }),
    prior: {
      liveCandidates: [],
      latestPerRuleAndTarget: [
        priorCandidate({
          candidateId: PRIOR_CANDIDATE_A_ID,
          ruleKey: 'lifecycle.harvest-readiness-check',
          state: 'completed',
          revision: 3,
          createdAt: new Date(FIXTURE_NOW.getTime() - 2 * DAY_MS),
        }),
      ],
    },
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
        ...QUIET_OTHER_RULES,
        suppressedDecision('lifecycle.harvest-readiness-check', PLANT_A_ID, {
          kind: 'withinRecurrenceInterval',
          priorCandidateId: PRIOR_CANDIDATE_A_ID,
          priorCreatedAt: new Date(FIXTURE_NOW.getTime() - 2 * DAY_MS),
        }),
        BOTH_WEATHER_RULES_SKIP[1],
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'fires again once the recurrence interval has fully elapsed',
    reviewNotes:
      'Same as the previous scenario, but the resolved candidate is eight days old — past the ' +
      '7-day recurrence interval — so a fresh recommendation fires, with no supersession link ' +
      '(the prior one is resolved, not replaced).',
    facts: gardenFacts({ plants: [READY_PLANT] }),
    prior: {
      liveCandidates: [],
      latestPerRuleAndTarget: [
        priorCandidate({
          candidateId: PRIOR_CANDIDATE_A_ID,
          ruleKey: 'lifecycle.harvest-readiness-check',
          state: 'completed',
          revision: 3,
          createdAt: new Date(FIXTURE_NOW.getTime() - 8 * DAY_MS),
        }),
      ],
    },
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
        ...QUIET_OTHER_RULES,
        fireDecision('lifecycle.harvest-readiness-check', PLANT_A_ID, 75),
        BOTH_WEATHER_RULES_SKIP[1],
      ],
      plannedCandidates: [harvestCandidate()],
    },
  },
  {
    name: 'supersession: a live candidate whose validity window passed is replaced while readiness persists',
    reviewNotes:
      'A live (presented, never acted-on) harvest candidate from eight days ago had a 5-day ' +
      'window — it went stale three days ago while the plant stayed ready. The evaluation ' +
      'replaces it: the new candidate references the prior one, and the prior transitions to ' +
      'superseded. Replacing is exempt from the recurrence interval — it renews, not repeats.',
    facts: gardenFacts({ plants: [READY_PLANT] }),
    prior: (() => {
      const staleLive = priorCandidate({
        candidateId: PRIOR_CANDIDATE_A_ID,
        ruleKey: 'lifecycle.harvest-readiness-check',
        state: 'presented',
        revision: 3,
        createdAt: new Date(FIXTURE_NOW.getTime() - 8 * DAY_MS),
        windowEnd: new Date(FIXTURE_NOW.getTime() - 3 * DAY_MS),
      });
      return { liveCandidates: [staleLive], latestPerRuleAndTarget: [staleLive] };
    })(),
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
        ...QUIET_OTHER_RULES,
        fireDecision('lifecycle.harvest-readiness-check', PLANT_A_ID, 75, PRIOR_CANDIDATE_A_ID),
        BOTH_WEATHER_RULES_SKIP[1],
      ],
      plannedCandidates: [
        harvestCandidate({ candidateId: PRIOR_CANDIDATE_A_ID, expectedRevision: 3 }),
      ],
    },
  },
];
