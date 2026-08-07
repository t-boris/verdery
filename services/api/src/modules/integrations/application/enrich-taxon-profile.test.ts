import { describe, expect, it, vi } from 'vitest';

import { EnrichTaxonProfile } from './enrich-taxon-profile.js';

const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

describe('EnrichTaxonProfile', () => {
  it('asks every configured provider in priority order and materializes the result', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ outcome: 'refreshed', factsWritten: 1, distributionWritten: 0 });
    const rebuild = vi.fn().mockResolvedValue({ outcome: 'rebuilt' });

    await new EnrichTaxonProfile({ execute } as never, { execute: rebuild }, [
      'wfo',
      'gbif',
    ]).enrich(TAXONOMY_ID);

    expect(execute.mock.calls).toEqual([
      [{ taxonomyReferenceId: TAXONOMY_ID, providerKey: 'wfo' }],
      [{ taxonomyReferenceId: TAXONOMY_ID, providerKey: 'gbif' }],
    ]);
    expect(rebuild).toHaveBeenCalledWith(TAXONOMY_ID, ['wfo', 'gbif']);
  });

  it('stops fetching on quota exhaustion but still materializes stored assertions', async () => {
    const execute = vi.fn().mockResolvedValue({ outcome: 'unavailable', reason: 'quotaExhausted' });
    const rebuild = vi.fn().mockResolvedValue({ outcome: 'nothingToResolve' });

    await new EnrichTaxonProfile({ execute } as never, { execute: rebuild }, [
      'gbif',
      'usda',
    ]).enrich(TAXONOMY_ID);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledOnce();
  });
});
