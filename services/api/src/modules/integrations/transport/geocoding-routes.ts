/**
 * `GET /geocoding/address-candidates` — where an address is, so a garden can
 * be placed on the Earth without typing coordinates (P12-GEO-01).
 *
 * Authenticated but garden-agnostic: this reads no garden, writes nothing,
 * and stores nothing from the provider. It is the one operation in this
 * module a person waits on directly, which is why its use case carries a
 * strict deadline and degrades instead of failing.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `findAddressCandidates`.
 */

import type { AddressCandidateListResult } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { FindAddressCandidates } from '../application/find-address-candidates.js';

export interface GeocodingRoutesDependencies {
  readonly findAddressCandidates: FindAddressCandidates;
}

function requireQuery(request: FastifyRequest): string {
  const query = (request.query as { query?: unknown }).query;

  if (typeof query !== 'string') {
    throw new ValidationError('request.invalid', 'query is required.', {
      details: [{ code: 'request.invalid', parameters: { pointer: '/query' } }],
    });
  }

  return query;
}

export function registerGeocodingRoutes(
  app: FastifyInstance,
  dependencies: GeocodingRoutesDependencies,
): void {
  app.get('/geocoding/address-candidates', async (request, reply) => {
    const result = await dependencies.findAddressCandidates.execute(requireQuery(request));

    const body: AddressCandidateListResult =
      result.kind === 'unavailable'
        ? { items: [], providerAvailable: false }
        : {
            items: result.candidates.map((candidate) => ({
              formattedAddress: candidate.formattedAddress,
              position: [...candidate.position],
              precision: candidate.precision,
            })),
            providerAvailable: true,
          };

    return reply.status(200).send(body);
  });
}
