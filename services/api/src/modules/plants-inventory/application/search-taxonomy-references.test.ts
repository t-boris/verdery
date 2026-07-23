import { describe, expect, it } from 'vitest';
import type { TaxonomyReference } from '../domain/taxonomy-reference.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';
import { SearchTaxonomyReferences } from './search-taxonomy-references.js';

const TOMATO: TaxonomyReference = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  scientificName: 'Solanum lycopersicum',
  commonName: 'Tomato',
  varietyName: null,
  source: 'system_catalog',
  createdByProfileId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

class FakeTaxonomyReferenceRepository implements TaxonomyReferenceRepository {
  lastQuery: string | null | undefined;
  lastLimit: number | undefined;

  search(query: string | null, limit: number): Promise<TaxonomyReference[]> {
    this.lastQuery = query;
    this.lastLimit = limit;
    return Promise.resolve([TOMATO]);
  }
}

describe('SearchTaxonomyReferences', () => {
  it('maps repository results to resources', async () => {
    const repository = new FakeTaxonomyReferenceRepository();
    const search = new SearchTaxonomyReferences(repository);

    const results = await search.execute('tomato', 10);

    expect(results).toEqual([
      {
        id: TOMATO.id,
        scientificName: 'Solanum lycopersicum',
        commonName: 'Tomato',
        varietyName: null,
        source: 'system_catalog',
        createdByProfileId: null,
        createdAt: TOMATO.createdAt.toISOString(),
      },
    ]);
    expect(repository.lastQuery).toBe('tomato');
    expect(repository.lastLimit).toBe(10);
  });

  it('treats a blank query the same as no query', async () => {
    const repository = new FakeTaxonomyReferenceRepository();
    const search = new SearchTaxonomyReferences(repository);

    await search.execute('   ');

    expect(repository.lastQuery).toBeNull();
  });

  it('bounds the limit to the configured maximum and minimum', async () => {
    const repository = new FakeTaxonomyReferenceRepository();
    const search = new SearchTaxonomyReferences(repository);

    await search.execute(null, 10_000);
    expect(repository.lastLimit).toBe(100);

    await search.execute(null, -5);
    expect(repository.lastLimit).toBe(1);
  });

  it('defaults the limit when omitted', async () => {
    const repository = new FakeTaxonomyReferenceRepository();
    const search = new SearchTaxonomyReferences(repository);

    await search.execute(null);
    expect(repository.lastLimit).toBe(20);
  });
});
