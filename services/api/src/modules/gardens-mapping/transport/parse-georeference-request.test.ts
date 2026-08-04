import { describe, expect, it } from 'vitest';

import { parseGeoreferenceRequest } from './parse-georeference-request.js';

const VALID = {
  localAnchor: [0, 0],
  geographicAnchor: [-93.63, 41.59],
  rotationDegrees: 12.5,
  method: 'mapPin',
};

describe('parseGeoreferenceRequest', () => {
  it('accepts the minimum a caller must state', () => {
    expect(parseGeoreferenceRequest(VALID)).toEqual({
      localAnchor: [0, 0],
      geographicAnchor: [-93.63, 41.59],
      rotationDegrees: 12.5,
      method: 'mapPin',
    });
  });

  it('omits optional fields rather than inventing values for them', () => {
    const parsed = parseGeoreferenceRequest(VALID);

    expect('scaleCorrection' in parsed).toBe(false);
    expect('accuracyMetres' in parsed).toBe(false);
  });

  it('keeps optional fields when they are supplied', () => {
    const parsed = parseGeoreferenceRequest({
      ...VALID,
      scaleCorrection: 1.002,
      accuracyMetres: 4.5,
      method: 'deviceLocation',
    });

    expect(parsed.scaleCorrection).toBe(1.002);
    expect(parsed.accuracyMetres).toBe(4.5);
  });

  // The check no schema can make: `Position` is a bare number pair, so
  // nothing but this parser knows these two numbers are a place on Earth.
  it.each([
    ['longitude below range', [-180.1, 41.59]],
    ['longitude above range', [181, 41.59]],
    ['latitude below range', [-93.63, -90.5]],
    ['latitude above range', [-93.63, 90.5]],
  ])('refuses a geographic anchor with %s', (_case, geographicAnchor) => {
    expect(() => parseGeoreferenceRequest({ ...VALID, geographicAnchor })).toThrow();
  });

  it('accepts the exact edges of the Earth', () => {
    expect(() =>
      parseGeoreferenceRequest({ ...VALID, geographicAnchor: [-180, -90] }),
    ).not.toThrow();
    expect(() => parseGeoreferenceRequest({ ...VALID, geographicAnchor: [180, 90] })).not.toThrow();
  });

  it.each([-0.5, 360, 370])('refuses %s degrees rather than folding it into range', (rotation) => {
    expect(() => parseGeoreferenceRequest({ ...VALID, rotationDegrees: rotation })).toThrow();
  });

  it('accepts a rotation of exactly zero, which is not the same as absent', () => {
    expect(parseGeoreferenceRequest({ ...VALID, rotationDegrees: 0 }).rotationDegrees).toBe(0);
  });

  // The regression this file exists for now: `addressSearch` was in the
  // contract, sent by the web, and mapped by the domain — and refused here,
  // because this parser kept its own hand-written list. Every method the
  // contract defines is asserted, not a chosen one.
  it.each([
    'deviceLocation',
    'addressSearch',
    'mapPin',
    'manualCoordinates',
    'controlPoints',
    'imageryAlignment',
  ])('accepts %s, which the contract defines', (method) => {
    expect(parseGeoreferenceRequest({ ...VALID, method }).method).toBe(method);
  });

  it('refuses a method outside the vocabulary', () => {
    expect(() => parseGeoreferenceRequest({ ...VALID, method: 'guessed' })).toThrow();
  });

  it('refuses a position that is not two numbers', () => {
    expect(() => parseGeoreferenceRequest({ ...VALID, localAnchor: [1, 2, 3] })).toThrow();
    expect(() => parseGeoreferenceRequest({ ...VALID, localAnchor: ['1', '2'] })).toThrow();
  });

  it('refuses a non-positive scale correction, which would invert or collapse the garden', () => {
    expect(() => parseGeoreferenceRequest({ ...VALID, scaleCorrection: 0 })).toThrow();
    expect(() => parseGeoreferenceRequest({ ...VALID, scaleCorrection: -1 })).toThrow();
  });

  it('refuses a negative accuracy, which describes nothing', () => {
    expect(() => parseGeoreferenceRequest({ ...VALID, accuracyMetres: -1 })).toThrow();
  });
});
