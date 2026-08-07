/**
 * Unit tests for the GBIF adapter and its payload parsers — against
 * RECORDED-SHAPE fixtures taken from real live calls to `api.gbif.org` on
 * 2026-08-01 (see `gbif-payload.ts`'s own header). No test here touches the
 * network: the adapter's `fetch` slice is injected, the same
 * `usda-plants-adapter.test.ts` precedent.
 */

import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { GbifHttpFetch } from './gbif-adapter.js';
import { GbifAdapter } from './gbif-adapter.js';
import { parseGbifOccurrenceFacetPayload, parseGbifSpeciesMatchPayload } from './gbif-payload.js';

/** Recorded live species/match response for "Quercus alba". */
function recordedMatchPayload(): unknown {
  return {
    usageKey: 2879737,
    scientificName: 'Quercus alba L.',
    canonicalName: 'Quercus alba',
    rank: 'SPECIES',
    status: 'ACCEPTED',
    confidence: 98,
    matchType: 'EXACT',
  };
}

/** Recorded live species/match response for an unmatchable input. */
function recordedNoMatchPayload(): unknown {
  return { confidence: 100, matchType: 'NONE', synonym: false };
}

/** Recorded live occurrence-search facet response for Quercus alba (taxonKey 2879737), trimmed to 5 states. */
function recordedOccurrenceFacetPayload(): unknown {
  return {
    offset: 0,
    limit: 0,
    endOfRecords: false,
    count: 51258,
    results: [],
    facets: [
      {
        field: 'STATE_PROVINCE',
        counts: [
          { name: 'Massachusetts', count: 7191 },
          { name: 'New York', count: 6302 },
          { name: 'Virginia', count: 3583 },
          { name: 'North Carolina', count: 3135 },
          { name: 'New Jersey', count: 2579 },
        ],
      },
    ],
  };
}

describe('GBIF payload parsers', () => {
  it('normalizes a real match, scaling confidence from 0-100 to 0-1', () => {
    const candidates = parseGbifSpeciesMatchPayload(recordedMatchPayload());

    expect(candidates).toEqual([
      { providerTaxonId: '2879737', scientificName: 'Quercus alba', confidence: 0.98 },
    ]);
  });

  it('reads matchType NONE (no usageKey) as "nothing listed", not malformed', () => {
    expect(parseGbifSpeciesMatchPayload(recordedNoMatchPayload())).toEqual([]);
  });

  it('emits a nationwide total fact plus one per-state fact from the facet response', () => {
    const facts = parseGbifOccurrenceFacetPayload(recordedOccurrenceFacetPayload());

    expect(facts).toEqual([
      {
        factKey: 'occurrence_evidence_count',
        value: '51258',
        unit: 'records',
        confidence: null,
        geographicScope: null,
      },
      {
        factKey: 'occurrence_evidence_count',
        value: '7191',
        unit: 'records',
        confidence: null,
        geographicScope: 'Massachusetts',
      },
      {
        factKey: 'occurrence_evidence_count',
        value: '6302',
        unit: 'records',
        confidence: null,
        geographicScope: 'New York',
      },
      {
        factKey: 'occurrence_evidence_count',
        value: '3583',
        unit: 'records',
        confidence: null,
        geographicScope: 'Virginia',
      },
      {
        factKey: 'occurrence_evidence_count',
        value: '3135',
        unit: 'records',
        confidence: null,
        geographicScope: 'North Carolina',
      },
      {
        factKey: 'occurrence_evidence_count',
        value: '2579',
        unit: 'records',
        confidence: null,
        geographicScope: 'New Jersey',
      },
    ]);
  });

  it('reads a zero-count response as "nothing listed", not malformed', () => {
    expect(
      parseGbifOccurrenceFacetPayload({
        count: 0,
        facets: [{ field: 'STATE_PROVINCE', counts: [] }],
      }),
    ).toEqual([]);
  });

  it('rejects a structurally malformed payload rather than repairing it', () => {
    expect(() => parseGbifSpeciesMatchPayload({ notAMatch: true })).toThrow(
      DependencyUnavailableError,
    );
    expect(() => parseGbifOccurrenceFacetPayload({ notCount: true })).toThrow(
      DependencyUnavailableError,
    );
  });
});

function scriptedFetch(
  byUrlSubstring: readonly { match: string; body: unknown; status?: number }[],
): { httpFetch: GbifHttpFetch; requests: string[] } {
  const requests: string[] = [];
  const httpFetch: GbifHttpFetch = (url) => {
    requests.push(url);
    const entry = byUrlSubstring.find((candidate) => url.includes(candidate.match));
    if (entry === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    const status = entry.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(entry.body),
    });
  };
  return { httpFetch, requests };
}

