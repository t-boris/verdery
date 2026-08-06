import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PlatExtractionAdapterOutcome,
  PlatExtractionProviderAdapter,
} from '../../integrations/public.js';
import type { GardenRole } from '../domain/garden-role.js';
import { closeTraverse } from '../domain/survey-traverse.js';
import { GardenAuthorization } from './garden-authorization.js';
import type { MembershipRepository } from './membership-repository.js';
import {
  ReadPlatFromPlan,
  type PlatPageResolver,
  type PlatReadingSource,
} from './read-plat-from-plan.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b' as Uuid;
const PLAN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c' as Uuid;
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d' as Uuid;

const PAGE: PlatReadingSource = {
  bucketName: 'derived',
  objectKey: 'plans/page-1.png',
  mimeType: 'image/png',
  byteSize: 1_000_000,
};

const CASCADE_WAY_CALLS = [
  {
    bearing: { reference: 'north', degrees: 46, minutes: 54, seconds: 11, turn: 'east' },
    distanceFeet: 135.06,
    sourceLabel: 'MEASURED = 135.06',
  },
  {
    bearing: { reference: 'south', degrees: 44, minutes: 56, seconds: 39, turn: 'east' },
    distanceFeet: 70.02,
    sourceLabel: 'MEASURED = 70.02',
  },
  {
    bearing: { reference: 'north', degrees: 43, minutes: 12, seconds: 31, turn: 'east' },
    distanceFeet: 135.1,
    sourceLabel: 'MEASURED = 135.10',
  },
  {
    bearing: { reference: 'north', degrees: 45, minutes: 55, seconds: 0, turn: 'west' },
    distanceFeet: 78.63,
    sourceLabel: 'CHORD = 78.63',
  },
] as const;

/**
 * The lot's outline as it would appear on the page: the surveyed polygon
 * itself, scaled into the sheet and flipped the way an image's y axis runs.
 *
 * Derived rather than invented, because a plat IS drawn to scale — a fixture
 * whose page outline is a different shape from the survey would be testing a
 * document that cannot exist, and the similarity fit would rightly refuse to
 * reconcile the two.
 */
function lotPageOutlineFromSurvey(): (readonly [number, number])[] {
  const ring = closeTraverse(
    CASCADE_WAY_CALLS.map((call) => ({
      bearing: call.bearing,
      distanceFeet: call.distanceFeet,
    })),
  )?.ring;
  if (ring === undefined) throw new Error('the fixture calls must close');

  const corners = ring.slice(0, -1);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // A quarter of the sheet, centred-ish: any placement works, which is the
  // point — the fit recovers scale, rotation and position alike.
  return corners.map(
    ([x, y]) =>
      [
        0.2 + ((x - Math.min(...xs)) / span) * 0.5,
        0.8 - ((y - Math.min(...ys)) / span) * 0.5,
      ] as const,
  );
}

const LOT_PAGE_OUTLINE = lotPageOutlineFromSurvey();

/** The reading a real model returned for a real plat, printed bearings and all. */
const CASCADE_WAY_OUTCOME: PlatExtractionAdapterOutcome = {
  kind: 'extracted',
  plat: {
    address: '7612 CASCADE WAY, GURNEE, IL 60031',
    northRotationDegrees: 0,
    statedAreaSquareFeet: 10_068,
    /*
     * The lot as the model outlines it on the page, and the house drawn
     * inside it. Page coordinates only: the survey supplies every dimension,
     * which is what makes the house land at the right size without the model
     * ever stating one.
     */
    lotPageOutline: LOT_PAGE_OUTLINE,
    pageObjects: [
      {
        category: 'structure',
        label: '2 STORY FRAME #7612',
        // Drawn inside the lot, a tenth of the sheet across: on a lot whose
        // longest side is about 41 m, that is a house-sized footprint.
        pagePoints: [
          [0.4, 0.55],
          [0.5, 0.55],
          [0.5, 0.47],
          [0.4, 0.47],
        ],
        confidence: 0.8,
      },
      {
        // A drive is a LINE on the map, so the reader traces its centre
        // rather than its two edges — see `plat-extraction-provider.ts`.
        category: 'path',
        label: 'ASPHALT DRIVE',
        pagePoints: [
          [0.38, 0.62],
          [0.42, 0.56],
        ],
        confidence: 0.7,
      },
    ],
    boundaryCalls: [
      {
        bearing: { reference: 'north', degrees: 46, minutes: 54, seconds: 11, turn: 'east' },
        distanceFeet: 135.06,
        sourceLabel: 'MEASURED = 135.06',
      },
      {
        bearing: { reference: 'south', degrees: 44, minutes: 56, seconds: 39, turn: 'east' },
        distanceFeet: 70.02,
        sourceLabel: 'MEASURED = 70.02',
      },
      {
        bearing: { reference: 'north', degrees: 43, minutes: 12, seconds: 31, turn: 'east' },
        distanceFeet: 135.1,
        sourceLabel: 'MEASURED = 135.10',
      },
      {
        bearing: { reference: 'north', degrees: 45, minutes: 55, seconds: 0, turn: 'west' },
        distanceFeet: 78.63,
        sourceLabel: 'CHORD = 78.63',
      },
    ],
  },
};

function adapterReturning(outcome: PlatExtractionAdapterOutcome): PlatExtractionProviderAdapter {
  return {
    identity: { model: 'test-model', promptTemplateVersion: 1 },
    extractPlat: () => Promise.resolve(outcome),
  };
}

