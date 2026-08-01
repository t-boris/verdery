/**
 * Unit tests for the USA-NPN adapter and its payload parsers — against
 * RECORDED-SHAPE fixtures taken from real live calls to
 * `services.usanpn.org` on 2026-08-01 (see `usa-npn-payload.ts`'s own
 * header). No test here touches the network: the adapter's `fetch` slice is
 * injected, the same `usda-plants-adapter.test.ts` precedent.
 */

import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import { fixedClock } from '../application/integrations-test-doubles.js';
import type { UsaNpnHttpFetch } from './usa-npn-adapter.js';
import { lastCompletedCalendarYear, UsaNpnAdapter } from './usa-npn-adapter.js';
import {
  parseUsaNpnSpeciesCatalogPayload,
  parseUsaNpnSummarizedDataPayload,
} from './usa-npn-payload.js';

const NOW = new Date('2026-08-01T00:00:00.000Z');

/** Recorded live species-catalog response, trimmed to 3 real entries. */
function recordedSpeciesCatalogPayload(): unknown {
  return [
    {
      species_id: 120,
      common_name: "'ohi'a lehua",
      genus: 'Metrosideros',
      species: 'polymorpha',
      kingdom: 'Plantae',
    },
    {
      species_id: 1365,
      common_name: 'Arizona white oak',
      genus: 'Quercus',
      species: 'arizonica',
      kingdom: 'Plantae',
    },
    {
      species_id: 1159,
      common_name: 'black oak',
      genus: 'Quercus',
      species: 'velutina',
      kingdom: 'Plantae',
    },
  ];
}

/** Recorded live summarized-data response for species_id 120, trimmed to real per-phenophase rows across two states. */
function recordedSummarizedDataPayload(): unknown {
  return [
    {
      site_id: 1904,
      state: 'MN',
      species_id: 120,
      phenophase_description: 'Ripe fruits',
      first_yes_year: 2023,
      first_yes_month: 7,
      first_yes_day: 10,
      last_yes_year: 2023,
      last_yes_month: 7,
      last_yes_day: 15,
    },
    {
      site_id: 1905,
      state: 'MN',
      species_id: 120,
      phenophase_description: 'Ripe fruits',
      first_yes_year: 2023,
      first_yes_month: 7,
      first_yes_day: 4,
      last_yes_year: 2023,
      last_yes_month: 7,
      last_yes_day: 20,
    },
    {
      site_id: 1906,
      state: 'HI',
      species_id: 120,
      phenophase_description: 'Ripe fruits',
      first_yes_year: 2023,
      first_yes_month: 6,
      first_yes_day: 1,
      last_yes_year: 2023,
      last_yes_month: 6,
      last_yes_day: 10,
    },
    {
      site_id: 1904,
      state: 'MN',
      species_id: 120,
      phenophase_description: 'Breaking leaf buds',
      first_yes_year: 2023,
      first_yes_month: 5,
      first_yes_day: 15,
      last_yes_year: 2023,
      last_yes_month: 5,
      last_yes_day: 20,
    },
  ];
}

describe('lastCompletedCalendarYear', () => {
  it('returns the year before the given date', () => {
    expect(lastCompletedCalendarYear(NOW)).toBe(2025);
  });
});

describe('USA-NPN payload parsers', () => {
  it('normalizes the species catalog', () => {
    const catalog = parseUsaNpnSpeciesCatalogPayload(recordedSpeciesCatalogPayload());

    expect(catalog).toEqual([
      { speciesId: 120, genus: 'Metrosideros', species: 'polymorpha', commonName: "'ohi'a lehua" },
      { speciesId: 1365, genus: 'Quercus', species: 'arizonica', commonName: 'Arizona white oak' },
      { speciesId: 1159, genus: 'Quercus', species: 'velutina', commonName: 'black oak' },
    ]);
  });

  it('aggregates summarized-data rows into one fact per phenophase/state, taking the widest observed window', () => {
    const facts = parseUsaNpnSummarizedDataPayload(recordedSummarizedDataPayload());

    expect(facts).toEqual([
      {
        factKey: 'ripe_fruits',
        value: '07-04 to 07-20',
        unit: null,
        confidence: null,
        geographicScope: 'MN',
      },
      {
        factKey: 'ripe_fruits',
        value: '06-01 to 06-10',
        unit: null,
        confidence: null,
        geographicScope: 'HI',
      },
      {
        factKey: 'breaking_leaf_buds',
        value: '05-15 to 05-20',
        unit: null,
        confidence: null,
        geographicScope: 'MN',
      },
    ]);
  });

  it('reads an empty array (HTTP 200, no data for this species/year) as "nothing listed", not malformed', () => {
    expect(parseUsaNpnSummarizedDataPayload([])).toEqual([]);
  });

  it('rejects a structurally malformed payload rather than repairing it', () => {
    expect(() => parseUsaNpnSpeciesCatalogPayload({ not: 'an array' })).toThrow(
      DependencyUnavailableError,
    );
    expect(() => parseUsaNpnSummarizedDataPayload({ not: 'an array' })).toThrow(
      DependencyUnavailableError,
    );
  });
});

