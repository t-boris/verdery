import { describe, expect, it } from 'vitest';
import { GetTaxonProfile } from './get-taxon-profile.js';

const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

/** No provider imagery — the state every taxon starts in. */
function noImages() {
  return { listPresentable: () => Promise.resolve([]) };
}

function noEnrichment() {
  return { enrich: () => Promise.resolve() };
}

describe('GetTaxonProfile', () => {
  it('returns the latest profile version when one exists', async () => {
    const profileVersions = new (class {
      insert = () => Promise.resolve();
      findLatest = () =>
        Promise.resolve({
          id: 'profile-1',
          taxonomyReferenceId: TAXONOMY_ID,
          resolvedFacts: [],
          isPartial: true,
          createdAt: new Date('2026-07-29T00:00:00Z'),
        });
    })();
    const getTaxonProfile = new GetTaxonProfile(profileVersions, noImages(), noEnrichment());

    const result = await getTaxonProfile.execute(TAXONOMY_ID);
    expect(result.profile?.taxonomyReferenceId).toBe(TAXONOMY_ID);
    expect(result.images).toEqual([]);
  });

  it('returns imagery independently when no fact profile has been assembled', async () => {
    const profileVersions = new (class {
      insert = () => Promise.resolve();
      findLatest = () => Promise.resolve(null);
    })();
    const getTaxonProfile = new GetTaxonProfile(profileVersions, noImages(), noEnrichment());

    await expect(getTaxonProfile.execute(TAXONOMY_ID)).resolves.toEqual({
      profile: null,
      images: [],
    });
  });
  it('carries the imagery permitted to accompany the profile', async () => {
    const profileVersions = new (class {
      insert = () => Promise.resolve();
      findLatest = () =>
        Promise.resolve({
          id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01' as const,
          taxonomyReferenceId: TAXONOMY_ID,
          resolvedFacts: [],
          isPartial: false,
          createdAt: new Date('2026-07-29T00:00:00Z'),
        });
    })();
    const image = {
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02' as const,
      sourceUrl: 'https://example.org/tomato.jpg',
      license: 'cc_by',
      attribution: 'A. Botanist',
      organ: null,
    };
    const getTaxonProfile = new GetTaxonProfile(
      profileVersions,
      { listPresentable: () => Promise.resolve([image]) },
      noEnrichment(),
    );

    const result = await getTaxonProfile.execute(TAXONOMY_ID);

    expect(result.images).toEqual([image]);
  });

  it('enriches an empty image cache and returns the newly stored licensed images', async () => {
    const profileVersions = {
      insert: () => Promise.resolve(),
      findLatest: () => Promise.resolve(null),
    };
    const image = {
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03' as const,
      sourceUrl: 'https://example.org/ash.jpg',
      license: 'cc0',
      attribution: null,
      organ: null,
    };
    let enriched = false;
    const getTaxonProfile = new GetTaxonProfile(
      profileVersions,
      { listPresentable: () => Promise.resolve(enriched ? [image] : []) },
      {
        enrich: () => {
          enriched = true;
          return Promise.resolve();
        },
      },
    );

    await expect(getTaxonProfile.execute(TAXONOMY_ID)).resolves.toEqual({
      profile: null,
      images: [image],
    });
  });
});
