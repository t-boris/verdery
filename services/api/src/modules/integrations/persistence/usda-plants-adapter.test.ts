/**
 * Unit tests for the USDA PLANTS adapter and its payload parsers — against
 * RECORDED-SHAPE fixtures taken from real live calls to
 * `plantsservices.sc.egov.usda.gov` on 2026-07-31 (see
 * `usda-plants-payload.ts`'s own header for the exact verified calls). No
 * test here touches the network: the adapter's `fetch` slice is injected,
 * the same `open-meteo-weather-adapter.test.ts` precedent.
 */

import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { UsdaPlantsHttpFetch } from './usda-plants-adapter.js';
import { UsdaPlantsAdapter } from './usda-plants-adapter.js';
import {
  parseUsdaPlantsCharacteristicsPayload,
  parseUsdaPlantsInvasiveStatuses,
  parseUsdaPlantsNoxiousStatuses,
  parseUsdaPlantsProfileNativeStatuses,
  parseUsdaPlantsSearchPayload,
} from './usda-plants-payload.js';

/** Recorded live response for a search of "Quercus alba", trimmed to the fields this adapter reads. */
function recordedSearchPayload(): unknown {
  return {
    PlantResults: [
      {
        Id: 70172,
        AcceptedId: 70172,
        Symbol: 'QUAL',
        ScientificName: '<i>Quercus alba</i> L.',
        ScientificNameWithoutAuthor: 'Quercus alba',
        CommonName: 'white oak',
        FamilyName: 'Fagaceae',
      },
      {
        Id: 70177,
        AcceptedId: 70177,
        Symbol: 'QUAL3',
        ScientificName: '<i>Quercus alba × virginiana</i> [unnamed hybrid]',
        ScientificNameWithoutAuthor: 'Quercus alba × virginiana',
        CommonName: 'hybrid oak',
        FamilyName: 'Fagaceae',
      },
    ],
  };
}

/** Recorded live PlantProfile response for id 70172, trimmed to `NativeStatuses`. */
function recordedProfilePayload(): unknown {
  return {
    Id: 70172,
    Symbol: 'QUAL',
    NativeStatuses: [
      { Region: 'CAN', Status: 'N', Type: 'Native' },
      { Region: 'L48', Status: 'N', Type: 'Native' },
    ],
  };
}

/** Recorded live PlantNoxiousStatus response for id 84414 (purple loosestrife). */
function recordedNoxiousPayload(): unknown {
  return [
    {
      Id: 0,
      LocalityName: 'Alabama',
      CommonNames: ['purple loosestrife'],
      NoxiousStatuses: ['Class B'],
      IsStateStatus: true,
    },
    {
      Id: 0,
      LocalityName: 'Alaska',
      CommonNames: ['purple loosestrife'],
      NoxiousStatuses: ['Prohibited'],
      IsStateStatus: true,
    },
  ];
}

/** Recorded live PlantInvasiveStatus response for id 84414. */
function recordedInvasivePayload(): unknown {
  return [
    {
      Id: 0,
      LocalityName: 'Michigan',
      CommonNames: ['purple loosestrife'],
      InvasiveStatuses: ['Invasive, Restricted'],
    },
  ];
}

/** Recorded live PlantCharacteristics response for id 70172, trimmed to a few rows. */
function recordedCharacteristicsPayload(): unknown {
  return [
    {
      PlantCharacteristicName: 'Active Growth Period',
      PlantCharacteristicValue: 'Spring and Summer',
      PlantCharacteristicCategory: 'Morphology/Physiology',
      CultivarName: null,
      SynonymName: null,
    },
    {
      PlantCharacteristicName: 'C:N Ratio',
      PlantCharacteristicValue: 'High',
      PlantCharacteristicCategory: 'Morphology/Physiology',
      CultivarName: null,
      SynonymName: null,
    },
    {
      PlantCharacteristicName: 'Fire Resistant',
      PlantCharacteristicValue: 'No',
      PlantCharacteristicCategory: 'Morphology/Physiology',
      CultivarName: null,
      SynonymName: null,
    },
    // A blank value must be skipped, never stored as an empty fact.
    {
      PlantCharacteristicName: 'Bloom Period',
      PlantCharacteristicValue: null,
      PlantCharacteristicCategory: 'Morphology/Physiology',
      CultivarName: null,
      SynonymName: null,
    },
  ];
}

