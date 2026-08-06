import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type {
  AerialGardenExtractionProviderAdapter,
  AerialImage,
  AerialImageryProviderAdapter,
  ProviderQuotaRepository,
} from '../../integrations/public.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { GeoreferenceReader } from './georeference-repository.js';
import type { MembershipRepository } from './membership-repository.js';
import { TraceGardenFromAerial } from './trace-garden-from-aerial.js';

const gardenId = '01922222-2222-7222-8222-222222222222';
const profileId = '01944444-4444-7444-8444-444444444444';

const image: AerialImage = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  widthPixels: 1024,
  heightPixels: 1024,
  bounds: { west: -87.651, south: 41.879, east: -87.649, north: 41.881 },
  groundResolutionMetres: 0.3,
  horizontalAccuracyMetres: null,
  identity: {
    providerKey: 'usgs-naip-plus',
    providerName: 'USGS National Map NAIP Plus',
    sourceId: 'sha256:image',
    capturedOn: null,
    attributionText: 'Aerial imagery: USGS',
    attributionUrl: 'https://www.usgs.gov/',
    licenseName: 'United States public domain',
    licenseUrl: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  },
};

function dependencies() {
  const memberships = {
    findGardenAccess: vi.fn().mockResolvedValue({
      membership: { id: profileId, gardenId, profileId, role: 'owner' },
      gardenLifecycleState: 'active',
    }),
  } as unknown as MembershipRepository;
  const georeferences: GeoreferenceReader = {
    findCurrentForGarden: vi.fn().mockResolvedValue({
      id: '01911111-1111-7111-8111-111111111111',
      gardenId,
      coordinateSpaceId: '01933333-3333-7333-8333-333333333333',
      localAnchor: [0, 0],
      geographicAnchor: [-87.65, 41.88],
      rotationDegrees: 0,
      scaleCorrection: 1,
      accuracyMetres: 3,
      provenance: 'externalProvider',
      method: 'addressSearch',
      revision: 4,
    }),
  };
  const imageryFetch = vi.fn().mockResolvedValue({ kind: 'available' as const, image });
  const imagery: AerialImageryProviderAdapter = { fetchImage: imageryFetch };
  const visionExtract = vi.fn().mockResolvedValue({
    kind: 'extracted' as const,
    objects: [
      {
        category: 'structure' as const,
        label: 'House',
        points: [
          [0.4, 0.4],
          [0.6, 0.4],
          [0.6, 0.6],
          [0.4, 0.6],
        ] as const,
        confidence: 0.9,
        limitations: ['One corner is shadowed.'],
        boundaryEvidence: 'notApplicable' as const,
      },
    ],
  });
  const vision: AerialGardenExtractionProviderAdapter = {
    identity: { processor: 'vision', model: 'evaluated-model', promptTemplateVersion: 2 },
    extractGarden: visionExtract,
  };
  const quotaConsume = vi
    .fn<ProviderQuotaRepository['consumeCall']>()
    .mockResolvedValue({ consumed: true });
  const quotas: ProviderQuotaRepository = {
    consumeCall: quotaConsume,
  };
  return {
    memberships,
    georeferences,
    imagery,
    imageryFetch,
    vision,
    visionExtract,
    quotas,
    quotaConsume,
  };
}

function useCase(enabled: boolean, deps: ReturnType<typeof dependencies>): TraceGardenFromAerial {
  return new TraceGardenFromAerial(
    {
      enabled,
      imageryTimeoutMs: 1_000,
      visionTimeoutMs: 1_000,
      quotaLimits: { maxCallsPerHour: 10, maxCallsPerDay: 30 },
      proposalId: () => '01955555-5555-7555-8555-555555555555',
    },
    deps.imagery,
    deps.vision,
    deps.georeferences,
    new GardenAuthorization(deps.memberships),
    deps.quotas,
    { now: () => new Date('2026-08-06T12:00:00Z') },
    { warn: vi.fn() } as unknown as FastifyBaseLogger,
  );
}

describe('TraceGardenFromAerial', () => {
  it('keeps the kill switch ahead of every external call', async () => {
    const deps = dependencies();
    await expect(useCase(false, deps).execute(gardenId, profileId)).resolves.toEqual({
      kind: 'disabled',
    });
    expect(deps.imageryFetch).not.toHaveBeenCalled();
    expect(deps.visionExtract).not.toHaveBeenCalled();
  });

  it('returns editable proposals with full imagery/model/transform provenance', async () => {
    const result = await useCase(true, dependencies()).execute(gardenId, profileId);
    expect(result).toMatchObject({
      kind: 'ready',
      proposals: [
        {
          category: 'structure',
          geometry: { type: 'Polygon' },
          confidence: 0.9,
          provenance: {
            kind: 'imageExtraction',
            model: 'evaluated-model',
            imagery: { sourceId: 'sha256:image', capturedOn: null },
            imageryBounds: image.bounds,
            georeferenceRevision: 4,
          },
        },
      ],
    });
  });

  it('does not call vision after quota refusal', async () => {
    const deps = dependencies();
    deps.quotaConsume.mockResolvedValue({
      consumed: false,
      exhaustedWindow: 'hour' as const,
    });
    await expect(useCase(true, deps).execute(gardenId, profileId)).resolves.toEqual({
      kind: 'quotaExceeded',
    });
    expect(deps.visionExtract).not.toHaveBeenCalled();
  });
});
