import type { PlantProfileVersion } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createPlantCatalogGateway } from './plant-catalog-gateway';

const ORIGIN = 'https://api.example.test';
const TAXON_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

const PROFILE: PlantProfileVersion = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  taxonomyReferenceId: TAXON_ID,
  isPartial: true,
  createdAt: '2026-05-02T08:00:00Z',
  resolvedFacts: [
    {
      factKey: 'hardiness_zone_min',
      value: '5a',
      unit: null,
      geographicScope: 'US',
      providerKey: 'usda_plants',
      confidence: 0.9,
      sourceCitation: 'USDA PLANTS Database',
      evidenceStatus: 'source_backed',
    },
  ],
};

function gatewayRecording(response: Response) {
  const recorded: { url: string; init: RequestInit }[] = [];
  const fetchImplementation: FetchLike = (url, init) => {
    recorded.push({ url, init });
    return Promise.resolve(response);
  };

  const client = createApiClient({ origin: ORIGIN, fetchImplementation });
  return { gateway: createPlantCatalogGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createPlantCatalogGateway', () => {
  it('reads a taxon profile from the shared, garden-independent path', () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(PROFILE, 200));

    void gateway.getTaxonProfile(TAXON_ID);

    // No `gardenId` anywhere: the catalog is reference knowledge, not one
    // garden's records.
    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/plant-catalog/taxa/${TAXON_ID}/profile`);
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('returns a 404 as a failure rather than an empty profile', async () => {
    const { gateway } = gatewayRecording(
      jsonResponse(
        {
          error: {
            code: 'resource.not_found',
            message: 'No profile.',
            correlationId: 'c1',
            retryable: false,
          },
        },
        404,
      ),
    );

    const result = await gateway.getTaxonProfile(TAXON_ID);

    // "Nothing assembled yet" and "assembled and empty" are different
    // statements about a plant, and flattening the first into the second would
    // tell a reader the sources had been checked when they had not.
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 404 }));
  });
});
