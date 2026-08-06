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

/**
 * How much better the winning repair must agree with its printed distance
 * than any repair describing a different parcel — see `decisiveRepair`. Ten
 * to one, or a fifth of a metre outright, whichever the numbers reach first.
 */
const DECISIVE_REPAIR_RATIO = 10;
const DECISIVE_REPAIR_MARGIN_METRES = 0.2;

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
  /**
   * `null` when the reading could not make out this line's direction. The
   * line is still a side of the parcel, and a closed figure determines the
   * one direction it is missing — see `closeTraverse`.
   */
  readonly bearing: SurveyBearing | null;
  /** Along the line, in feet, as printed. */
  readonly distanceFeet: number;
}

/**
 * One bearing the reading lost and the figure itself supplied.
 *
 * See `repairSingleBearing`: the direction is taken from the closing of the
 * parcel, and the printed distance for that same line is the independent
 * check on it. Present only when a repair was applied.
 */
export interface SurveyBearingRepair {
  /** Which call's bearing was replaced, indexed as the calls were given. */
  readonly callIndex: number;
  /**
   * How far the closing line's own length is from the distance printed for
   * that line, in metres. This is the honest error of the repaired boundary:
   * a near-zero disagreement means the survey and the reading agree about
   * that side's length, and only its direction had been misread.
   */
  readonly lengthDisagreementMetres: number;
}

