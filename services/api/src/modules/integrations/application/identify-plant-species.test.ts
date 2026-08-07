import { VISION_ANALYSIS_SOURCE_MAX_BYTES } from '@verdery/api-contracts';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { InMemoryProviderQuotaRepository, fixedClock } from './integrations-test-doubles.js';
import { IdentifyPlantSpecies } from './identify-plant-species.js';
import type { PlantSpeciesIdentificationCallPolicy } from './identify-plant-species.js';
import {
  FakePlantSpeciesIdentificationProviderAdapter,
  testPlantPhotoReference,
} from './plant-ai-test-doubles.js';
import type { PlantSpeciesIdentificationRequest } from './plant-species-identification-provider.js';

const NOW = new Date('2026-07-28T10:15:00Z');
const PROVIDER_KEY = 'vertex-ai-plant-species';
const REQUEST: PlantSpeciesIdentificationRequest = { photo: testPlantPhotoReference() };

function silentLogger() {
  return pino({ level: 'silent' });
}

function policy(
  overrides: Partial<PlantSpeciesIdentificationCallPolicy> = {},
): PlantSpeciesIdentificationCallPolicy {
  return {
    providerKey: PROVIDER_KEY,
    callTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    ...overrides,
  };
}

describe('IdentifyPlantSpecies', () => {
  it('with no adapter (the kill-switch off), answers noProviderConfigured without consuming budget', async () => {
    const quotas = new InMemoryProviderQuotaRepository();
    const identify = new IdentifyPlantSpecies(
      null,
      policy(),
      quotas,
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'noProviderConfigured' });
    expect(quotas.countFor(PROVIDER_KEY, 'hour', NOW)).toBe(0);
  });

  it('passes a candidate through with the provenance a stored suggestion needs', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter(
      {
        kind: 'outcome',
        outcome: {
          kind: 'candidate',
          candidate: {
            commonName: 'Tomato',
            scientificNameGuess: null,
            familyNameGuess: null,
            genusNameGuess: null,
            confidenceScore: 0.8,
            varietyGuess: null,
            lifecycleStageGuess: null,
            acquisitionDateGuess: null,
            estimatedAgeMonthsMin: 0,
            estimatedAgeMonthsMax: 0,
          },
        },
      },
      { model: 'gemini-test', promptTemplateVersion: 2 },
    );
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute(REQUEST);

    expect(result).toEqual({
      outcome: 'candidate',
      candidate: {
        commonName: 'Tomato',
        scientificNameGuess: null,
        familyNameGuess: null,
        genusNameGuess: null,
        confidenceScore: 0.8,
        varietyGuess: null,
        lifecycleStageGuess: null,
        acquisitionDateGuess: null,
        estimatedAgeMonthsMin: 0,
        estimatedAgeMonthsMax: 0,
      },
      provenance: { providerKey: PROVIDER_KEY, model: 'gemini-test', promptTemplateVersion: 2 },
    });
    expect(adapter.callCount).toBe(1);
  });

  it('answers noConfidentCandidate without inventing a fake candidate', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'outcome',
      outcome: { kind: 'noConfidentCandidate' },
    });
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute(REQUEST);

    expect(result.outcome).toBe('noConfidentCandidate');
  });

  it('answers quotaExhausted without calling the adapter', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'outcome',
      outcome: { kind: 'noConfidentCandidate' },
    });
    const quotas = new InMemoryProviderQuotaRepository();
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy({ quotaLimits: { maxCallsPerHour: 0, maxCallsPerDay: null } }),
      quotas,
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'quotaExhausted' });
    expect(adapter.callCount).toBe(0);
  });

  /*
   * A 30.79 MiB photograph reached Vertex on 2026-08-04 and came back as a
   * bare `400 INVALID_ARGUMENT`, which this class logged as a provider
   * failure and the person read as "no species found". The size says so
   * beforehand, so neither the quota nor the provider should be spent on it.
   */
  it('refuses a photo above the provider limit without spending a call', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'outcome',
      outcome: { kind: 'noConfidentCandidate' },
    });
    const quotas = new InMemoryProviderQuotaRepository();
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy(),
      quotas,
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute({
      photo: testPlantPhotoReference({ byteSize: VISION_ANALYSIS_SOURCE_MAX_BYTES + 1 }),
    });

    expect(result).toEqual({ outcome: 'unavailable', reason: 'photoTooLarge' });
    expect(adapter.callCount).toBe(0);
    expect(quotas.countFor(PROVIDER_KEY, 'hour', NOW)).toBe(0);
  });

  it('accepts a photo exactly at the provider limit', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'outcome',
      outcome: { kind: 'noConfidentCandidate' },
    });
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute({
      photo: testPlantPhotoReference({ byteSize: VISION_ANALYSIS_SOURCE_MAX_BYTES }),
    });

    expect(result.outcome).toBe('noConfidentCandidate');
    expect(adapter.callCount).toBe(1);
  });

  it('answers providerTimeout when the adapter hangs past the deadline', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({ kind: 'hang' });
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy({ callTimeoutMs: 5 }),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerTimeout' });
  });

  it('answers providerFailed when the adapter rejects', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'fail',
      error: new Error('provider down'),
    });
    const identify = new IdentifyPlantSpecies(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      silentLogger(),
    );

    const result = await identify.execute(REQUEST);

    expect(result).toEqual({ outcome: 'unavailable', reason: 'providerFailed' });
  });
});