const pageResolver: PlatPageResolver = { resolvePage: () => Promise.resolve(PAGE) };
const noPageResolver: PlatPageResolver = { resolvePage: () => Promise.resolve(null) };

/** Membership enough to edit the garden — the capability reading a plan requires. */
function authorizationFor(role: GardenRole): GardenAuthorization {
  return new GardenAuthorization({
    findGardenAccess: (gardenId: Uuid, profileId: Uuid) =>
      Promise.resolve(
        gardenId === GARDEN_ID && profileId === PROFILE_ID
          ? {
              membership: { id: 'membership-1', gardenId, profileId, role },
              gardenLifecycleState: 'active' as const,
            }
          : null,
      ),
  } as unknown as MembershipRepository);
}

function silentLogger() {
  return pino({ level: 'silent' });
}

describe('ReadPlatFromPlan', () => {
  it('reads a real plat into a boundary that closes and matches its own stated area', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning(CASCADE_WAY_OUTCOME),
      pageResolver,
      authorizationFor('editor'),
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID);

    expect(reading.isPlat).toBe(true);
    expect(reading.address).toBe('7612 CASCADE WAY, GURNEE, IL 60031');
    expect(reading.boundary?.closes).toBe(true);
    expect(reading.boundary?.geometry.type).toBe('Polygon');
    // 10,068 square feet is 935.3 m²; agreement within a percent is the
    // survey's own check that every number was read correctly.
    expect(reading.boundary?.areaSquareMetres ?? 0).toBeGreaterThan(925);
    expect(reading.boundary?.areaSquareMetres ?? 0).toBeLessThan(945);
  });

  /*
   * What the owner actually asked for: not a picture on the map, but the
   * things the drawing shows. The house and the drive come back as polygons
   * in garden metres, sized by the SURVEY — the model only said where on the
   * page they sit.
   */
  it('proposes the house and the drive as objects in real metres', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning(CASCADE_WAY_OUTCOME),
      pageResolver,
      authorizationFor('editor'),
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID);

    expect(reading.objects.map((object) => object.category)).toEqual(['structure', 'path']);
    expect(reading.objects.map((object) => object.geometry.type)).toEqual([
      'Polygon',
      'LineString',
    ]);
    const house = reading.objects[0];
    expect(house?.label).toContain('2 STORY FRAME');
    expect(house?.geometry.type).toBe('Polygon');
    // A house occupying about a third of a 30-metre lot: tens of square
    // metres, not thousands and not a fraction of one.
    expect(house?.areaSquareMetres ?? 0).toBeGreaterThan(50);
    expect(house?.areaSquareMetres ?? 0).toBeLessThan(400);
    expect(reading.pageFitResidualMetres).not.toBeNull();
  });

  // No surveyed boundary means no scale, and an object placed by a guess at
  // scale is worse than no object.
  it('carries nothing when the lot outline cannot be fitted', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning({
        kind: 'extracted',
        plat: { ...CASCADE_WAY_OUTCOME.plat, lotPageOutline: [] },
      }),
      pageResolver,
      authorizationFor('editor'),
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID);

    expect(reading.objects).toEqual([]);
    expect(reading.pageFitResidualMetres).toBeNull();
  });

  it('answers "not a plat" as a reading, not as a failure', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning({ kind: 'notAPlat' }),
      pageResolver,
      authorizationFor('editor'),
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID);

    expect(reading.isPlat).toBe(false);
    expect(reading.boundary).toBeNull();
  });

  it('refuses when no reader is configured, rather than pretending', async () => {
    await expect(
      new ReadPlatFromPlan(
        null,
        pageResolver,
        authorizationFor('editor'),
        60_000,
        silentLogger(),
      ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a plan whose page has not been rendered yet', async () => {
    await expect(
      new ReadPlatFromPlan(
        adapterReturning(CASCADE_WAY_OUTCOME),
        noPageResolver,
        authorizationFor('editor'),
        60_000,
        silentLogger(),
      ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // A reading that does not close is still returned — with the gap — because
  // the person reviewing it is the one who decides whether to trust it.
  it('returns a boundary that does not close, and says so', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning({
        kind: 'extracted',
        plat: {
          address: null,
          northRotationDegrees: null,
          statedAreaSquareFeet: null,
          lotPageOutline: [],
          pageObjects: [],
          boundaryCalls: [
            {
              bearing: { reference: 'north', degrees: 0, minutes: 0, seconds: 0, turn: 'east' },
              distanceFeet: 100,
              sourceLabel: 'a',
            },
            {
              bearing: { reference: 'north', degrees: 90, minutes: 0, seconds: 0, turn: 'east' },
              distanceFeet: 100,
              sourceLabel: 'b',
            },
            {
              bearing: { reference: 'south', degrees: 0, minutes: 0, seconds: 0, turn: 'east' },
              distanceFeet: 40,
              sourceLabel: 'c',
            },
          ],
        },
      }),
      pageResolver,
      authorizationFor('editor'),
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PROFILE_ID, PLAN_ID);

    expect(reading.isPlat).toBe(true);
    expect(reading.boundary?.closes).toBe(false);
    expect(reading.boundary?.closureErrorMetres ?? 0).toBeGreaterThan(0.5);
  });
});
