import { describe, expect, it } from 'vitest';

import { closeTraverse, type SurveyCall } from './survey-traverse.js';

/**
 * The three lines every reading of the owner's plat transcribed identically
 * and correctly. The fourth — the curved road frontage, whose direction is
 * printed as a chord bearing among radius and arc figures — is what varies.
 */
const CASCADE_WAY_STRAIGHT_SIDES: SurveyCall[] = [
  {
    bearing: { reference: 'north', degrees: 46, minutes: 54, seconds: 11, turn: 'east' },
    distanceFeet: 135.06,
  },
  {
    bearing: { reference: 'south', degrees: 44, minutes: 56, seconds: 39, turn: 'east' },
    distanceFeet: 70.02,
  },
  {
    bearing: { reference: 'north', degrees: 43, minutes: 12, seconds: 31, turn: 'east' },
    distanceFeet: 135.1,
  },
];

const CHORD_DISTANCE_FEET = 78.63;

function withFrontage(bearing: SurveyCall['bearing']): SurveyCall[] {
  return [...CASCADE_WAY_STRAIGHT_SIDES, { bearing, distanceFeet: CHORD_DISTANCE_FEET }];
}

describe('closeTraverse repairs one lost bearing from the figure itself', () => {
  /*
   * What the live model actually returned on 2026-08-06, twice, from the
   * owner's own plat: a zero bearing for the curve on one reading and a wrong
   * quadrant on the next, leaving 17 and 30 metres of misclosure. Both are
   * the same defect — three sides read perfectly, one direction lost — and a
   * closed figure determines the missing one.
   */
  it.each([
    ['a zero bearing', { reference: 'north', degrees: 0, minutes: 0, seconds: 0, turn: 'east' }],
    [
      'the wrong quadrant',
      { reference: 'south', degrees: 44, minutes: 11, seconds: 0, turn: 'west' },
    ],
  ] as const)('recovers the road frontage read as %s', (_name, bearing) => {
    const traverse = closeTraverse(withFrontage(bearing));

    expect(traverse?.closes).toBe(true);
    expect(traverse?.repairedBearing?.callIndex).toBe(3);
    // The check that makes the repair a survey rather than a guess: the
    // closing line's own length agrees with the 78.63 feet printed for it.
    expect(traverse?.repairedBearing?.lengthDisagreementMetres ?? 1).toBeLessThan(0.5);
  });

  /*
   * The repaired parcel must be the SAME parcel a correct reading produces —
   * 10,068 square feet, as the sheet itself states, which is 935.3 m².
   */
  it('produces the parcel the sheet states the area of', () => {
    const traverse = closeTraverse(
      withFrontage({ reference: 'north', degrees: 0, minutes: 0, seconds: 0, turn: 'east' }),
    );
    const ring = traverse?.ring ?? [];

    let sum = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [x1, y1] = ring[index] ?? [0, 0];
      const [x2, y2] = ring[index + 1] ?? [0, 0];
      sum += x1 * y2 - x2 * y1;
    }
    const areaSquareMetres = Math.abs(sum) / 2;

    expect(areaSquareMetres).toBeGreaterThan(925);
    expect(areaSquareMetres).toBeLessThan(945);
  });

  // A reading that already closes is left exactly as it is — the repair is a
  // recovery, never a routine step.
  it('leaves a reading that already closes untouched', () => {
    const traverse = closeTraverse(
      withFrontage({ reference: 'north', degrees: 45, minutes: 55, seconds: 0, turn: 'west' }),
    );

    expect(traverse?.closes).toBe(true);
    expect(traverse?.repairedBearing).toBeUndefined();
    expect(traverse?.closureErrorMetres ?? 1).toBeLessThan(0.5);
  });

  /*
   * What the live model does in six readings out of eight: it returns the
   * curved frontage WITHOUT a bearing rather than inventing one. The side is
   * there, so the figure solves it outright — and the printed 78.63 feet is
   * still the check.
   */
  it('solves a line the reader returned without a bearing', () => {
    const traverse = closeTraverse([
      ...CASCADE_WAY_STRAIGHT_SIDES,
      { bearing: null, distanceFeet: CHORD_DISTANCE_FEET },
    ]);

    expect(traverse?.closes).toBe(true);
    expect(traverse?.repairedBearing?.callIndex).toBe(3);
    expect(traverse?.repairedBearing?.lengthDisagreementMetres ?? 1).toBeLessThan(0.5);
  });

  /*
   * And what it must never do again: drop the side entirely. Three sides of a
   * four-sided parcel describe no parcel at all, and nothing here will invent
   * the fourth.
   */
  it('does not invent a side that was never returned', () => {
    const traverse = closeTraverse(CASCADE_WAY_STRAIGHT_SIDES);

    expect(traverse?.closes).toBe(false);
    expect(traverse?.repairedBearing).toBeUndefined();
  });

  /*
   * Two lost bearings are two unknowns in one equation. The figure does not
   * determine them, so nothing is repaired and the misclosure stands.
   */
  it('refuses when more than one bearing is lost', () => {
    const traverse = closeTraverse([
      CASCADE_WAY_STRAIGHT_SIDES[0] ?? { bearing: {} as never, distanceFeet: 1 },
      {
        bearing: { reference: 'north', degrees: 0, minutes: 0, seconds: 0, turn: 'east' },
        distanceFeet: 70.02,
      },
      {
        bearing: { reference: 'north', degrees: 0, minutes: 0, seconds: 0, turn: 'east' },
        distanceFeet: 135.1,
      },
      {
        bearing: { reference: 'north', degrees: 45, minutes: 55, seconds: 0, turn: 'west' },
        distanceFeet: CHORD_DISTANCE_FEET,
      },
    ]);

    expect(traverse?.repairedBearing).toBeUndefined();
    expect(traverse?.closes).toBe(false);
  });
});
