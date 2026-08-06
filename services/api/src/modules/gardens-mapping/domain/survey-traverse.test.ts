import { describe, expect, it } from 'vitest';

import {
  azimuthDegrees,
  closeTraverse,
  walkTraverse,
  type SurveyCall,
  type SurveyBearing,
} from './survey-traverse.js';

function bearing(
  reference: 'north' | 'south',
  degrees: number,
  minutes: number,
  seconds: number,
  turn: 'east' | 'west',
): SurveyBearing {
  return { reference, degrees, minutes, seconds, turn };
}

describe('azimuthDegrees', () => {
  // Every US plat writes bearings this way, and the four quadrants each
  // convert differently — which is exactly the arithmetic a model must not be
  // trusted to do silently.
  it('converts each quadrant to degrees clockwise from north', () => {
    expect(azimuthDegrees(bearing('north', 0, 0, 0, 'east'))).toBeCloseTo(0, 6);
    expect(azimuthDegrees(bearing('north', 46, 54, 11, 'east'))).toBeCloseTo(46.9031, 3);
    expect(azimuthDegrees(bearing('south', 44, 55, 39, 'east'))).toBeCloseTo(135.0725, 3);
    expect(azimuthDegrees(bearing('south', 30, 0, 0, 'west'))).toBeCloseTo(210, 6);
    expect(azimuthDegrees(bearing('north', 30, 0, 0, 'west'))).toBeCloseTo(330, 6);
  });

  it('reads minutes and seconds, not just whole degrees', () => {
    expect(azimuthDegrees(bearing('north', 0, 30, 0, 'east'))).toBeCloseTo(0.5, 6);
    expect(azimuthDegrees(bearing('north', 0, 0, 36, 'east'))).toBeCloseTo(0.01, 6);
  });
});

describe('walkTraverse', () => {
  it('refuses anything that cannot be a boundary', () => {
    expect(walkTraverse([])).toBeNull();
    expect(
      walkTraverse([
        { bearing: bearing('north', 0, 0, 0, 'east'), distanceFeet: 10 },
        { bearing: bearing('south', 0, 0, 0, 'east'), distanceFeet: 10 },
      ]),
    ).toBeNull();
  });

  it('refuses a call with no real distance', () => {
    const calls: SurveyCall[] = [
      { bearing: bearing('north', 0, 0, 0, 'east'), distanceFeet: 100 },
      { bearing: bearing('south', 90, 0, 0, 'east'), distanceFeet: 0 },
      { bearing: bearing('south', 0, 0, 0, 'east'), distanceFeet: 100 },
      { bearing: bearing('north', 90, 0, 0, 'west'), distanceFeet: 100 },
    ];

    expect(walkTraverse(calls)).toBeNull();
  });

  /*
   * A 100 x 100 foot square, walked north, east, south, west. 100 feet is
   * 30.48 metres exactly, which is what makes this the right first check:
   * the numbers can be verified by hand.
   */
  it('walks a square and closes on its own first corner', () => {
    const side = 100;
    const traverse = walkTraverse([
      { bearing: bearing('north', 0, 0, 0, 'east'), distanceFeet: side },
      { bearing: bearing('north', 90, 0, 0, 'east'), distanceFeet: side },
      { bearing: bearing('south', 0, 0, 0, 'east'), distanceFeet: side },
      { bearing: bearing('south', 90, 0, 0, 'west'), distanceFeet: side },
    ]);

    expect(traverse).not.toBeNull();
    expect(traverse?.closes).toBe(true);
    expect(traverse?.closureErrorMetres).toBeCloseTo(0, 3);
    expect(traverse?.ring).toEqual([
      [0, 0],
      [0, 30.48],
      [30.48, 30.48],
      [30.48, 0],
      [0, 0],
    ]);
  });

  /*
   * The real reason this is arithmetic and not a model's opinion: a bearing
   * read wrong shows up as a gap. Here the last leg is ten feet short, and
   * the traverse says so instead of quietly snapping shut.
   */
  it('reports the gap when the calls do not close', () => {
    const traverse = walkTraverse([
      { bearing: bearing('north', 0, 0, 0, 'east'), distanceFeet: 100 },
      { bearing: bearing('north', 90, 0, 0, 'east'), distanceFeet: 100 },
      { bearing: bearing('south', 0, 0, 0, 'east'), distanceFeet: 100 },
      { bearing: bearing('south', 90, 0, 0, 'west'), distanceFeet: 90 },
    ]);

    expect(traverse?.closes).toBe(false);
    expect(traverse?.closureErrorMetres).toBeCloseTo(10 * 0.3048, 3);
    // The ring still closes as a figure — a boundary with a stated error is
    // usable; a ring with a hole in it is not drawable at all.
    expect(traverse?.ring.at(0)).toEqual(traverse?.ring.at(-1));
  });

  /*
   * The owner's own plat, 7612 Cascade Way: three straight lot lines and the
   * road frontage, as printed. The frontage is a curve on the drawing
   * (RADIUS 1226.00, ARC 78.67) and its CHORD — 78.66 — is what a straight
   * traverse walks, which is why the closure error is centimetres rather
   * than zero and why it is reported rather than hidden.
   */
  it('walks the plat that prompted this capability', () => {
    const traverse = walkTraverse([
      { bearing: bearing('north', 46, 54, 11, 'east'), distanceFeet: 135.06 },
      { bearing: bearing('south', 44, 55, 39, 'east'), distanceFeet: 70.02 },
      { bearing: bearing('south', 43, 12, 31, 'west'), distanceFeet: 135.1 },
      { bearing: bearing('north', 45, 55, 0, 'west'), distanceFeet: 78.66 },
    ]);

    expect(traverse).not.toBeNull();
    expect(traverse?.ring).toHaveLength(5);
    // A residential lot of about 10,000 square feet, which is what the plat
    // itself states as its survey area (10,068 sq ft).
    expect(area(traverse?.ring ?? [])).toBeGreaterThan(850);
    expect(area(traverse?.ring ?? [])).toBeLessThan(1_000);
  });
});

