/**
 * Shared deterministic test doubles for the two ADR-0015 AI capabilities
 * (plant species identification, plant condition analysis) — split out of
 * `integrations-test-doubles.ts` for the same 600-line reason every sibling
 * split file already gives (see `AGENTS.md`). Not itself a `*.test.ts`
 * file, so vitest never runs it as a suite.
 */

import type {
  PlantConditionAnalysisAdapterOutcome,
  PlantConditionAnalysisProviderAdapter,
  PlantConditionAnalysisRequest,
  PlantConditionModelIdentity,
} from './plant-condition-analysis-provider.js';
import type {
  PlantIdentificationModelIdentity,
  PlantSpeciesIdentificationAdapterOutcome,
  PlantSpeciesIdentificationProviderAdapter,
  PlantSpeciesIdentificationRequest,
} from './plant-species-identification-provider.js';

export type FakePlantSpeciesIdentificationBehavior =
  | { readonly kind: 'outcome'; readonly outcome: PlantSpeciesIdentificationAdapterOutcome }
  | { readonly kind: 'fail'; readonly error?: unknown }
  /** Never settles until the deadline's abort — the timeout scenario. */
  | { readonly kind: 'hang' };

/** A scriptable plant-species-identification adapter (ADR-0015) — the `FakeAiExplanationProviderAdapter` shape. */
export class FakePlantSpeciesIdentificationProviderAdapter implements PlantSpeciesIdentificationProviderAdapter {
  callCount = 0;
  lastSignalAborted: boolean | null = null;
  readonly requests: PlantSpeciesIdentificationRequest[] = [];

  readonly identity: PlantIdentificationModelIdentity;

  constructor(
    private behavior: FakePlantSpeciesIdentificationBehavior,
    identity: Partial<PlantIdentificationModelIdentity> = {},
  ) {
    this.identity = {
      model: identity.model ?? 'fake-plant-species-model',
      promptTemplateVersion: identity.promptTemplateVersion ?? 1,
    };
  }

  setBehavior(behavior: FakePlantSpeciesIdentificationBehavior): void {
    this.behavior = behavior;
  }

  identifySpecies(
    request: PlantSpeciesIdentificationRequest,
    signal: AbortSignal,
  ): Promise<PlantSpeciesIdentificationAdapterOutcome> {
    this.callCount += 1;
    this.requests.push(request);
    const behavior = this.behavior;
    switch (behavior.kind) {
      case 'outcome':
        return Promise.resolve(behavior.outcome);
      case 'fail':
        return Promise.reject(
          behavior.error instanceof Error
            ? behavior.error
            : new Error('fake plant-species provider failure', { cause: behavior.error }),
        );
      case 'hang':
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            this.lastSignalAborted = true;
            reject(new Error('aborted by deadline'));
          });
        });
    }
  }
}

/** A default photo reference for tests that don't care what it points at. */
export function testPlantPhotoReference(
  overrides: Partial<PlantSpeciesIdentificationRequest['photo']> = {},
): PlantSpeciesIdentificationRequest['photo'] {
  return {
    bucketName: 'test-user-media',
    objectKey: 'gardens/test-garden/plants/test-photo.jpg',
    mimeType: 'image/jpeg',
    // Comfortably under every provider limit: a test that does not care what
    // the photo points at does not care how big it is either.
    byteSize: 1_048_576,
    ...overrides,
  };
}

export type FakePlantConditionAnalysisBehavior =
  | { readonly kind: 'outcome'; readonly outcome: PlantConditionAnalysisAdapterOutcome }
  | { readonly kind: 'fail'; readonly error?: unknown }
  /** Never settles until the deadline's abort — the timeout scenario. */
  | { readonly kind: 'hang' };

/** A scriptable plant-condition-analysis adapter (ADR-0015) — the `FakeAiExplanationProviderAdapter` shape. */
export class FakePlantConditionAnalysisProviderAdapter implements PlantConditionAnalysisProviderAdapter {
  callCount = 0;
  lastSignalAborted: boolean | null = null;
  readonly requests: PlantConditionAnalysisRequest[] = [];

  readonly identity: PlantConditionModelIdentity;

  constructor(
    private behavior: FakePlantConditionAnalysisBehavior,
    identity: Partial<PlantConditionModelIdentity> = {},
  ) {
    this.identity = {
      model: identity.model ?? 'fake-plant-condition-model',
      promptTemplateVersion: identity.promptTemplateVersion ?? 1,
    };
  }

  setBehavior(behavior: FakePlantConditionAnalysisBehavior): void {
    this.behavior = behavior;
  }

  analyzeCondition(
    request: PlantConditionAnalysisRequest,
    signal: AbortSignal,
  ): Promise<PlantConditionAnalysisAdapterOutcome> {
    this.callCount += 1;
    this.requests.push(request);
    const behavior = this.behavior;
    switch (behavior.kind) {
      case 'outcome':
        return Promise.resolve(behavior.outcome);
      case 'fail':
        return Promise.reject(
          behavior.error instanceof Error
            ? behavior.error
            : new Error('fake plant-condition provider failure', { cause: behavior.error }),
        );
      case 'hang':
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            this.lastSignalAborted = true;
            reject(new Error('aborted by deadline'));
          });
        });
    }
  }
}