export interface SurveyTraverse {
  /** The polygon's exterior ring, closed, in local metres with the first corner at the origin. */
  readonly ring: readonly (readonly [number, number])[];
  /** How far the last call landed from the first corner, in metres. Zero is a perfect close. */
  readonly closureErrorMetres: number;
  /** `false` when the calls do not describe a closed figure this product will call a boundary. */
  readonly closes: boolean;
  /** Present when one bearing was taken from the figure's own closing rather than from the page. */
  readonly repairedBearing?: SurveyBearingRepair;
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
    if (call.bearing === null || !Number.isFinite(call.distanceFeet) || call.distanceFeet <= 0) {
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

  /*
   * A line the reading could not make out is the one unknown a closed figure
   * solves outright — no search needed, and the distance printed for that
   * line is still the check. This is the ordinary case for a curved road
   * frontage, whose direction is printed as a chord bearing among radius and
   * arc figures: the reader returns the side with its distance and no
   * bearing rather than dropping the side, because a parcel described by
   * three of its four sides is not a parcel.
   */
  const unread = calls.reduce<number[]>(
    (indices, call, index) => (call.bearing === null ? [...indices, index] : indices),
    [],
  );
  if (unread.length > 1) {
    // Two unknown directions in one closed figure have infinitely many
    // solutions. Nothing here will pick one.
    return null;
  }
  if (unread.length === 1) {
    return solveForUnreadBearing(calls, unread[0] ?? 0);
  }

  let best: SurveyTraverse | null = null;
  // The first line's direction is arbitrary — reversing every line just walks
  // the same polygon the other way round — so it stays as printed and only
  // the rest are searched.
  for (let mask = 0; mask < 1 << (calls.length - 1); mask += 1) {
    const walked = walkTraverse(
      calls.map((call, index) =>
        index > 0 && (mask & (1 << (index - 1))) !== 0 && call.bearing !== null
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

  return best !== null && best.closes ? best : (repairSingleBearing(calls) ?? best);
}

/**
 * The parcel with its one unread line supplied by the closing, searching the
 * remaining lines' directions the same way `closeTraverse` does — a plat
 * prints each line as the surveyor recorded it, and those senses do not all
 * run the same way round.
 */
function solveForUnreadBearing(
  calls: readonly SurveyCall[],
  unreadIndex: number,
): SurveyTraverse | null {
  let best: SurveyTraverse | null = null;

  for (let mask = 0; mask < 1 << (calls.length - 1); mask += 1) {
    const oriented = calls.map((call, index) =>
      index !== unreadIndex &&
      index > 0 &&
      (mask & (1 << (index - 1))) !== 0 &&
      call.bearing !== null
        ? { ...call, bearing: reversed(call.bearing) }
        : call,
    );
    const fit = closeThrough(oriented, unreadIndex);
    if (fit === null) {
      continue;
    }
    if (best === null) {
      best = fit;
      continue;
    }
    if (!sameRing(best.ring, fit.ring)) {
      // More than one parcel fits the same measurements. The figure does not
      // say which, and neither will this.
      return null;
    }
  }

  return best;
}

/**
 * The bearing of one line, taken from the parcel's own closing.
 *
 * A plat is a closed figure — that is what makes it a survey rather than a
 * sketch — so a traverse of n sides is over-determined: any n−1 correct
 * calls determine the last side exactly. When a reading transcribes every
 * distance but loses ONE bearing, the figure itself says what that bearing
 * must have been, and the distance printed for that same line is an
 * INDEPENDENT check that the right call was repaired: the closing line's
 * length either agrees with the printed one or it does not.
 *
 * This is the failure this exists for, observed directly on the owner's own
 * plat: three lines transcribed perfectly and the fourth — the curved road
 * frontage, whose bearing is printed as a chord bearing among radius and arc
 * figures — came back as `N 0°0'0" E` on one reading and `S 44°11' W` on the
 * next, leaving 17 and 30 metres of misclosure. The distances were identical
 * and correct in every run.
 *
 * What it will NOT do:
 *
 * - repair more than one bearing. Two unknowns in a closed figure have
 *   infinitely many solutions, and picking one would be inventing a parcel.
 * - repair when several candidates fit. If two different lines could each be
 *   the misread one, the figure does not identify which, and a guess between
 *   them is not a survey.
 * - repair a length. Only the direction of the closing line is taken; its
 *   printed length stays the check rather than becoming the answer.
 *
 * Returns `null` when no single repair explains the misclosure, in which case
 * the caller keeps the unrepaired walk and its honest error.
 */
function repairSingleBearing(calls: readonly SurveyCall[]): SurveyTraverse | null {
  const candidates: SurveyTraverse[] = [];

  for (let mask = 0; mask < 1 << (calls.length - 1); mask += 1) {
    const oriented = calls.map((call, index) =>
      index > 0 && (mask & (1 << (index - 1))) !== 0 && call.bearing !== null
        ? { ...call, bearing: reversed(call.bearing) }
        : call,
    );

    for (let index = 0; index < oriented.length; index += 1) {
      const fit = closeThrough(oriented, index);
      if (fit !== null) {
        candidates.push(fit);
      }
    }
  }

  return decisiveRepair(candidates);
}

/**
 * The one repair the survey's own distances single out, or `null` when they
 * single out none.
 *
 * A small misclosure is the hard case, not the easy one: when the walk misses
 * by half a metre, replacing ANY side by the closing line produces a length
 * within half a metre of what that side should be, so several repairs look
 * admissible at once. What separates them is HOW WELL the closing length
 * agrees with the printed distance — a genuinely misread direction leaves the
 * other sides exact, so its repair agrees to centimetres while every rival
 * agrees only to about the misclosure.
 *
 * So the best candidate must be decisively better than the best rival that
 * describes a DIFFERENT parcel: an order of magnitude, or a clear margin in
 * metres. Anything less is two explanations of the same measurements, and a
 * survey does not choose between those by preference.
 */
function decisiveRepair(candidates: readonly SurveyTraverse[]): SurveyTraverse | null {
  const ranked = [...candidates].sort(
    (left, right) =>
      (left.repairedBearing?.lengthDisagreementMetres ?? Number.POSITIVE_INFINITY) -
      (right.repairedBearing?.lengthDisagreementMetres ?? Number.POSITIVE_INFINITY),
  );
  const best = ranked[0];
  if (best === undefined) {
    return null;
  }

  const rival = ranked.find((candidate) => !sameRing(candidate.ring, best.ring));
  if (rival === undefined) {
    return best;
  }

  const bestError = best.repairedBearing?.lengthDisagreementMetres ?? Number.POSITIVE_INFINITY;
  const rivalError = rival.repairedBearing?.lengthDisagreementMetres ?? Number.POSITIVE_INFINITY;
  const decisive =
    rivalError >= bestError * DECISIVE_REPAIR_RATIO ||
    rivalError - bestError >= DECISIVE_REPAIR_MARGIN_METRES;

  return decisive ? best : null;
}

/**
 * The ring these calls describe when the call at `unknownIndex` is replaced
 * by whatever vector closes the figure — or `null` when that vector's length
 * disagrees with the distance printed for that line.
 */
function closeThrough(calls: readonly SurveyCall[], unknownIndex: number): SurveyTraverse | null {
  const unknown = calls[unknownIndex];
  if (
    unknown === undefined ||
    !Number.isFinite(unknown.distanceFeet) ||
    unknown.distanceFeet <= 0
  ) {
    return null;
  }
  if (calls.some((call) => !Number.isFinite(call.distanceFeet) || call.distanceFeet <= 0)) {
    return null;
  }

  const vectors = calls.map((call, index) =>
    index === unknownIndex ? ([0, 0] as const) : vectorOf(call),
  );

  let sumX = 0;
  let sumY = 0;
  for (const vector of vectors) {
    sumX += vector[0];
    sumY += vector[1];
  }

  // The missing side is exactly the vector back to where the walk began.
  const closingX = -sumX;
  const closingY = -sumY;
  const closingLength = Math.hypot(closingX, closingY);
  const printedLength = unknown.distanceFeet * METRES_PER_FOOT;
  const disagreement = Math.abs(closingLength - printedLength);
  if (disagreement > MAX_ACCEPTABLE_CLOSURE_METRES) {
    return null;
  }

  const corners: [number, number][] = [[0, 0]];
  let x = 0;
  let y = 0;
  for (let index = 0; index < calls.length; index += 1) {
    const vector = index === unknownIndex ? ([closingX, closingY] as const) : vectors[index];
    x += vector?.[0] ?? 0;
    y += vector?.[1] ?? 0;
    corners.push([x, y]);
  }
  corners[corners.length - 1] = [0, 0];

  return {
    ring: corners.map(([cornerX, cornerY]) => [round(cornerX), round(cornerY)] as const),
    closureErrorMetres: 0,
    closes: true,
    repairedBearing: { callIndex: unknownIndex, lengthDisagreementMetres: round(disagreement) },
  };
}

/** One call as an east/north offset in metres. A call with no bearing contributes nothing; only `closeThrough`'s unknown may be one. */
function vectorOf(call: SurveyCall): readonly [number, number] {
  if (call.bearing === null) {
    return [0, 0];
  }
  const metres = call.distanceFeet * METRES_PER_FOOT;
  const azimuth = (azimuthDegrees(call.bearing) * Math.PI) / 180;
  return [metres * Math.sin(azimuth), metres * Math.cos(azimuth)];
}

/** Two rings describing the same parcel, to within the closure tolerance at every corner. */
function sameRing(
  left: readonly (readonly [number, number])[],
  right: readonly (readonly [number, number])[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((corner, index) => {
    const other = right[index] ?? [Number.NaN, Number.NaN];
    return Math.hypot(corner[0] - other[0], corner[1] - other[1]) <= MAX_ACCEPTABLE_CLOSURE_METRES;
  });
}

/** Millimetre resolution, the same rounding the geometry contracts apply on write. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
