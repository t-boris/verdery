import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../platform/errors/application-error.js';
import type {
  AddressGeocodingAdapter,
  GeocodedAddressCandidate,
} from './address-geocoding-provider.js';
import { FindAddressCandidates } from './find-address-candidates.js';

const CANDIDATE: GeocodedAddressCandidate = {
  formattedAddress: '100 GRAND AVE, DES MOINES, IA, 50309',
  position: [-93.63, 41.59],
  precision: 'streetAddress',
};

function geocoderReturning(
  candidates: readonly GeocodedAddressCandidate[],
): AddressGeocodingAdapter {
  return { findAddressCandidates: () => Promise.resolve(candidates) };
}

describe('FindAddressCandidates', () => {
  it('returns what the provider found', async () => {
    const useCase = new FindAddressCandidates(geocoderReturning([CANDIDATE]));

    await expect(useCase.execute('100 Grand Ave')).resolves.toEqual({
      kind: 'candidates',
      candidates: [CANDIDATE],
    });
  });

  // The distinction the interface depends on: an address that does not exist
  // is a different answer from a provider that could not be asked.
  it('reports no matches as an empty candidate list, not as unavailability', async () => {
    const useCase = new FindAddressCandidates(geocoderReturning([]));

    await expect(useCase.execute('nowhere at all')).resolves.toEqual({
      kind: 'candidates',
      candidates: [],
    });
  });

  it('degrades a provider failure instead of failing the request', async () => {
    const useCase = new FindAddressCandidates({
      findAddressCandidates: () => Promise.reject(new Error('provider down')),
    });

    await expect(useCase.execute('100 Grand Ave')).resolves.toEqual({ kind: 'unavailable' });
  });

  it('degrades a provider that never answers', async () => {
    vi.useFakeTimers();
    try {
      const useCase = new FindAddressCandidates({
        findAddressCandidates: () => new Promise(() => {}),
      });

      const pending = useCase.execute('100 Grand Ave');
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toEqual({ kind: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('trims before deciding whether a query is long enough', async () => {
    const geocoder = { findAddressCandidates: vi.fn(() => Promise.resolve([CANDIDATE])) };
    const useCase = new FindAddressCandidates(geocoder);

    await useCase.execute('   100 Grand Ave   ');

    expect(geocoder.findAddressCandidates).toHaveBeenCalledWith('100 Grand Ave', expect.anything());
  });

  it.each([
    ['', 'empty'],
    ['ab', 'two characters'],
    ['x'.repeat(201), 'past the limit'],
  ])('refuses a query that is %s (%s)', async (query) => {
    const geocoder = { findAddressCandidates: vi.fn(() => Promise.resolve([])) };

    await expect(new FindAddressCandidates(geocoder).execute(query)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(geocoder.findAddressCandidates).not.toHaveBeenCalled();
  });
});
