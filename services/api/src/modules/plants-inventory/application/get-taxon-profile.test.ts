import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { GetTaxonProfile } from './get-taxon-profile.js';

const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

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
    const getTaxonProfile = new GetTaxonProfile(profileVersions);

    const result = await getTaxonProfile.execute(TAXONOMY_ID);
    expect(result.taxonomyReferenceId).toBe(TAXONOMY_ID);
  });

  it('reports not found when no profile has ever been assembled', async () => {
    const profileVersions = new (class {
      insert = () => Promise.resolve();
      findLatest = () => Promise.resolve(null);
    })();
    const getTaxonProfile = new GetTaxonProfile(profileVersions);

    await expect(getTaxonProfile.execute(TAXONOMY_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
