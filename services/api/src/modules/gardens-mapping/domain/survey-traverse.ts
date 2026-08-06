/**
 * A surveyor's boundary calls, turned into a polygon by arithmetic.
 *
 * A plat of survey does not draw a lot so much as describe it: from a corner,
 * go `N 46°54'11" E` for `135.06` feet, then `S 44°55'39" E` for `70.02`, and
 * so on until the description closes on the corner it started from. Those
 * numbers are the survey — the picture is an illustration of them.
 *
 * This module does the walk. It is deliberately separate from whatever READ
 * the calls off a page (ADR-0018 has a vision model doing that): a model
 * asked for a polygon hides its arithmetic, and with it the survey's own
 * built-in check. A traverse that fails to return to its start is a traverse
 * with an error in it, and the size of that gap is the honest measure of how
 * much to trust the result. Computing the walk here keeps that number.
 *
 * Bearings are quadrant bearings, the notation every US plat uses: a
 * north-or-south reference, an angle turned toward east or west. `N 46°54'11" E`
 * is 46.903° clockwise from north. Distances are feet on this continent, and
 * this product's geometry is metres, so the conversion happens once, here.
 *
 * Source: docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md;
 * architecture/data-and-geospatial-design.md, section "9. Georeferencing".
 */

/** Exactly 0.3048 metres, by international definition since 1959. */
const METRES_PER_FOOT = 0.3048;

/** Feet of misclosure a residential lot traverse may show before this refuses to call it a boundary. */
export const MAX_ACCEPTABLE_CLOSURE_METRES = 0.5;

export type BearingReference = 'north' | 'south';
export type BearingTurn = 'east' | 'west';

export interface SurveyBearing {
  readonly reference: BearingReference;
  readonly degrees: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly turn: BearingTurn;
}

export interface SurveyCall {
  readonly bearing: SurveyBearing;
  /** Along the line, in feet, as printed. */
  readonly distanceFeet: number;
}

export interface SurveyTraverse {
  /** The polygon's exterior ring, closed, in local metres with the first corner at the origin. */
  readonly ring: readonly (readonly [number, number])[];
  /** How far the last call landed from the first corner, in metres. Zero is a perfect close. */
  readonly closureErrorMetres: number;
  /** `false` when the calls do not describe a closed figure this product will call a boundary. */
  readonly closes: boolean;
}

/**
 * The bearing as an azimuth: degrees clockwise from north, in `[0, 360)`.
 *
 * `N … E` turns east from north; `N … W` turns west; `S … E` turns east from
 * south, which is 180 minus the angle; `S … W` is 180 plus.
 */
export function azimuthDegrees(bearing: SurveyBearing): number {
  const angle = bearing.degrees + bearing.minutes / 60 + bearing.seconds / 3600;

  if (bearing.reference === 'north') {
    return bearing.turn === 'east' ? angle : (360 - angle) % 360;
  }
  return bearing.turn === 'east' ? 180 - angle : 180 + angle;
}

/**
 * Walks the calls from the origin and returns the ring they describe.
 *
 * Local metres, north-up: x grows east, y grows north, which is this
 * product's own local planar convention. The ring is closed by repeating the
 * first corner, and the closure error is reported rather than hidden by
 * snapping the last point onto the first — a boundary that does not close is
 * a fact about the reading, and the person accepting it is entitled to it.
 */
export function walkTraverse(calls: readonly SurveyCall[]): SurveyTraverse | null {
  if (calls.length < 3) {
    return null;
  }

  const corners: [number, number][] = [[0, 0]];
  let x = 0;
  let y = 0;

  for (const call of calls) {
    if (!Number.isFinite(call.distanceFeet) || call.distanceFeet <= 0) {
      return null;
    }
    const metres = call.distanceFeet * METRES_PER_FOOT;
    const azimuth = (azimuthDegrees(call.bearing) * Math.PI) / 180;
    // Azimuth is measured clockwise FROM NORTH, so north is the cosine and
    // east the sine — the transpose of the usual mathematical convention, and
    // the reason this is written out rather than assumed.
    x += metres * Math.sin(azimuth);
    y += metres * Math.cos(azimuth);
    corners.push([x, y]);
  }

  const closureErrorMetres = Math.hypot(x, y);
  // The final corner IS the first one, as the survey intends; the gap between
  // where the walk actually landed and the origin is carried separately.
  corners[corners.length - 1] = [0, 0];

  return {
    ring: corners.map(([cornerX, cornerY]) => [round(cornerX), round(cornerY)] as const),
    closureErrorMetres: round(closureErrorMetres),
    closes: closureErrorMetres <= MAX_ACCEPTABLE_CLOSURE_METRES,
  };
}

/** The same bearing, turned around: the line walked in the other direction. */
function reversed(bearing: SurveyBearing): SurveyBearing {
  return {
    ...bearing,
    reference: bearing.reference === 'north' ? 'south' : 'north',
    turn: bearing.turn === 'east' ? 'west' : 'east',
  };
}

/**
 * The traverse the calls describe, with each line walked in whichever
 * direction closes the figure.
 *
 * A plat prints the bearing of each line as the surveyor recorded it, and
 * those directions do not all run the same way around the parcel: reading
 * them literally walks some lines backwards and lands nowhere near the start.
 * The owner's own plat did exactly that on 2026-08-06 — every distance and
 * angle transcribed correctly, and a 108-metre gap.
 *
 * What is inferred here is ONLY the sense of each line, never its length or
 * its angle: reversing a bearing adds 180°, so the parcel's shape is entirely
 * the survey's. The closure error still decides — the combination that closes
 * best is returned, and if even the best one leaves a gap, it says so.
 *
 * Bounded deliberately: beyond twelve calls the search is 4,096 walks and the
 * document is no longer a residential lot, so it refuses rather than grinding.
 */
export function closeTraverse(calls: readonly SurveyCall[]): SurveyTraverse | null {
  if (calls.length < 3 || calls.length > 12) {
    return walkTraverse(calls);
  }

  let best: SurveyTraverse | null = null;
  // The first line's direction is arbitrary — reversing every line just walks
  // the same polygon the other way round — so it stays as printed and only
  // the rest are searched.
  for (let mask = 0; mask < 1 << (calls.length - 1); mask += 1) {
    const walked = walkTraverse(
      calls.map((call, index) =>
        index > 0 && (mask & (1 << (index - 1))) !== 0
          ? { ...call, bearing: reversed(call.bearing) }
          : call,
      ),
    );
    if (walked === null) {
      return null;
    }
    if (best === null || walked.closureErrorMetres < best.closureErrorMetres) {
      best = walked;
    }
  }
  return best;
}

/** Millimetre resolution, the same rounding the geometry contracts apply on write. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