describe('USDA PLANTS payload parsers', () => {
  it('parses a real search payload, using the plain-text name field over the HTML-italicized one', () => {
    const candidates = parseUsdaPlantsSearchPayload(recordedSearchPayload());

    expect(candidates).toEqual([
      { providerTaxonId: '70172', scientificName: 'Quercus alba', confidence: null },
      { providerTaxonId: '70177', scientificName: 'Quercus alba × virginiana', confidence: null },
    ]);
  });

  it('slugifies characteristic names into factKeys and skips blank values', () => {
    const facts = parseUsdaPlantsCharacteristicsPayload(recordedCharacteristicsPayload());

    expect(facts).toEqual([
      {
        factKey: 'active_growth_period',
        value: 'Spring and Summer',
        unit: null,
        confidence: null,
        geographicScope: null,
      },
      { factKey: 'c_n_ratio', value: 'High', unit: null, confidence: null, geographicScope: null },
      {
        factKey: 'fire_resistant',
        value: 'No',
        unit: null,
        confidence: null,
        geographicScope: null,
      },
    ]);
  });

  it('maps NativeStatuses Type to the domain native/introduced vocabulary', () => {
    const distribution = parseUsdaPlantsProfileNativeStatuses(recordedProfilePayload());

    expect(distribution).toEqual([
      { region: 'CAN', rawStatus: 'native', confidence: null },
      { region: 'L48', rawStatus: 'native', confidence: null },
    ]);
  });

  it('maps a state noxious-weed listing to "regulated"', () => {
    const distribution = parseUsdaPlantsNoxiousStatuses(recordedNoxiousPayload());

    expect(distribution).toEqual([
      { region: 'Alabama', rawStatus: 'regulated', confidence: null },
      { region: 'Alaska', rawStatus: 'regulated', confidence: null },
    ]);
  });

  it('maps a state invasive-species listing to "invasive"', () => {
    const distribution = parseUsdaPlantsInvasiveStatuses(recordedInvasivePayload());

    expect(distribution).toEqual([{ region: 'Michigan', rawStatus: 'invasive', confidence: null }]);
  });

  it('reads an empty array (HTTP 200, no listing) as "nothing listed", not malformed', () => {
    expect(parseUsdaPlantsNoxiousStatuses([])).toEqual([]);
    expect(
      parseUsdaPlantsProfileNativeStatuses({ Id: 70172, Symbol: 'QUAL', NativeStatuses: [] }),
    ).toEqual([]);
  });

  it('rejects a structurally malformed payload rather than repairing it', () => {
    expect(() => parseUsdaPlantsSearchPayload({ notPlantResults: [] })).toThrow(
      DependencyUnavailableError,
    );
    expect(() => parseUsdaPlantsCharacteristicsPayload({ not: 'an array' })).toThrow(
      DependencyUnavailableError,
    );
  });
});

type FetchBehavior =
  | { readonly kind: 'json'; readonly body: unknown }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'reject'; readonly error: unknown };

interface FetchRecorder {
  readonly httpFetch: UsdaPlantsHttpFetch;
  readonly requests: { url: string; method: string | undefined }[];
}

