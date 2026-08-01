/**
 * Test doubles for the structured fact/distribution assertion capability
 * (P11-ASYNC-01) — split out of `integrations-test-doubles.ts` for the same
 * 600-line reason `plant-candidate-test-doubles.ts` was split out of
 * `plants-inventory-test-doubles.ts`. Not a `*.test.ts` file, so vitest
 * never runs it as a suite.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantDistributionAssertion } from '../domain/plant-distribution-assertion.js';
import type { PlantFactAssertion } from '../domain/plant-fact-assertion.js';
import type { PlantDistributionAssertionRepository } from './plant-distribution-assertion-repository.js';
import type { PlantFactAssertionRepository } from './plant-fact-assertion-repository.js';
import type {
  NormalizedDistributionCandidate,
  NormalizedFactCandidate,
  PlantAssertionProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from './plant-assertion-provider.js';

export type FakeAssertionTaxaSearchBehavior =
  | { readonly kind: 'succeed'; readonly candidates: readonly ProviderTaxonCandidate[] }
  | { readonly kind: 'fail'; readonly error?: unknown }
  | { readonly kind: 'hang' };

export type FakeAssertionFetchBehavior<T> =
  | { readonly kind: 'succeed'; readonly value: readonly T[] }
  | { readonly kind: 'fail'; readonly error?: unknown }
  | { readonly kind: 'hang' };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('fake provider failure', { cause: error });
}

function hang<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted by deadline')));
  });
}

/**
 * A scriptable `PlantAssertionProviderAdapter`. Per-operation call counts
 * are the load-bearing assertion surface — the `FakePlantContentProviderAdapter`
 * precedent, extended to a third operation.
 */
export class FakePlantAssertionProviderAdapter implements PlantAssertionProviderAdapter {
  searchCallCount = 0;
  factsCallCount = 0;
  distributionCallCount = 0;
  lastSearchQuery: TaxonomyIdentityQuery | null = null;
  lastFactsProviderTaxonId: string | null = null;
  lastDistributionProviderTaxonId: string | null = null;

  constructor(
    private searchBehavior: FakeAssertionTaxaSearchBehavior,
    private factsBehavior: FakeAssertionFetchBehavior<NormalizedFactCandidate>,
    private distributionBehavior: FakeAssertionFetchBehavior<NormalizedDistributionCandidate>,
  ) {}

  setSearchBehavior(behavior: FakeAssertionTaxaSearchBehavior): void {
    this.searchBehavior = behavior;
  }

  setFactsBehavior(behavior: FakeAssertionFetchBehavior<NormalizedFactCandidate>): void {
    this.factsBehavior = behavior;
  }

  setDistributionBehavior(
    behavior: FakeAssertionFetchBehavior<NormalizedDistributionCandidate>,
  ): void {
    this.distributionBehavior = behavior;
  }

  searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]> {
    this.searchCallCount += 1;
    this.lastSearchQuery = query;
    const behavior = this.searchBehavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve(behavior.candidates);
      case 'fail':
        return Promise.reject(toError(behavior.error));
      case 'hang':
        return hang(signal);
    }
  }

  fetchFacts(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedFactCandidate[]> {
    this.factsCallCount += 1;
    this.lastFactsProviderTaxonId = providerTaxonId;
    const behavior = this.factsBehavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve(behavior.value);
      case 'fail':
        return Promise.reject(toError(behavior.error));
      case 'hang':
        return hang(signal);
    }
  }

  fetchDistribution(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedDistributionCandidate[]> {
    this.distributionCallCount += 1;
    this.lastDistributionProviderTaxonId = providerTaxonId;
    const behavior = this.distributionBehavior;
    switch (behavior.kind) {
      case 'succeed':
        return Promise.resolve(behavior.value);
      case 'fail':
        return Promise.reject(toError(behavior.error));
      case 'hang':
        return hang(signal);
    }
  }
}

export class InMemoryPlantFactAssertionRepository implements PlantFactAssertionRepository {
  readonly assertions: PlantFactAssertion[] = [];

  insert(assertion: PlantFactAssertion): Promise<void> {
    this.assertions.push(assertion);
    return Promise.resolve();
  }

  findAllForProviderTaxon(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantFactAssertion[]> {
    return Promise.resolve(
      this.assertions.filter(
        (assertion) =>
          assertion.provenance.providerKey === providerKey &&
          assertion.providerTaxonId === providerTaxonId,
      ),
    );
  }

  findAllAwaitingReview(limit: number): Promise<readonly PlantFactAssertion[]> {
    return Promise.resolve(
      this.assertions
        .filter(
          (assertion) => assertion.provenance.reviewStatus === 'awaiting_horticultural_review',
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit),
    );
  }

  approveReview(assertionId: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean> {
    const index = this.assertions.findIndex(
      (assertion) =>
        assertion.id === assertionId &&
        assertion.provenance.reviewStatus === 'awaiting_horticultural_review',
    );
    if (index === -1) {
      return Promise.resolve(false);
    }
    const current = this.assertions[index] as PlantFactAssertion;
    this.assertions[index] = {
      ...current,
      provenance: {
        ...current.provenance,
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy,
        reviewedOn,
      },
    };
    return Promise.resolve(true);
  }
}

export class InMemoryPlantDistributionAssertionRepository implements PlantDistributionAssertionRepository {
  readonly assertions: PlantDistributionAssertion[] = [];

  insert(assertion: PlantDistributionAssertion): Promise<void> {
    this.assertions.push(assertion);
    return Promise.resolve();
  }

  findAllForProviderTaxon(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantDistributionAssertion[]> {
    return Promise.resolve(
      this.assertions.filter(
        (assertion) =>
          assertion.provenance.providerKey === providerKey &&
          assertion.providerTaxonId === providerTaxonId,
      ),
    );
  }

  findAllAwaitingReview(limit: number): Promise<readonly PlantDistributionAssertion[]> {
    return Promise.resolve(
      this.assertions
        .filter(
          (assertion) => assertion.provenance.reviewStatus === 'awaiting_horticultural_review',
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit),
    );
  }

  approveReview(assertionId: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean> {
    const index = this.assertions.findIndex(
      (assertion) =>
        assertion.id === assertionId &&
        assertion.provenance.reviewStatus === 'awaiting_horticultural_review',
    );
    if (index === -1) {
      return Promise.resolve(false);
    }
    const current = this.assertions[index] as PlantDistributionAssertion;
    this.assertions[index] = {
      ...current,
      provenance: {
        ...current.provenance,
        reviewStatus: 'horticulturally_reviewed',
        reviewedBy,
        reviewedOn,
      },
    };
    return Promise.resolve(true);
  }
}

/** A distinct-enough `Uuid` sequence for tests that need several ids without caring about their exact values. */
export function sequentialIdGenerator(prefix: string): () => Uuid {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter)}`;
  };
}
