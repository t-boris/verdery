import { describe, expect, it, vi } from 'vitest';

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import {
  UsCensusGeocodingAdapter,
  type GeocodingHttpFetch,
  type GeocodingHttpResponse,
} from './us-census-geocoding-adapter.js';

const MATCH_BODY = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -93.63, y: 41.59 },
        addressComponents: { fromAddress: '100' },
        matchedAddress: '100 GRAND AVE, DES MOINES, IA, 50309',
      },
    ],
  },
};

function respondWith(body: unknown, status = 200): GeocodingHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function adapterFor(fetch: GeocodingHttpFetch): UsCensusGeocodingAdapter {
  return new UsCensusGeocodingAdapter({ fetch });
}

const SIGNAL = new AbortController().signal;

describe('UsCensusGeocodingAdapter', () => {
  it('returns normalized candidates', async () => {
    const adapter = adapterFor(() => Promise.resolve(respondWith(MATCH_BODY)));

    await expect(adapter.findAddressCandidates('100 Grand Ave', SIGNAL)).resolves.toEqual([
      {
        formattedAddress: '100 GRAND AVE, DES MOINES, IA, 50309',
        position: [-93.63, 41.59],
        precision: 'streetAddress',
      },
    ]);
  });

  it('asks the current public address ranges, not whatever the service defaults to', async () => {
    const fetch = vi.fn<GeocodingHttpFetch>(() => Promise.resolve(respondWith(MATCH_BODY)));

    await adapterFor(fetch).findAddressCandidates('100 Grand Ave', SIGNAL);

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/geocoder/locations/onelineaddress');
    expect(url.searchParams.get('address')).toBe('100 Grand Ave');
    expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it("passes the caller's signal, so a deadline really cancels the request", async () => {
    const fetch = vi.fn<GeocodingHttpFetch>(() => Promise.resolve(respondWith(MATCH_BODY)));

    await adapterFor(fetch).findAddressCandidates('100 Grand Ave', SIGNAL);

    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(SIGNAL);
  });

  it('reports an unreachable service as a dependency failure', async () => {
    const adapter = adapterFor(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(adapter.findAddressCandidates('100 Grand Ave', SIGNAL)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('reports a non-2xx status as a dependency failure', async () => {
    const adapter = adapterFor(() => Promise.resolve(respondWith({}, 503)));

    await expect(adapter.findAddressCandidates('100 Grand Ave', SIGNAL)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('reports an unreadable body as a dependency failure', async () => {
    const adapter = adapterFor(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('not json')) }),
    );

    await expect(adapter.findAddressCandidates('100 Grand Ave', SIGNAL)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('reports an unexpected payload as a dependency failure rather than an empty result', async () => {
    const adapter = adapterFor(() => Promise.resolve(respondWith({ unexpected: true })));

    await expect(adapter.findAddressCandidates('100 Grand Ave', SIGNAL)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  // An address outside the United States is not an error: the service simply
  // has no coverage for it, and the caller shows "no matches".
  it('returns nothing for an address the service does not cover', async () => {
    const adapter = adapterFor(() =>
      Promise.resolve(respondWith({ result: { addressMatches: [] } })),
    );

    await expect(adapter.findAddressCandidates('Тверская 1, Москва', SIGNAL)).resolves.toEqual([]);
  });
});
