/**
 * P11-OBS-01: pins `plant_species_ai.no_catalog_match`'s exact field set —
 * the prohibited-content fix this pass made (a raw `commonName` value was
 * being logged; see the fix site's own comment in
 * `identify-plant-from-photo.ts`). This is the ONE test in this module that
 * exercises `identifyPlantFromPhoto` directly against a real
 * `IdentifyPlantSpecies` (a fake provider adapter, real policy/quota/clock
 * plumbing — `identify-plant-species.test.ts`'s own construction) rather
 * than through `AddPlantFromPhoto`'s full command, so the logged line can
 * be captured with nothing else in scope.
 */

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import {
  InMemoryProviderQuotaRepository,
  fixedClock,
} from '../../integrations/application/integrations-test-doubles.js';
import { IdentifyPlantSpecies } from '../../integrations/application/identify-plant-species.js';
import type { PlantSpeciesIdentificationCallPolicy } from '../../integrations/application/identify-plant-species.js';
import {
  FakePlantSpeciesIdentificationProviderAdapter,
  testPlantPhotoReference,
} from '../../integrations/application/plant-ai-test-doubles.js';
import { identifyPlantFromPhoto } from './identify-plant-from-photo.js';
import type {
  TaxonomyReferenceRepository,
  TaxonomySearchResult,
} from './taxonomy-reference-repository.js';
import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

const NOW = new Date('2026-07-28T10:15:00Z');
const PROVIDER_KEY = 'vertex-ai-plant-species';

function policy(): PlantSpeciesIdentificationCallPolicy {
  return {
    providerKey: PROVIDER_KEY,
    callTimeoutMs: 1_000,
    quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
  };
}

/** Always answers "no match" — the exact precondition `no_catalog_match` fires under. */
class EmptyTaxonomyReferenceRepository implements TaxonomyReferenceRepository {
  findById(): Promise<TaxonomyReference | null> {
    return Promise.resolve(null);
  }
  search(): Promise<TaxonomyReference[]> {
    return Promise.resolve([]);
  }
  searchAcrossNames(): Promise<TaxonomySearchResult[]> {
    return Promise.resolve([]);
  }
}

function capturingLogger() {
  const lines: string[] = [];
  const logger = pino({ level: 'info' }, { write: (chunk: string) => lines.push(chunk) });
  return {
    logger,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('identifyPlantFromPhoto (P11-OBS-01 telemetry)', () => {
  it('logs plant_species_ai.no_catalog_match with confidenceScore only — never the guessed commonName', async () => {
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter(
      {
        kind: 'outcome',
        outcome: {
          kind: 'candidate',
          candidate: {
            commonName: 'Tomato',
            scientificNameGuess: null,
            confidenceScore: 0.8,
            varietyGuess: null,
            lifecycleStageGuess: null,
            acquisitionDateGuess: null,
          },
        },
      },
      { model: 'gemini-test', promptTemplateVersion: 2 },
    );
    const identifyPlantSpecies = new IdentifyPlantSpecies(
      adapter,
      policy(),
      new InMemoryProviderQuotaRepository(),
      fixedClock(NOW),
      pino({ level: 'silent' }),
    );
    const { logger, records } = capturingLogger();

    const suggestion = await identifyPlantFromPhoto(
      identifyPlantSpecies,
      new EmptyTaxonomyReferenceRepository(),
      testPlantPhotoReference(),
      logger,
    );

    expect(suggestion.suggestedTaxonomyId).toBeNull();
    expect(suggestion.suggestedCommonName).toBe('Tomato');

    const events = records().filter(
      (record) => record['event'] === 'plant_species_ai.no_catalog_match',
    );
    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event['confidenceScore']).toBe(0.8);
    expect(event['commonName']).toBeUndefined();
    const nonPipelineKeys = Object.keys(event).filter(
      (key) => !['level', 'time', 'msg', 'event', 'pid', 'hostname'].includes(key),
    );
    expect(nonPipelineKeys).toEqual(['confidenceScore']);
  });
});
