/**
 * Shared vocabulary for the bilingual AI-explanation evaluation harness —
 * see README.md in this directory for what these fixtures are, how they
 * map onto recommendations-and-ai.md section 16, and what the human
 * evaluation pass adds on top.
 *
 * Every fixture evaluates ONE constructed model draft against the REAL
 * validation pipeline (`validateAiExplanationDraft`) for one launch
 * rule's REAL baseline: the rule's own `explanationTemplate` rendered
 * through the real `renderRuleExplanation` with representative facts,
 * plus the rule's own `actionTitle` — so the vocabulary being enforced
 * is the shipped catalog's, never a paraphrase of it.
 */

import type {
  AiExplanationValidationInput,
  AiExplanationValidationVerdict,
} from '../../src/modules/tasks-recommendations/public.js';
import {
  createLaunchRuleCatalog,
  renderRuleExplanation,
} from '../../src/modules/tasks-recommendations/public.js';

/** One evaluation case. `expected` pins the FULL verdict — deep equality, no partial matching. */
export interface AiExplanationFixture {
  readonly name: string;
  /** `'en'` or `'ru'` — which product language the constructed draft is written in (section 16's bilingual requirement). */
  readonly draftLanguage: 'en' | 'ru';
  readonly input: AiExplanationValidationInput;
  readonly expected: AiExplanationValidationVerdict;
  /** What judgment this case embodies, for the human reviewer. */
  readonly reviewNotes: string;
}

const catalog = createLaunchRuleCatalog();

export interface RuleBaseline {
  readonly ruleKey: string;
  readonly deterministicExplanation: string;
  readonly actionTitle: string;
  readonly packetFactKeys: readonly string[];
  readonly packetFactValues: readonly unknown[];
}

function baseline(
  ruleKey: string,
  explanationFacts: Readonly<Record<string, string | number>>,
  packet: readonly { factKey: string; factValue: unknown }[],
): RuleBaseline {
  const definition = catalog.find(ruleKey, 1);
  if (definition === null) {
    throw new Error(`Launch rule '${ruleKey}' v1 is not in the catalog.`);
  }
  return {
    ruleKey,
    deterministicExplanation: renderRuleExplanation(
      ruleKey,
      definition.explanationTemplate,
      explanationFacts,
    ),
    actionTitle: definition.actionTitle,
    packetFactKeys: packet.map((fact) => fact.factKey),
    packetFactValues: packet.map((fact) => fact.factValue),
  };
}

/** `watering.dry-spell-check` v1 over a 26 °C / 0.2 mm reading on a growing cherry tomato. */
export const WATERING_BASELINE = baseline(
  'watering.dry-spell-check',
  {
    'plant.display_name': 'Cherry tomato',
    'plant.lifecycle_stage': 'growing',
    'weather.temperature_celsius': 26,
    'weather.precipitation_mm': 0.2,
  },
  [
    {
      factKey: 'weather.dry_spell_observation',
      factValue: {
        temperatureCelsius: 26,
        precipitationMm: 0.2,
        freshness: 'fresh',
        effectiveAt: '2026-07-25T06:00:00Z',
      },
    },
    { factKey: 'plant.lifecycle_stage', factValue: { lifecycleStage: 'growing' } },
  ],
);

/** `observation.routine-check-reminder` v1 over a basil pot unobserved for 15 days. */
export const OBSERVATION_BASELINE = baseline(
  'observation.routine-check-reminder',
  { 'plant.display_name': 'Basil pot', 'plant.days_since_observation': 15 },
  [
    {
      factKey: 'plant.observation_recency',
      factValue: { daysSinceObservation: 15, lastObservedAt: '2026-07-10T08:00:00Z' },
    },
  ],
);

/** `lifecycle.harvest-readiness-check` v1 over a Roma tomato marked ready to harvest. */
export const HARVEST_BASELINE = baseline(
  'lifecycle.harvest-readiness-check',
  { 'plant.display_name': 'Roma tomato' },
  [{ factKey: 'plant.lifecycle_stage', factValue: { lifecycleStage: 'ready_to_harvest' } }],
);

/** `weather.frost-watch` v1 over a -3 °C forecast against a pepper seedling. */
export const FROST_BASELINE = baseline(
  'weather.frost-watch',
  {
    'weather.forecast_temperature_celsius': -3,
    'weather.forecast_effective_at': '2026-10-03T04:00:00Z',
    'plant.display_name': 'Pepper seedling',
    'plant.lifecycle_stage': 'seedling',
  },
  [
    {
      factKey: 'weather.frost_forecast',
      factValue: {
        temperatureCelsius: -3,
        effectiveAt: '2026-10-03T04:00:00Z',
        freshness: 'fresh',
      },
    },
    { factKey: 'plant.lifecycle_stage', factValue: { lifecycleStage: 'seedling' } },
  ],
);

/** Builds one fixture over a rule baseline; `evidenceKeysUsed` defaults to the whole packet. */
export function fixture(options: {
  name: string;
  draftLanguage: 'en' | 'ru';
  baseline: RuleBaseline;
  explanation: string;
  evidenceKeysUsed?: readonly string[];
  expected: AiExplanationValidationVerdict;
  reviewNotes: string;
}): AiExplanationFixture {
  return {
    name: options.name,
    draftLanguage: options.draftLanguage,
    input: {
      draft: {
        explanation: options.explanation,
        evidenceKeysUsed: options.evidenceKeysUsed ?? options.baseline.packetFactKeys,
      },
      deterministicExplanation: options.baseline.deterministicExplanation,
      actionTitle: options.baseline.actionTitle,
      packetFactKeys: options.baseline.packetFactKeys,
      packetFactValues: options.baseline.packetFactValues,
    },
    expected: options.expected,
    reviewNotes: options.reviewNotes,
  };
}
