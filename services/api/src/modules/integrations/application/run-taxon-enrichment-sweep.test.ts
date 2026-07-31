import { describe, expect, it } from 'vitest';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { RunTaxonEnrichmentSweep } from './run-taxon-enrichment-sweep.js';
import type {
  PlantProfileVersionRebuilder,
  TaxonAssertionsRefresher,
} from './run-taxon-enrichment-sweep.js';
import type { RefreshTaxonAssertionsResult } from './refresh-taxon-assertions.js';
import type { TaxonEnrichmentCandidateSource } from './taxon-enrichment-candidate-source.js';

const TAXON_A: Uuid = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01';
const TAXON_B: Uuid = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02';

class FixedCandidateSource implements TaxonEnrichmentCandidateSource {
  constructor(private readonly ids: readonly Uuid[]) {}

  listEnrichmentCandidates(): Promise<readonly Uuid[]> {
    return Promise.resolve(this.ids);
  }
}

class ScriptedRefresher implements TaxonAssertionsRefresher {
  readonly calls: { taxonomyReferenceId: Uuid; providerKey: string }[] = [];

  constructor(
    private readonly resultFor: (
      taxonomyReferenceId: Uuid,
      providerKey: string,
    ) => RefreshTaxonAssertionsResult,
  ) {}

  execute(input: {
    taxonomyReferenceId: Uuid;
    providerKey: string;
  }): Promise<RefreshTaxonAssertionsResult> {
    this.calls.push(input);
    return Promise.resolve(this.resultFor(input.taxonomyReferenceId, input.providerKey));
  }
}

class ScriptedRebuilder implements PlantProfileVersionRebuilder {
  readonly calls: { taxonomyReferenceId: Uuid; sourcePriority: readonly string[] }[] = [];

  constructor(
    private readonly outcomeFor: (taxonomyReferenceId: Uuid) => 'rebuilt' | 'nothingToResolve',
  ) {}

  execute(
    taxonomyReferenceId: Uuid,
    sourcePriority: readonly string[],
  ): Promise<{ outcome: 'rebuilt' | 'nothingToResolve' }> {
    this.calls.push({ taxonomyReferenceId, sourcePriority });
    return Promise.resolve({ outcome: this.outcomeFor(taxonomyReferenceId) });
  }
}

const REFRESHED = (taxonomyReferenceId: Uuid): RefreshTaxonAssertionsResult => ({
  outcome: 'refreshed',
  mapping: {
    id: 'mapping-1',
    taxonomyReferenceId,
    providerKey: 'usda-plants',
    providerTaxonId: '1',
    providerScientificName: null,
    confidence: null,
    verificationState: 'unverified',
    stateNote: null,
    stateChangedAt: new Date(),
    createdAt: new Date(),
  },
  factsWritten: 1,
  distributionWritten: 1,
});

describe('RunTaxonEnrichmentSweep', () => {
  it('refreshes every candidate against every configured provider, then rebuilds each profile', async () => {
    const candidates = new FixedCandidateSource([TAXON_A, TAXON_B]);
    const refresher = new ScriptedRefresher((taxonomyReferenceId) =>
      REFRESHED(taxonomyReferenceId),
    );
    const rebuilder = new ScriptedRebuilder(() => 'rebuilt');
    const sweep = new RunTaxonEnrichmentSweep(candidates, refresher, rebuilder, ['usda-plants']);

    const result = await sweep.execute();

    expect(result).toEqual({
      taxaConsidered: 2,
      refreshed: 2,
      profilesRebuilt: 2,
      profilesWithNothingToResolve: 0,
      degradationReasons: {},
      stoppedOnQuotaExhaustion: false,
    });
    expect(refresher.calls).toEqual([
      { taxonomyReferenceId: TAXON_A, providerKey: 'usda-plants' },
      { taxonomyReferenceId: TAXON_B, providerKey: 'usda-plants' },
    ]);
    expect(rebuilder.calls).toEqual([
      { taxonomyReferenceId: TAXON_A, sourcePriority: ['usda-plants'] },
      { taxonomyReferenceId: TAXON_B, sourcePriority: ['usda-plants'] },
    ]);
  });

  it('is a documented no-op with zero configured providers — every taxon still gets a rebuild attempt', async () => {
    const candidates = new FixedCandidateSource([TAXON_A]);
    const refresher = new ScriptedRefresher(() => {
      throw new Error('must not be called with an empty sourcePriority');
    });
    const rebuilder = new ScriptedRebuilder(() => 'nothingToResolve');
    const sweep = new RunTaxonEnrichmentSweep(candidates, refresher, rebuilder, []);

    const result = await sweep.execute();

    expect(result).toEqual({
      taxaConsidered: 1,
      refreshed: 0,
      profilesRebuilt: 0,
      profilesWithNothingToResolve: 1,
      degradationReasons: {},
      stoppedOnQuotaExhaustion: false,
    });
  });

  it('stops the whole batch on a typed quotaExhausted outcome and counts the degradation', async () => {
    const candidates = new FixedCandidateSource([TAXON_A, TAXON_B]);
    const refresher = new ScriptedRefresher(() => ({
      outcome: 'unavailable',
      reason: 'quotaExhausted',
    }));
    const rebuilder = new ScriptedRebuilder(() => 'nothingToResolve');
    const sweep = new RunTaxonEnrichmentSweep(candidates, refresher, rebuilder, ['usda-plants']);

    const result = await sweep.execute();

    expect(result.stoppedOnQuotaExhaustion).toBe(true);
    expect(result.degradationReasons).toEqual({ quotaExhausted: 1 });
    // Stops before TAXON_B's rebuild attempt — the batch-wide stop, not a
    // per-taxon skip.
    expect(rebuilder.calls).toHaveLength(0);
    expect(refresher.calls).toHaveLength(1);
  });

  it('continues to the next taxon after a non-quota degradation, and still rebuilds it', async () => {
    const candidates = new FixedCandidateSource([TAXON_A, TAXON_B]);
    const refresher = new ScriptedRefresher((taxonomyReferenceId) =>
      taxonomyReferenceId === TAXON_A
        ? { outcome: 'unavailable', reason: 'providerReturnedNoMatch' }
        : REFRESHED(taxonomyReferenceId),
    );
    const rebuilder = new ScriptedRebuilder(() => 'rebuilt');
    const sweep = new RunTaxonEnrichmentSweep(candidates, refresher, rebuilder, ['usda-plants']);

    const result = await sweep.execute();

    expect(result.taxaConsidered).toBe(2);
    expect(result.refreshed).toBe(1);
    expect(result.degradationReasons).toEqual({ providerReturnedNoMatch: 1 });
    expect(result.stoppedOnQuotaExhaustion).toBe(false);
    expect(rebuilder.calls.map((call) => call.taxonomyReferenceId)).toEqual([TAXON_A, TAXON_B]);
  });
});
