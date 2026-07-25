import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { AiExplanationRequest } from './ai-explanation-provider.js';
import { GenerateAiExplanation } from './generate-ai-explanation.js';
import type { AiExplanationCallPolicy } from './generate-ai-explanation.js';
import {
  FakeAiExplanationProviderAdapter,
  fixedClock,
  InMemoryProviderQuotaRepository,
} from './integrations-test-doubles.js';

const NOW = new Date('2026-07-25T10:15:00Z');
const PROVIDER_KEY = 'vertex-ai-explanation';

const REQUEST: AiExplanationRequest = {
  ruleKey: 'watering.dry-spell-check',
  ruleVersion: 1,
  actionTitle: 'Check whether this plant needs watering',
  deterministicExplanation:
    'Recent weather at this garden was warm (24 °C) with almost no rain (0.5 mm).',
  locale: 'en',
  evidenceFacts: [
    { factKey: 'weather.dry_spell_observation', factValue: { temperatureCelsius: 24 } },
  ],
};

function policy(overrides: Partial<AiExplanationCallPolicy> = {}): AiExplanationCallPolicy {
  return {
    providerKey: PROVIDER_KEY,
    callTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    ...overrides,
  };
}

describe('GenerateAiExplanation', () => {
  it('with no adapter (the kill-switch off), answers noProviderConfigured without consuming budget', async () => {
    const quotas = new InMemoryProviderQuotaRepository();
    const generate = new GenerateAiExplanation(null, policy(), quotas, fixedClock(NOW));

    const result = await generate.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });
    expect(quotas.countFor(PROVIDER_KEY, 'hour', NOW)).toBe(0);
  });

  it('passes a draft through with the provenance the record will store', async () => {
    const adapter = new FakeAiExplanationProviderAdapter(
      {
        kind: 'outcome',
        outcome: {
          kind: 'draft',
          draft: { explanation: 'Rephrased.', evidenceKeysUsed: ['weather.dry_spell_observation'] },
        },
      },
      { model: 'gemini-test', promptTemplateVersion: 3 },
    );
    const generate = new GenerateAiExplanation(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
    );

    const result = await generate.execute(REQUEST);

    expect(result).toEqual({
      outcome: 'draft',
      draft: { explanation: 'Rephrased.', evidenceKeysUsed: ['weather.dry_spell_observation'] },
      provenance: { providerKey: PROVIDER_KEY, model: 'gemini-test', promptTemplateVersion: 3 },
    });
    expect(adapter.requests).toEqual([REQUEST]);
  });

  it('consumes the budget BEFORE the call, and a refused budget means zero adapter calls', async () => {
    const adapter = new FakeAiExplanationProviderAdapter({
      kind: 'outcome',
      outcome: { kind: 'safetyBlocked' },
    });
    const quotas = new InMemoryProviderQuotaRepository();
    const generate = new GenerateAiExplanation(
      adapter,
      policy({ quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null } }),
      quotas,
      fixedClock(NOW),
    );

    const first = await generate.execute(REQUEST);
    const second = await generate.execute(REQUEST);

    expect(first.outcome).toBe('safetyBlocked');
    expect(second).toEqual({ outcome: 'unavailable', reason: 'quotaExhausted' });
    expect(adapter.callCount).toBe(1);
    expect(quotas.countFor(PROVIDER_KEY, 'hour', NOW)).toBe(1);
  });

  it('a hanging call times out at the deadline, aborts the adapter signal, and stays consumed against the budget', async () => {
    const adapter = new FakeAiExplanationProviderAdapter({ kind: 'hang' });
    const quotas = new InMemoryProviderQuotaRepository();
    const generate = new GenerateAiExplanation(
      adapter,
      policy({ callTimeoutMs: 20 }),
      quotas,
      fixedClock(NOW),
    );

    const result = await generate.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerTimeout' });
    expect(adapter.lastSignalAborted).toBe(true);
    // The call was made: consumed-then-timed-out stays consumed.
    expect(quotas.countFor(PROVIDER_KEY, 'hour', NOW)).toBe(1);
  });

  it('an adapter rejection is the typed providerFailed degradation, never a crash', async () => {
    const adapter = new FakeAiExplanationProviderAdapter({ kind: 'fail' });
    const generate = new GenerateAiExplanation(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
    );

    await expect(generate.execute(REQUEST)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'providerFailed',
    });
  });

  it('maps schemaInvalid and safetyBlocked through with provenance — the durable verdicts', async () => {
    const adapter = new FakeAiExplanationProviderAdapter({
      kind: 'outcome',
      outcome: { kind: 'schemaInvalid', rawText: 'not json' },
    });
    const generate = new GenerateAiExplanation(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
    );

    const result = await generate.execute(REQUEST);
    expect(result).toMatchObject({ outcome: 'schemaInvalid', rawText: 'not json' });
    if (result.outcome === 'schemaInvalid') {
      expect(result.provenance.providerKey).toBe(PROVIDER_KEY);
    }
  });

  it('refuses a malformed policy at construction — a composition defect, not a runtime degradation', () => {
    const quotas = new InMemoryProviderQuotaRepository();
    expect(
      () => new GenerateAiExplanation(null, policy({ callTimeoutMs: 0 }), quotas, fixedClock(NOW)),
    ).toThrow(InternalError);
    expect(
      () => new GenerateAiExplanation(null, policy({ providerKey: '  ' }), quotas, fixedClock(NOW)),
    ).toThrow(InternalError);
  });
});
