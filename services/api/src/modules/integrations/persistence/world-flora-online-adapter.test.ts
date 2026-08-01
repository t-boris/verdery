/**
 * Unit tests for the World Flora Online adapter and its payload parser —
 * against RECORDED-SHAPE fixtures taken from real live calls to
 * `list.worldfloraonline.org` on 2026-08-01 (see `world-flora-online-
 * payload.ts`'s own header). No test here touches the network: the
 * adapter's `fetch` slice is injected, the same `usda-plants-adapter.test.ts`
 * precedent.
 */

import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { WorldFloraOnlineHttpFetch } from './world-flora-online-adapter.js';
import { WorldFloraOnlineAdapter } from './world-flora-online-adapter.js';
import { parseWorldFloraOnlineMatchPayload } from './world-flora-online-payload.js';

/** Recorded live unambiguous match for "Quercus alba", trimmed to the fields this adapter reads. */
function recordedUnambiguousMatchPayload(): unknown {
  return {
    inputString: 'Quercus alba',
    match: {
      wfo_id: 'wfo-0000289457',
      full_name_plain: 'Quercus alba L.',
      placement:
        'Code/Plantae/Pteridobiotina/Angiosperms/Fagales/Fagaceae/Quercus/Quercus/Quercus/alba',
    },
    candidates: [],
    error: false,
  };
}

/** Recorded live ambiguous fuzzy match for "Quercus alva", trimmed to two of the real candidates. */
function recordedAmbiguousCandidatesPayload(): unknown {
  return {
    inputString: 'Quercus alva',
    match: null,
    candidates: [
      {
        wfo_id: 'wfo-0000289522',
        full_name_plain: 'Quercus alvarezensis Trel.',
        placement:
          'Code/Plantae/Pteridobiotina/Angiosperms/Fagales/Fagaceae/Quercus/Quercus/Quercus/obtusata$Quercus/alvarezensis',
      },
      {
        wfo_id: 'wfo-0000289457',
        full_name_plain: 'Quercus alba L.',
        placement:
          'Code/Plantae/Pteridobiotina/Angiosperms/Fagales/Fagaceae/Quercus/Quercus/Quercus/alba',
      },
    ],
    error: false,
  };
}

/** Recorded live no-match response for an unmatchable input. */
function recordedNoMatchPayload(): unknown {
  return { inputString: 'Zzzznonexistentplantxyz123', match: null, candidates: [], error: false };
}

describe('World Flora Online payload parser', () => {
  it('resolves an unambiguous match into a single candidate', () => {
    const candidates = parseWorldFloraOnlineMatchPayload(recordedUnambiguousMatchPayload());

    expect(candidates).toEqual([
      { providerTaxonId: 'wfo-0000289457', scientificName: 'Quercus alba L.', confidence: null },
    ]);
  });

  it('falls back to the candidates array when match is null', () => {
    const candidates = parseWorldFloraOnlineMatchPayload(recordedAmbiguousCandidatesPayload());

    expect(candidates).toEqual([
      {
        providerTaxonId: 'wfo-0000289522',
        scientificName: 'Quercus alvarezensis Trel.',
        confidence: null,
      },
      { providerTaxonId: 'wfo-0000289457', scientificName: 'Quercus alba L.', confidence: null },
    ]);
  });

  it('reads no match and no candidates (HTTP 200) as "nothing listed", not malformed', () => {
    expect(parseWorldFloraOnlineMatchPayload(recordedNoMatchPayload())).toEqual([]);
  });

  it('rejects a structurally malformed payload rather than repairing it', () => {
    expect(() => parseWorldFloraOnlineMatchPayload({ notMatch: true })).toThrow(
      DependencyUnavailableError,
    );
  });
});

function scriptedFetch(
  body: unknown,
  status = 200,
): { httpFetch: WorldFloraOnlineHttpFetch; requests: string[] } {
  const requests: string[] = [];
  const httpFetch: WorldFloraOnlineHttpFetch = (url) => {
    requests.push(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { httpFetch, requests };
}

describe('WorldFloraOnlineAdapter', () => {
  const signal = new AbortController().signal;

  it('searches by GETting input_string against matching_rest.php', async () => {
    const { httpFetch, requests } = scriptedFetch(recordedUnambiguousMatchPayload());
    const adapter = new WorldFloraOnlineAdapter(httpFetch);

    const candidates = await adapter.searchTaxa(
      { scientificName: 'Quercus alba', commonName: null },
      signal,
    );

    expect(candidates).toEqual([
      { providerTaxonId: 'wfo-0000289457', scientificName: 'Quercus alba L.', confidence: null },
    ]);
    expect(requests[0]).toContain('list.worldfloraonline.org/matching_rest.php');
    expect(requests[0]).toContain('input_string=Quercus+alba');
  });

  it('always answers fetchFacts and fetchDistribution with an empty array', async () => {
    const adapter = new WorldFloraOnlineAdapter(scriptedFetch(recordedNoMatchPayload()).httpFetch);

    await expect(adapter.fetchFacts('wfo-0000289457', signal)).resolves.toEqual([]);
    await expect(adapter.fetchDistribution('wfo-0000289457', signal)).resolves.toEqual([]);
  });

  it('rejects a non-2xx status as a typed DependencyUnavailableError', async () => {
    const adapter = new WorldFloraOnlineAdapter(scriptedFetch({}, 500).httpFetch);

    await expect(
      adapter.searchTaxa({ scientificName: 'Quercus alba', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.world_flora_online.http_status' });
  });

  it('rejects a transport failure as a typed DependencyUnavailableError', async () => {
    const failing: WorldFloraOnlineHttpFetch = () => Promise.reject(new Error('ECONNRESET'));
    const adapter = new WorldFloraOnlineAdapter(failing);

    await expect(
      adapter.searchTaxa({ scientificName: 'Quercus alba', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.world_flora_online.request_failed' });
  });
});
