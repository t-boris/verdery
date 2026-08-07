import { describe, expect, it, vi } from 'vitest';

import { createPlantMediaAsset } from '../domain/plant-media-asset.js';
import { KyselyPlantMediaAssetRepository } from './kysely-plant-media-asset-repository.js';

describe('KyselyPlantMediaAssetRepository', () => {
  it('repeats the partial unique-index predicate in the conflict target', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const doUpdateSet = vi.fn(() => ({ execute }));
    const where = vi.fn(() => ({ doUpdateSet }));
    const columns = vi.fn(() => ({ where }));
    const onConflict = vi.fn((build: (builder: { columns: typeof columns }) => unknown) =>
      build({ columns }),
    );
    const values = vi.fn(() => ({ onConflict }));
    const insertInto = vi.fn(() => ({ values }));
    const repository = new KyselyPlantMediaAssetRepository({ insertInto } as never);
    const asset = createPlantMediaAsset({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
      rawProviderTaxonId: 'GBIF-123',
      mediaId: null,
      sourceUrl: 'https://images.example.org/leaf.jpg',
      organ: 'leaf',
      inferredOrgan: false,
      rawLicense: 'cc_by',
      attributionText: 'A. Botanist',
      creator: 'A. Botanist',
      rightsHolder: 'A. Botanist',
      observedAt: null,
      generalizedLocation: null,
      ingestionState: 'discovered',
      now: new Date('2026-08-06T12:00:00Z'),
    });

    await repository.upsert('gbif', asset);

    expect(columns).toHaveBeenCalledWith(['provider_key', 'source_url']);
    expect(where).toHaveBeenCalledWith('source_url', 'is not', null);
    expect(execute).toHaveBeenCalledOnce();
  });
});
