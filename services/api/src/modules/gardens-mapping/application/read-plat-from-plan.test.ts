import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PlatExtractionAdapterOutcome,
  PlatExtractionProviderAdapter,
} from '../../integrations/public.js';
import {
  ReadPlatFromPlan,
  type PlatPageResolver,
  type PlatReadingSource,
} from './read-plat-from-plan.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b' as Uuid;
const PLAN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c' as Uuid;

const PAGE: PlatReadingSource = {
  bucketName: 'derived',
  objectKey: 'plans/page-1.png',
  mimeType: 'image/png',
  byteSize: 1_000_000,
};

/** The reading a real model returned for a real plat, printed bearings and all. */
const CASCADE_WAY_OUTCOME: PlatExtractionAdapterOutcome = {
  kind: 'extracted',
  plat: {
    address: '7612 CASCADE WAY, GURNEE, IL 60031',
    northRotationDegrees: 0,
    statedAreaSquareFeet: 10_068,
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

function silentLogger() {
  return pino({ level: 'silent' });
}

describe('ReadPlatFromPlan', () => {
  it('reads a real plat into a boundary that closes and matches its own stated area', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning(CASCADE_WAY_OUTCOME),
      pageResolver,
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PLAN_ID);

    expect(reading.isPlat).toBe(true);
    expect(reading.address).toBe('7612 CASCADE WAY, GURNEE, IL 60031');
    expect(reading.boundary?.closes).toBe(true);
    expect(reading.boundary?.geometry.type).toBe('Polygon');
    // 10,068 square feet is 935.3 m²; agreement within a percent is the
    // survey's own check that every number was read correctly.
    expect(reading.boundary?.areaSquareMetres ?? 0).toBeGreaterThan(925);
    expect(reading.boundary?.areaSquareMetres ?? 0).toBeLessThan(945);
  });

  it('answers "not a plat" as a reading, not as a failure', async () => {
    const reading = await new ReadPlatFromPlan(
      adapterReturning({ kind: 'notAPlat' }),
      pageResolver,
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PLAN_ID);

    expect(reading.isPlat).toBe(false);
    expect(reading.boundary).toBeNull();
  });

  it('refuses when no reader is configured, rather than pretending', async () => {
    await expect(
      new ReadPlatFromPlan(null, pageResolver, 60_000, silentLogger()).execute(GARDEN_ID, PLAN_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a plan whose page has not been rendered yet', async () => {
    await expect(
      new ReadPlatFromPlan(
        adapterReturning(CASCADE_WAY_OUTCOME),
        noPageResolver,
        60_000,
        silentLogger(),
      ).execute(GARDEN_ID, PLAN_ID),
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
      60_000,
      silentLogger(),
    ).execute(GARDEN_ID, PLAN_ID);

    expect(reading.isPlat).toBe(true);
    expect(reading.boundary?.closes).toBe(false);
    expect(reading.boundary?.closureErrorMetres ?? 0).toBeGreaterThan(0.5);
  });
});