describe('closeTraverse', () => {
  /*
   * The reading a real model returned for the owner's plat on 2026-08-06,
   * copied verbatim from the live call. Every distance and angle is right;
   * the printed bearings simply do not all run the same way around the
   * parcel, so read literally they leave a 108-metre gap.
   *
   * This is the fixture that matters: it is what the product actually
   * receives, not what a test author would have invented.
   */
  const MODEL_READING: SurveyCall[] = [
    { bearing: bearing('north', 46, 54, 11, 'east'), distanceFeet: 135.06 },
    { bearing: bearing('south', 44, 56, 39, 'east'), distanceFeet: 70.02 },
    { bearing: bearing('north', 43, 12, 31, 'east'), distanceFeet: 135.1 },
    { bearing: bearing('north', 45, 55, 0, 'west'), distanceFeet: 78.63 },
  ];

  it('does not close when the printed directions are walked literally', () => {
    expect(walkTraverse(MODEL_READING)?.closes).toBe(false);
  });

  it('closes the same reading by walking each line the way that fits', () => {
    const traverse = closeTraverse(MODEL_READING);

    expect(traverse?.closes).toBe(true);
    expect(traverse?.closureErrorMetres).toBeLessThan(0.5);
  });

  /*
   * The independent check the survey provides on itself: the sheet states
   * 10,068 square feet — 935.3 m². A polygon within a percent of that is a
   * polygon whose numbers were read correctly, and no test author supplied
   * that agreement.
   */
  it('produces a lot whose area matches the plat’s own stated area', () => {
    const traverse = closeTraverse(MODEL_READING);
    const statedSquareMetres = 10_068 * 0.092_903_04;

    expect(area(traverse?.ring ?? [])).toBeGreaterThan(statedSquareMetres * 0.99);
    expect(area(traverse?.ring ?? [])).toBeLessThan(statedSquareMetres * 1.01);
  });

  it('leaves a document too large to be a residential lot to the plain walk', () => {
    const many: SurveyCall[] = Array.from({ length: 13 }, () => ({
      bearing: bearing('north', 10, 0, 0, 'east'),
      distanceFeet: 10,
    }));

    expect(closeTraverse(many)?.closes).toBe(false);
  });
});

/** Shoelace area in square metres, for checking the walked ring is the right size. */
function area(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0];
    const [x2, y2] = ring[index + 1] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