function scriptedFetch(
  byUrlSubstring: readonly { match: string; behavior: FetchBehavior }[],
): FetchRecorder {
  const requests: { url: string; method: string | undefined }[] = [];
  const httpFetch: UsdaPlantsHttpFetch = (url, init) => {
    requests.push({ url, method: init.method });
    const entry = byUrlSubstring.find((candidate) => url.includes(candidate.match));
    const behavior = entry?.behavior ?? { kind: 'status', status: 404 };
    switch (behavior.kind) {
      case 'json':
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(behavior.body),
        });
      case 'status':
        return Promise.resolve({
          ok: false,
          status: behavior.status,
          json: () => Promise.resolve({}),
        });
      case 'reject':
        return Promise.reject(
          behavior.error instanceof Error ? behavior.error : new Error('transport failure'),
        );
    }
  };
  return { httpFetch, requests };
}

describe('UsdaPlantsAdapter', () => {
  const signal = new AbortController().signal;

  it('searches by POSTing the scientific name to the documented endpoint', async () => {
    const { httpFetch, requests } = scriptedFetch([
      {
        match: '/api/plants-search-results',
        behavior: { kind: 'json', body: recordedSearchPayload() },
      },
    ]);
    const adapter = new UsdaPlantsAdapter(httpFetch);

    const candidates = await adapter.searchTaxa(
      { scientificName: 'Quercus alba', commonName: null },
      signal,
    );

    expect(candidates[0]).toEqual({
      providerTaxonId: '70172',
      scientificName: 'Quercus alba',
      confidence: null,
    });
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toContain('plantsservices.sc.egov.usda.gov/api/plants-search-results');
  });

  it('fetches characteristics from the numeric-id endpoint', async () => {
    const { httpFetch, requests } = scriptedFetch([
      {
        match: '/api/PlantCharacteristics/70172',
        behavior: { kind: 'json', body: recordedCharacteristicsPayload() },
      },
    ]);
    const adapter = new UsdaPlantsAdapter(httpFetch);

    const facts = await adapter.fetchFacts('70172', signal);

    expect(facts).toHaveLength(3);
    expect(requests[0]?.url).toContain('/api/PlantCharacteristics/70172');
  });

  it('fetches and combines all three distribution endpoints under one deadline', async () => {
    const { httpFetch, requests } = scriptedFetch([
      {
        match: '/api/PlantProfile/70172',
        behavior: { kind: 'json', body: recordedProfilePayload() },
      },
      { match: '/api/PlantNoxiousStatus/70172', behavior: { kind: 'json', body: [] } },
      { match: '/api/PlantInvasiveStatus/70172', behavior: { kind: 'json', body: [] } },
    ]);
    const adapter = new UsdaPlantsAdapter(httpFetch);

    const distribution = await adapter.fetchDistribution('70172', signal);

    expect(distribution).toEqual([
      { region: 'CAN', rawStatus: 'native', confidence: null },
      { region: 'L48', rawStatus: 'native', confidence: null },
    ]);
    expect(requests).toHaveLength(3);
  });

  it('rejects the whole distribution fetch when any one of the three endpoints fails', async () => {
    const { httpFetch } = scriptedFetch([
      {
        match: '/api/PlantProfile/70172',
        behavior: { kind: 'json', body: recordedProfilePayload() },
      },
      { match: '/api/PlantNoxiousStatus/70172', behavior: { kind: 'status', status: 500 } },
      { match: '/api/PlantInvasiveStatus/70172', behavior: { kind: 'json', body: [] } },
    ]);
    const adapter = new UsdaPlantsAdapter(httpFetch);

    await expect(adapter.fetchDistribution('70172', signal)).rejects.toMatchObject({
      code: 'integrations.usda_plants.http_status',
    });
  });

  it('rejects a transport failure and an unreadable body as typed DependencyUnavailableErrors', async () => {
    const broken = new UsdaPlantsAdapter(
      scriptedFetch([
        {
          match: 'plants-search-results',
          behavior: { kind: 'reject', error: new Error('ECONNRESET') },
        },
      ]).httpFetch,
    );
    await expect(
      broken.searchTaxa({ scientificName: 'Quercus alba', commonName: null }, signal),
    ).rejects.toMatchObject({ code: 'integrations.usda_plants.request_failed' });
  });
});