function scriptedFetch(
  byUrlSubstring: readonly { match: string; body: unknown; status?: number }[],
): { httpFetch: UsaNpnHttpFetch; requests: string[] } {
  const requests: string[] = [];
  const httpFetch: UsaNpnHttpFetch = (url) => {
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

describe('UsaNpnAdapter', () => {
  const signal = new AbortController().signal;

  it('searches the full catalog for an exact, case-insensitive binomial match', async () => {
    const { httpFetch, requests } = scriptedFetch([
      { match: '/npn_portal/species/getSpecies.json', body: recordedSpeciesCatalogPayload() },
    ]);
    const adapter = new UsaNpnAdapter(httpFetch, fixedClock(NOW));

    const candidates = await adapter.searchTaxa(
      { scientificName: 'quercus arizonica', commonName: null },
      signal,
    );

    expect(candidates).toEqual([
      { providerTaxonId: '1365', scientificName: 'Quercus arizonica', confidence: null },
    ]);
    expect(requests[0]).toContain('services.usanpn.org/npn_portal/species/getSpecies.json');
  });

  it('returns an empty array when no catalog entry matches', async () => {
    const { httpFetch } = scriptedFetch([
      { match: '/npn_portal/species/getSpecies.json', body: recordedSpeciesCatalogPayload() },
    ]);
    const adapter = new UsaNpnAdapter(httpFetch, fixedClock(NOW));

    await expect(
      adapter.searchTaxa({ scientificName: 'Zzzznonexistent xyz', commonName: null }, signal),
    ).resolves.toEqual([]);
  });

  it('fetches summarized data for the most recently completed calendar year', async () => {
    const { httpFetch, requests } = scriptedFetch([
      {
        match: '/npn_portal/observations/getSummarizedData.json',
        body: recordedSummarizedDataPayload(),
      },
    ]);
    const adapter = new UsaNpnAdapter(httpFetch, fixedClock(NOW));

    const facts = await adapter.fetchFacts('120', signal);

    expect(facts).toHaveLength(3);
    expect(requests[0]).toContain('start_date=2025-01-01');
    expect(requests[0]).toContain('end_date=2025-12-31');
    expect(requests[0]).toContain('species_id=120');
    expect(requests[0]).toContain('request_src=verdery');
  });

  it('always answers fetchDistribution with an empty array', async () => {
    const adapter = new UsaNpnAdapter(scriptedFetch([]).httpFetch, fixedClock(NOW));

    await expect(adapter.fetchDistribution('120', signal)).resolves.toEqual([]);
  });

  it('rejects a non-2xx status as a typed DependencyUnavailableError', async () => {
    const { httpFetch } = scriptedFetch([
      { match: '/npn_portal/species/getSpecies.json', body: {}, status: 500 },
    ]);
    const adapter = new UsaNpnAdapter(httpFetch, fixedClock(NOW));

    await expect(
      adapter.searchTaxa({ scientificName: 'Quercus arizonica', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.usa_npn.http_status' });
  });

  it('rejects a transport failure as a typed DependencyUnavailableError', async () => {
    const failing: UsaNpnHttpFetch = () => Promise.reject(new Error('ECONNRESET'));
    const adapter = new UsaNpnAdapter(failing, fixedClock(NOW));

    await expect(
      adapter.searchTaxa({ scientificName: 'Quercus arizonica', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.usa_npn.request_failed' });
  });
});
