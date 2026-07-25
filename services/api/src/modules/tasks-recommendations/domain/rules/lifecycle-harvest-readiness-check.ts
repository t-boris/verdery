/**
 * `lifecycle.harvest-readiness-check` v1 — ordinary care ("general
 * maintenance", section 13).
 *
 * WHAT IT SAYS: when the user has marked a plant `ready_to_harvest`,
 * suggest actually checking ripeness and harvesting soon — a readiness
 * window left unattended loses yield. The trigger is the USER's own
 * lifecycle-stage fact; the rule adds timing pressure, not a ripeness
 * judgment of its own.
 *
 * FACTS CONSULTED: each plant's status and lifecycle stage. No weather.
 *
 * REVIEW STATUS: awaiting horticultural review (P7-SAFE-01). The validity
 * and recurrence windows are defensible placeholders a horticulturist
 * must confirm or correct.
 */

import type { GardenFacts } from '../garden-facts.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import { DAY_MS, plantTarget } from './rule-support.js';

const PARAMETERS = {
  validityWindowDays: 5,
  recurrenceIntervalDays: 7,
} as const;

function evaluate(facts: GardenFacts): ReturnType<RuleDefinition['evaluate']> {
  const targets: RuleTargetEvaluation[] = facts.plants.map((plant) => {
    if (plant.status !== 'active') {
      return {
        outcome: 'notEligible',
        target: plantTarget(plant.plantId),
        reasonCode: 'plant.status_not_active',
      };
    }
    if (plant.lifecycleStage !== 'ready_to_harvest') {
      return {
        outcome: 'notEligible',
        target: plantTarget(plant.plantId),
        reasonCode: 'plant.not_ready_to_harvest',
      };
    }
    return {
      outcome: 'eligible',
      target: plantTarget(plant.plantId),
      evidence: [
        {
          kind: 'lifecycle_stage',
          sourceObservationId: null,
          sourceTaskId: null,
          sourcePlantId: plant.plantId,
          sourceWeatherRecordId: null,
          factKey: 'plant.lifecycle_stage',
          factValue: { lifecycleStage: 'ready_to_harvest' },
        },
      ],
      factors: [
        {
          kind: 'urgency_window',
          contribution: 30,
          basis: { urgency: 'high', validityWindowDays: PARAMETERS.validityWindowDays },
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
      explanationFacts: {
        'plant.display_name': plant.displayName,
      },
      windowEnd: null,
    };
  });

  return { outcome: 'evaluated', targets };
}

export const lifecycleHarvestReadinessCheckRule: RuleDefinition = {
  ruleKey: 'lifecycle.harvest-readiness-check',
  version: 1,
  safetyTier: 'ordinary_care',
  careCategory: 'harvest',
  actionTitle: 'Check ripeness and harvest what is ready',
  description:
    'Suggests a timely harvest check for each active plant the user has marked ready to ' +
    'harvest. The user supplies the readiness fact; the rule supplies the timing nudge.',
  urgency: 'high',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowDays * DAY_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalDays * DAY_MS,
  },
  weatherPolicy: { use: 'notUsed' },
  requiredEvidenceKinds: ['lifecycle_stage'],
  explanationTemplate:
    '{plant.display_name} is marked ready to harvest. Check ripeness and harvest what is ' +
    'ready before the window passes.',
  parameters: PARAMETERS,
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' },
  evaluate,
};