describe('GbifAdapter', () => {
  const signal = new AbortController().signal;

  it('searches by GETting the scientific name to the species/match endpoint', async () => {
    const { httpFetch, requests } = scriptedFetch([
      { match: '/v1/species/match', body: recordedMatchPayload() },
    ]);
    const adapter = new GbifAdapter(httpFetch);

    const candidates = await adapter.searchTaxa(
      { scientificName: 'Quercus alba', commonName: null },
      signal,
    );

    expect(candidates[0]?.providerTaxonId).toBe('2879737');
    expect(requests[0]).toContain('api.gbif.org/v1/species/match');
    expect(requests[0]).toContain('name=Quercus+alba');
  });

  it('fetches occurrence facets scoped to country=US with the given taxonKey', async () => {
    const { httpFetch, requests } = scriptedFetch([
      { match: '/v1/occurrence/search', body: recordedOccurrenceFacetPayload() },
    ]);
    const adapter = new GbifAdapter(httpFetch);

    const facts = await adapter.fetchFacts('2879737', signal);

    expect(facts).toHaveLength(6);
    expect(requests[0]).toContain('taxonKey=2879737');
    expect(requests[0]).toContain('country=US');
    expect(requests[0]).toContain('facet=stateProvince');
  });

  it('always answers fetchDistribution with an empty array', async () => {
    const adapter = new GbifAdapter(scriptedFetch([]).httpFetch);

    await expect(adapter.fetchDistribution('2879737', signal)).resolves.toEqual([]);
  });

  it('rejects a non-2xx status as a typed DependencyUnavailableError', async () => {
    const { httpFetch } = scriptedFetch([{ match: '/v1/species/match', body: {}, status: 503 }]);
    const adapter = new GbifAdapter(httpFetch);

    await expect(
      adapter.searchTaxa({ scientificName: 'Quercus alba', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.gbif.http_status' });
  });

  it('rejects a transport failure as a typed DependencyUnavailableError', async () => {
    const failing: GbifHttpFetch = () => Promise.reject(new Error('ECONNRESET'));
    const adapter = new GbifAdapter(failing);

    await expect(
      adapter.searchTaxa({ scientificName: 'Quercus alba', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.gbif.request_failed' });
  });
  it('reads a licence per media entry, keeping the unusable ones as facts', async () => {
    // The case this whole pass exists for: one GBIF response mixes CC0,
    // CC-BY and CC-BY-NC. Dropping the unusable entries here would erase the
    // difference between "no photographs exist" and "every photograph is
    // unusable".
    const { httpFetch, requests } = scriptedFetch([
      {
        match: 'occurrence/search',
        body: {
          results: [
            {
              key: 8811,
              country: 'United States',
              stateProvince: 'Illinois',
              media: [
                {
                  type: 'StillImage',
                  identifier: 'https://example.org/a.jpg',
                  license: 'http://creativecommons.org/publicdomain/zero/1.0/',
                  creator: 'A. Botanist',
                },
                {
                  type: 'StillImage',
                  identifier: 'https://example.org/b.jpg',
                  license: 'http://creativecommons.org/licenses/by-nc/4.0/',
                  rightsHolder: 'Someone Else',
                },
                // No licence at all: kept, recorded as unknown, refused later.
                { type: 'StillImage', identifier: 'https://example.org/c.jpg' },
              ],
            },
          ],
        },
      },
    ]);
    const adapter = new GbifAdapter(httpFetch);

    const media = await adapter.fetchMedia('8811', new AbortController().signal);

    expect(media.map((entry) => entry.rawLicence)).toEqual([
      'http://creativecommons.org/publicdomain/zero/1.0/',
      'http://creativecommons.org/licenses/by-nc/4.0/',
      null,
    ]);
    expect(media[0]?.providerAssetId).toBe('8811:0');
    expect(media[0]?.generalizedLocation).toBe('United States, Illinois');
    expect(requests[0]).toContain('country=US');
    expect(requests[0]).toContain('occurrenceStatus=PRESENT');
    expect(requests[0]).toContain('basisOfRecord=HUMAN_OBSERVATION');
    expect(requests[0]).toContain('mediaType=StillImage');
    expect(requests[0]).toContain('limit=100');
  });

  it('skips entries with nothing showable: no URL, a non-image, or an insecure URL', async () => {
    const adapter = new GbifAdapter(
      scriptedFetch([
        {
          match: 'occurrence/search',
          body: {
            results: [
              {
                key: 8811,
                media: [
                  { type: 'Sound', identifier: 'https://example.org/song.mp3' },
                  { type: 'StillImage', license: 'CC0' },
                  { type: 'StillImage', identifier: 'http://example.org/insecure.jpg' },
                  {
                    type: 'StillImage',
                    identifier: 'https://example.org/good.jpg',
                    license: 'CC0',
                  },
                ],
              },
            ],
          },
        },
      ]).httpFetch,
    );

    const media = await adapter.fetchMedia('8811', new AbortController().signal);

    expect(media.map((entry) => entry.sourceUrl)).toEqual(['https://example.org/good.jpg']);
  });

  it('answers empty when the taxon has no media, rather than failing', async () => {
    const adapter = new GbifAdapter(
      scriptedFetch([{ match: 'occurrence/search', body: { results: [] } }]).httpFetch,
    );

    await expect(adapter.fetchMedia('8811', new AbortController().signal)).resolves.toEqual([]);
  });
});
