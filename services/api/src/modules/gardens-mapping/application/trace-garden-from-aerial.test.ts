import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { AerialTracingProviderAdapter } from '../../integrations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { GeoreferenceReader } from './georeference-repository.js';
import type { MembershipRepository } from './membership-repository.js';
import { TraceGardenFromAerial } from './trace-garden-from-aerial.js';

const GARDEN_ID = '019fdce1-1111-7000-8000-000000000001';
const PROFILE_ID = '019fdce1-1111-7000-8000-000000000002';

function authorization(): GardenAuthorization {
  return new GardenAuthorization({
    findGardenAccess: (gardenId: Uuid, profileId: Uuid) =>
      Promise.resolve({
        membership: { id: 'member', gardenId, profileId, role: 'editor' as const },
        gardenLifecycleState: 'active' as const,
      }),
  } as unknown as MembershipRepository);
}

const georeferences: GeoreferenceReader = {
  findCurrentForGarden: (gardenId) =>
    Promise.resolve({
      id: 'georef',
      gardenId,
      coordinateSpaceId: 'space',
      localAnchor: [10, 20],
      geographicAnchor: [-87.991547, 42.368905],
      rotationDegrees: 0,
      scaleCorrection: 1,
      accuracyMetres: null,
      displayAddress: '7612 Cascade Way',
      provenance: 'externalProvider',
      method: 'addressSearch',
      revision: 1,
    }),
};

const adapter: AerialTracingProviderAdapter = {
  traceSite: () =>
    Promise.resolve({
      kind: 'extracted',
      site: {
        lot: {
          imagePoints: [
            [0.4, 0.4],
            [0.6, 0.4],
            [0.6, 0.6],
            [0.4, 0.6],
          ],
          confidence: 0.7,
          evidence: 'inferred',
        },
        objects: [
          {
            category: 'structure',
            label: 'House',
            imagePoints: [
              [0.48, 0.48],
              [0.52, 0.48],
              [0.52, 0.52],
              [0.48, 0.52],
            ],
            confidence: 0.9,
            evidence: 'visible',
          },
          {
            category: 'path',
            label: 'Driveway',
            imagePoints: [
              [0.5, 0.5],
              [0.3, 0.8],
            ],
            confidence: 0.8,
            evidence: 'visible',
          },
          {
            category: 'tree',
            label: 'Tree',
            imagePoints: [[0.55, 0.45]],
            confidence: 0.85,
            evidence: 'visible',
          },
        ],
      },
    }),
};

describe('TraceGardenFromAerial', () => {
  it('returns the lot, house, driveway and tree as separate reviewable proposals', async () => {
    const result = await new TraceGardenFromAerial(
      adapter,
      georeferences,
      authorization(),
      60_000,
      pino({ level: 'silent' }),
    ).execute(GARDEN_ID, PROFILE_ID);

    expect(result.proposals.map((proposal) => proposal.category)).toEqual([
      'lot',
      'structure',
      'path',
      'tree',
    ]);
    expect(result.proposals.map((proposal) => proposal.geometry.type)).toEqual([
      'Polygon',
      'Polygon',
      'LineString',
      'Point',
    ]);
  });

  it('places the image centre exactly at the saved local anchor', async () => {
    const result = await new TraceGardenFromAerial(
      adapter,
      georeferences,
      authorization(),
      60_000,
      pino({ level: 'silent' }),
    ).execute(GARDEN_ID, PROFILE_ID);
    const drive = result.proposals.find((proposal) => proposal.label === 'Driveway');
    expect(drive?.geometry.type).toBe('LineString');
    if (drive?.geometry.type === 'LineString') {
      expect(drive.geometry.coordinates[0]).toEqual([10, 20]);
    }
  });
});
