/**
 * P6-QA-01's malformed-input evidence for the `upsertCalibration` transport
 * branch: a malformed calibration payload must be rejected as a
 * `ValidationError` (the request pipeline's 400 shape) with a precise JSON
 * pointer — never allowed through to the application layer to surface as a
 * 500. The domain-level input rules (degenerate segment, off-page point,
 * and so on) are separately proven by `map-calibration.test.ts` and the
 * shared fixture's rejected cases; this file covers only the hand-written
 * parsing layer, which until now had no test on any of its branches.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { parseMapCommandPayload } from './parse-map-command-payload.js';

const BACKGROUND_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

const VALID_CALIBRATION = {
  type: 'upsertCalibration',
  backgroundObjectId: BACKGROUND_OBJECT_ID,
  expectedRevision: 1,
  pageAspectRatio: 0.75,
  knownDistance: { pointA: [0.1, 0.1], pointB: [0.6, 0.1], distanceMetres: 10 },
  referencePoints: [{ planPoint: [0.5, 0.25], localMetres: [10, 10] }],
};

function expectRejected(payload: unknown, pointer: string): void {
  try {
    parseMapCommandPayload(payload, '/payload');
    expect.unreachable('expected a ValidationError');
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details?.[0]?.pointer).toBe(pointer);
  }
}

describe('parseMapCommandPayload upsertCalibration branch', () => {
  it('parses a fully valid calibration payload, empty reference points included', () => {
    expect(parseMapCommandPayload(VALID_CALIBRATION, '/payload')).toEqual(VALID_CALIBRATION);

    const noPoints = { ...VALID_CALIBRATION, referencePoints: [] };
    expect(parseMapCommandPayload(noPoints, '/payload')).toEqual(noPoints);
  });

  it('rejects referencePoints that is not an array, and a reference point missing its position halves', () => {
    expectRejected({ ...VALID_CALIBRATION, referencePoints: 'nope' }, '/payload/referencePoints');
    expectRejected(
      { ...VALID_CALIBRATION, referencePoints: [{ planPoint: [0.5, 0.25] }] },
      '/payload/referencePoints/0/localMetres',
    );
    expectRejected(
      { ...VALID_CALIBRATION, referencePoints: [{ planPoint: [0.5], localMetres: [10, 10] }] },
      '/payload/referencePoints/0/planPoint',
    );
  });

  it('rejects a missing or malformed knownDistance', () => {
    const { knownDistance: _dropped, ...withoutDistance } = VALID_CALIBRATION;
    expectRejected(withoutDistance, '/payload/knownDistance');
    expectRejected(
      {
        ...VALID_CALIBRATION,
        knownDistance: { pointA: [0.1, 0.1], pointB: [0.6, 0.1], distanceMetres: 'ten' },
      },
      '/payload/knownDistance/distanceMetres',
    );
  });

  it('rejects a non-UUID backgroundObjectId, a non-numeric pageAspectRatio, and a sub-1 expectedRevision', () => {
    expectRejected(
      { ...VALID_CALIBRATION, backgroundObjectId: 'not-a-uuid' },
      '/payload/backgroundObjectId',
    );
    expectRejected({ ...VALID_CALIBRATION, pageAspectRatio: 'wide' }, '/payload/pageAspectRatio');
    expectRejected({ ...VALID_CALIBRATION, expectedRevision: 0 }, '/payload/expectedRevision');
  });

  it('rejects a malformed manualAdjustment while accepting a well-formed one', () => {
    const withAdjustment = {
      ...VALID_CALIBRATION,
      manualAdjustment: { rotationRadians: 0.1, translationMetres: { dx: 1, dy: -2 } },
    };
    expect(parseMapCommandPayload(withAdjustment, '/payload')).toEqual(withAdjustment);

    expectRejected(
      { ...VALID_CALIBRATION, manualAdjustment: { rotationRadians: 0.1 } },
      '/payload/manualAdjustment/translationMetres',
    );
  });

  it('rejects an unknown command type with the type pointer', () => {
    expectRejected({ type: 'calibrate' }, '/payload/type');
  });
});
