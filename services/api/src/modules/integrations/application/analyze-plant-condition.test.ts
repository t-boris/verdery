import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { InMemoryProviderQuotaRepository, fixedClock } from './integrations-test-doubles.js';
import { AnalyzePlantCondition } from './analyze-plant-condition.js';
import type { PlantConditionAnalysisCallPolicy } from './analyze-plant-condition.js';
import {
  FakePlantConditionAnalysisProviderAdapter,
  testPlantPhotoReference,
} from './plant-ai-test-doubles.js';
import type { PlantConditionAnalysisRequest } from './plant-condition-analysis-provider.js';

const NOW = new Date('2026-07-28T10:15:00Z');
const PROVIDER_KEY = 'vertex-ai-plant-condition';
const REQUEST: PlantConditionAnalysisRequest = {
  photo: testPlantPhotoReference(),
  priorPhotos: [],
};

function policy(
  overrides: Partial<PlantConditionAnalysisCallPolicy> = {},
): PlantConditionAnalysisCallPolicy {
  return {
    providerKey: PROVIDER_KEY,
    callTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    ...overrides,
  };
}

function silentLogger() {
  return pino({ level: 'silent' });
}

describe('AnalyzePlantCondition', () => {
  it('with no adapter (the kill-switch off), answers noProviderConfigured without consuming budget', async () => {
    const quotas = new InMemoryProviderQuotaRepository();
    const analyze = new AnalyzePlantCondition(null, policy(), quotas, fixedClock(NOW), silentLogger());

    const result = await analyze.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });
    expect(quotas.countFor(PROVIDER_KEY, 'hour', NOW)).toBe(0);
  });

  it('passes an observation through with the provenance a stored result needs', async () => {
    const adapter = new FakePlantConditionAnalysisProviderAdapter(
      {
        kind: 'outcome',
        outcome: {
          kind: 'observation',
          observation: {
            kind: 'pest',
            suggestedLabel: 'Aphids',
            confidenceScore: 0.55,
            requestedAdditionalEvidence: false,
            careGuidanceSuggestion: 'Inspect the undersides of leaves regularly',
          },
        },
      },
      { model: 'gemini-test', promptTemplateVersion: 2 },
    );
    const analyze = new AnalyzePlantCondition(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await analyze.execute(REQUEST);

    expect(result).toEqual({
      outcome: 'observation',
      observation: {
        kind: 'pest',
        suggestedLabel: 'Aphids',
        confidenceScore: 0.55,
        requestedAdditionalEvidence: false,
        careGuidanceSuggestion: 'Inspect the undersides of leaves regularly',
      },
      provenance: { providerKey: PROVIDER_KEY, model: 'gemini-test', promptTemplateVersion: 2 },
    });
    expect(adapter.callCount).toBe(1);
  });

  it('answers quotaExhausted without calling the adapter', async () => {
    const adapter = new FakePlantConditionAnalysisProviderAdapter({
      kind: 'outcome',
      outcome: {
        kind: 'observation',
        observation: {
          kind: 'other',
          suggestedLabel: 'x',
          confidenceScore: 0,
          requestedAdditionalEvidence: true,
          careGuidanceSuggestion: '',
        },
      },
    });
    const quotas = new InMemoryProviderQuotaRepository();
    const analyze = new AnalyzePlantCondition(
      adapter,
      policy({ quotaLimits: { maxCallsPerHour: 0, maxCallsPerDay: null } }),
      quotas,
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await analyze.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'quotaExhausted' });
    expect(adapter.callCount).toBe(0);
  });

  it('answers providerTimeout when the adapter hangs past the deadline', async () => {
    const adapter = new FakePlantConditionAnalysisProviderAdapter({ kind: 'hang' });
    const analyze = new AnalyzePlantCondition(
      adapter,
      policy({ callTimeoutMs: 5 }),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await analyze.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerTimeout' });
  });

  it('answers providerFailed when the adapter rejects', async () => {
    const adapter = new FakePlantConditionAnalysisProviderAdapter({
      kind: 'fail',
      error: new Error('provider down'),
    });
    const analyze = new AnalyzePlantCondition(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await analyze.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerFailed' });
  });
});
