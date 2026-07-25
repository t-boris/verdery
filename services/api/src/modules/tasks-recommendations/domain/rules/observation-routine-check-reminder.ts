/**
 * `observation.routine-check-reminder` v1 — ordinary care ("observation
 * reminders", section 13).
 *
 * WHAT IT SAYS: when an active plant has gone unobserved for a while,
 * suggest recording a quick condition check. The interval since the last
 * observation — or since the plant was added, when it has never been
 * observed — is a DERIVED fact from real records, not an invented one:
 * the evidence row snapshots exactly which observation (or its absence)
 * the recommendation rests on.
 *
 * FACTS CONSULTED: each plant's status and creation time, and the
 * garden's observation history (correction rows count — a correction is
 * itself an act of checking the plant). No weather.
 *
 * REVIEW STATUS: awaiting horticultural review (P7-SAFE-01). The
 * `checkIntervalDays` cadence is a defensible placeholder a horticulturist
 * must confirm or correct.
 */

import type { GardenFacts } from '../garden-facts.js';
import { latestObservationForPlant } from '../garden-facts.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import { DAY_MS, plantTarget, wholeDaysBetween } from './rule-support.js';

const PARAMETERS = {
  /** A plant unobserved for at least this many days earns a check reminder. */
  checkIntervalDays: 14,
  validityWindowDays: 7,
  recurrenceIntervalDays: 14,
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

    const latestObservation = latestObservationForPlant(facts.observations, plant.plantId);
    const baseline = latestObservation === null ? plant.createdAt : latestObservation.observedAt;
    const daysSince = wholeDaysBetween(baseline, facts.evaluatedAt);
    if (daysSince < PARAMETERS.checkIntervalDays) {
      return {
        outcome: 'notEligible',
        target: plantTarget(plant.plantId),
        reasonCode: 'plant.recently_observed',
      };
    }

    return {
      outcome: 'eligible',
      target: plantTarget(plant.plantId),
      evidence: [
        {
          kind: 'plant_identity',
          sourceObservationId: null,
          sourceTaskId: null,
          sourcePlantId: plant.plantId,
          sourceWeatherRecordId: null,
          factKey: 'plant.observation_recency',
          factValue: {
            lastObservedAt: latestObservation?.observedAt.toISOString() ?? null,
            baseline: latestObservation === null ? 'plant_created_at' : 'latest_observation',
            daysSince,
          },
        },
        // The optional evidence: the exact observation the interval is
        // measured from, when one exists. A never-observed plant records
        // no observation reference — there is nothing to reference.
        ...(latestObservation === null
          ? []
          : [
              {
                kind: 'observation' as const,
                sourceObservationId: latestObservation.observationId,
                sourceTaskId: null,
                sourcePlantId: null,
                sourceWeatherRecordId: null,
                factKey: 'observation.latest_for_plant',
                factValue: { observedAt: latestObservation.observedAt.toISOString() },
              },
            ]),
      ],
      factors: [
        {
          kind: 'urgency_window',
          contribution: 10,
          basis: { urgency: 'low', validityWindowDays: PARAMETERS.validityWindowDays },
        },
        {
          kind: 'plant_impact',
          contribution: 10,
          basis: { lifecycleStage: plant.lifecycleStage },
        },
        {
          kind: 'confidence',
          contribution: 20,
          basis: { source: 'own_records', daysSince },
        },
      ],
      explanationFacts: {
        'plant.display_name': plant.displayName,
        'plant.days_since_observation': daysSince,
      },
      windowEnd: null,
    };
  });

  return { outcome: 'evaluated', targets };
}

export const observationRoutineCheckReminderRule: RuleDefinition = {
  ruleKey: 'observation.routine-check-reminder',
  version: 1,
  safetyTier: 'ordinary_care',
  careCategory: 'observation',
  actionTitle: 'Record a quick condition check for this plant',
  description:
    'Reminds the user to record an observation for an active plant that has gone unobserved ' +
    'for the configured interval, measured from its latest observation or, for a plant never ' +
    'observed, from when it was added.',
  urgency: 'low',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowDays * DAY_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalDays * DAY_MS,
  },
  weatherPolicy: { use: 'notUsed' },
  requiredEvidenceKinds: ['plant_identity'],
  explanationTemplate:
    '{plant.display_name} has not been observed for {plant.days_since_observation} days. ' +
    'Record a quick check of its condition.',
  parameters: PARAMETERS,
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' },
  evaluate,
};
