import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { AerialTracingProviderAdapter } from '../../integrations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { GeoreferenceReader } from './georeference-repository.js';
import type { MembershipRepository } from './membership-repository.js';
import type { MapObjectRepository } from './map-object-repository.js';
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
              [0.45, 0.58],
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

const mapObjects = {
  listForGarden: () =>
    Promise.resolve([
      {
        category: 'lot',
        lifecycleState: 'active',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-15, -15],
              [15, -15],
              [15, 15],
              [-15, 15],
              [-15, -15],
            ],
          ],
        },
      },
    ]),
} as unknown as MapObjectRepository;

describe('TraceGardenFromAerial', () => {
  it('returns house, driveway and tree proposals without duplicating the saved lot', async () => {
    const result = await new TraceGardenFromAerial(
      adapter,
      mapObjects,
      georeferences,
      authorization(),
      60_000,
      pino({ level: 'silent' }),
    ).execute(GARDEN_ID, PROFILE_ID);

    expect(result.proposals.map((proposal) => proposal.category)).toEqual([
      'structure',
      'path',
      'tree',
    ]);
    expect(result.proposals.map((proposal) => proposal.geometry.type)).toEqual([
      'Polygon',
      'LineString',
      'Point',
    ]);
  });

  it('places AI objects from the aligned lot center, not the geocoder street point', async () => {
    const result = await new TraceGardenFromAerial(
      adapter,
      mapObjects,
      georeferences,
      authorization(),
      60_000,
      pino({ level: 'silent' }),
    ).execute(GARDEN_ID, PROFILE_ID);
    const drive = result.proposals.find((proposal) => proposal.label === 'Driveway');
    expect(drive?.geometry.type).toBe('LineString');
    if (drive?.geometry.type === 'LineString') {
      expect(drive.geometry.coordinates[0]?.[0]).toBeCloseTo(0, 1);
      expect(drive.geometry.coordinates[0]?.[1]).toBeCloseTo(0, 1);
    }
  });

  it('refuses to invent a lot when no aligned survey lot exists', async () => {
    const missing = {
      listForGarden: () => Promise.resolve([]),
    } as unknown as MapObjectRepository;

    await expect(
      new TraceGardenFromAerial(
        adapter,
        missing,
        georeferences,
        authorization(),
        60_000,
        pino({ level: 'silent' }),
      ).execute(GARDEN_ID, PROFILE_ID),
    ).rejects.toMatchObject({ code: 'map.aerial_tracing_needs_lot' });
  });
});
