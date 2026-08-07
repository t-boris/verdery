import { describe, expect, it, vi } from 'vitest';

import { EnrichTaxonImages } from './enrich-taxon-images.js';

const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

describe('EnrichTaxonImages', () => {
  it('asks every configured provider in priority order', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ outcome: 'refreshed', factsWritten: 0, distributionWritten: 0 });
    await new EnrichTaxonImages({ execute } as never, ['wfo', 'gbif']).enrich(TAXONOMY_ID);
    expect(execute.mock.calls).toEqual([
      [{ taxonomyReferenceId: TAXONOMY_ID, providerKey: 'wfo' }],
      [{ taxonomyReferenceId: TAXONOMY_ID, providerKey: 'gbif' }],
    ]);
  });

  it('stops when the shared provider quota is exhausted', async () => {
    const execute = vi.fn().mockResolvedValue({ outcome: 'unavailable', reason: 'quotaExhausted' });
    await new EnrichTaxonImages({ execute } as never, ['gbif', 'usda']).enrich(TAXONOMY_ID);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
