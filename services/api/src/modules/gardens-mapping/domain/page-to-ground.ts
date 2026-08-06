/**
 * Carrying everything drawn on a plat into real metres, using the one thing
 * on the sheet whose true shape is known exactly: the lot.
 *
 * The division of labour is the point (ADR-0018). A vision model is good at
 * saying WHERE something sits on a page and bad at arithmetic, so it outlines
 * the house, the deck and the drive in page coordinates. The survey's own
 * boundary calls give the lot's true polygon in metres. Fitting the lot's
 * page outline onto its surveyed polygon yields one similarity transform —
 * rotation, uniform scale, translation — and every other outline rides it.
 *
 * Nothing here trusts the model for a dimension. The scale comes from the
 * survey; the model only says where on the paper a thing is. The residual of
 * the fit is reported, so a page outline that disagrees with the surveyed
 * shape shows up as a number rather than as a house in the wrong place.
 *
 * A similarity, deliberately not an affine: a plat is drawn to scale, so
 * allowing independent x and y scaling or shear would let a bad reading
 * stretch the drawing into agreement and hide its own error.
 *
 * Source: docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md.
 */

export type PagePoint = readonly [number, number];
export type GroundPoint = readonly [number, number];

export interface PageToGroundTransform {
  /** Uniform metres per page unit. */
  readonly scale: number;
  /** Radians, counter-clockwise, applied before translation. */
  readonly rotationRadians: number;
  readonly translateX: number;
  readonly translateY: number;
  /** Root-mean-square distance, in metres, between the fitted lot corners and the surveyed ones. */
  readonly residualMetres: number;
}

/**
 * The similarity transform that best carries `pageRing` onto `groundRing`.
 *
 * The correspondence is NOT assumed. A reader tracing the lot on the page
 * starts wherever it likes, runs either way round, and often puts down more
 * points than the survey has sides — the owner's own plat came back with six
 * page corners against four surveyed ones, because the drawing shows a
 * curved frontage as several short segments. So:
 *
 * 1. a page outline with more corners than the survey is reduced to the
 *    survey's count by dropping, one at a time, the corner whose removal
 *    changes the outline's shape least (the smallest triangle it forms with
 *    its neighbours — Visvalingam's measure);
 * 2. every starting corner and both directions round are tried;
 * 3. the fit with the smallest residual wins, and that residual is reported.
 *
 * Each individual fit is Umeyama's closed form for the 2-D similarity: centre
 * both point sets, take the covariance, read the rotation off it. Closed form
 * rather than iterative because a closed form cannot converge to something
 * plausible-looking but wrong; the search above only chooses BETWEEN closed
 * forms, and the residual says which one to believe.
 *
 * Returns `null` when no correspondence is possible: fewer than three points
 * on either side, fewer page corners than surveyed ones, or a degenerate
 * outline with no extent to take a scale from.
 */
export function fitPageToGround(
  pageRing: readonly PagePoint[],
  groundRing: readonly GroundPoint[],
): PageToGroundTransform | null {
  const traced = withoutClosingPoint(pageRing);
  const ground = withoutClosingPoint(groundRing);

  if (traced.length < 3 || ground.length < 3 || traced.length < ground.length) {
    return null;
  }

  const page = traced.length === ground.length ? traced : reduceToCorners(traced, ground.length);

  let best: PageToGroundTransform | null = null;
  for (const ordering of orderings(page)) {
    const fit = fitCorresponding(ordering, ground);
    if (fit !== null && (best === null || fit.residualMetres < best.residualMetres)) {
      best = fit;
    }
  }
  return best;
}

/** One closed-form fit for one already-decided correspondence: corner i to corner i. */
function fitCorresponding(
  page: readonly PagePoint[],
  ground: readonly GroundPoint[],
): PageToGroundTransform | null {
  const pageCentre = centroid(page);
  const groundCentre = centroid(ground);

  let covarianceXx = 0;
  let covarianceXy = 0;
  let pageVariance = 0;

  for (let index = 0; index < page.length; index += 1) {
    const [px, py] = page[index] ?? [0, 0];
    const [gx, gy] = ground[index] ?? [0, 0];
    const dpx = px - pageCentre[0];
    // Page y grows DOWNWARD (an image), ground y grows north. Flipping here
    // rather than in the caller keeps every outline's handedness consistent
    // and is why a plat traced clockwise on paper stays clockwise on the map.
    const dpy = -(py - pageCentre[1]);
    const dgx = gx - groundCentre[0];
    const dgy = gy - groundCentre[1];

    covarianceXx += dpx * dgx + dpy * dgy;
    covarianceXy += dpx * dgy - dpy * dgx;
    pageVariance += dpx * dpx + dpy * dpy;
  }

  if (pageVariance <= Number.EPSILON) {
    return null;
  }

  const rotationRadians = Math.atan2(covarianceXy, covarianceXx);
  const scale = Math.hypot(covarianceXx, covarianceXy) / pageVariance;
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  const translateX = groundCentre[0] - scale * (cos * pageCentre[0] - sin * -pageCentre[1]);
  const translateY = groundCentre[1] - scale * (sin * pageCentre[0] + cos * -pageCentre[1]);

  const provisional: PageToGroundTransform = {
    scale,
    rotationRadians,
    translateX,
    translateY,
    residualMetres: 0,
  };

  let squaredError = 0;
  for (let index = 0; index < page.length; index += 1) {
    const [fx, fy] = applyPageToGround(page[index] ?? [0, 0], provisional);
    const [gx, gy] = ground[index] ?? [0, 0];
    squaredError += (fx - gx) ** 2 + (fy - gy) ** 2;
  }

  return {
    ...provisional,
    residualMetres: round(Math.sqrt(squaredError / page.length)),
  };
}

/** One page point in garden-local metres. */
export function applyPageToGround(point: PagePoint, transform: PageToGroundTransform): GroundPoint {
  const cos = Math.cos(transform.rotationRadians);
  const sin = Math.sin(transform.rotationRadians);
  const x = point[0];
  // Same downward-y flip as the fit above.
  const y = -point[1];
  return [
    round(transform.scale * (cos * x - sin * y) + transform.translateX),
    round(transform.scale * (sin * x + cos * y) + transform.translateY),
  ];
}

/**
 * An open run of points in metres — a path's course, a fence line, a single
 * trunk position. Open deliberately: closing it would turn a driveway into a
 * loop, and the categories that need a closed ring use `outlineToGround`.
 */
export function pointsToGround(
  points: readonly PagePoint[],
  transform: PageToGroundTransform,
): readonly GroundPoint[] {
  return points.map((point) => applyPageToGround(point, transform));
}

/** A whole outline in metres, closed, ready to become a polygon. */
export function outlineToGround(
  outline: readonly PagePoint[],
  transform: PageToGroundTransform,
): readonly GroundPoint[] | null {
  const ring = withoutClosingPoint(outline);
  if (ring.length < 3) {
    return null;
  }
  const carried = ring.map((point) => applyPageToGround(point, transform));
  const first = carried[0];
  return first === undefined ? null : [...carried, first];
}

/**
 * Every correspondence worth trying: each starting corner, each way round.
 *
 * A reader is not told where to begin tracing, and a plat can be drawn with
 * north anywhere on the sheet, so neither the first corner nor the direction
 * is knowable in advance. `2n` candidates for `n` corners is nothing to
 * evaluate, and the residual — not a guess about the reader's habits —
 * decides between them.
 */
function orderings(page: readonly PagePoint[]): readonly (readonly PagePoint[])[] {
  const forward = page;
  const backward = [...page].reverse();
  const candidates: (readonly PagePoint[])[] = [];

  for (const direction of [forward, backward]) {
    for (let start = 0; start < direction.length; start += 1) {
      candidates.push([...direction.slice(start), ...direction.slice(0, start)]);
    }
  }
  return candidates;
}

/**
 * The outline with the least significant corners dropped until only `count`
 * remain.
 *
 * Significance is Visvalingam's: the area of the triangle a corner makes with
 * its two neighbours, which is small exactly where a corner barely bends the
 * outline. A curved frontage traced as several nearly-straight segments loses
 * its intermediate points and keeps the real corners, which is what has to
 * survive for the fit to mean anything.
 */
function reduceToCorners(outline: readonly PagePoint[], count: number): readonly PagePoint[] {
  const remaining = [...outline];

  while (remaining.length > count) {
    let leastIndex = 0;
    let leastArea = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index - 1 + remaining.length) % remaining.length] ?? [0, 0];
      const current = remaining[index] ?? [0, 0];
      const next = remaining[(index + 1) % remaining.length] ?? [0, 0];
      const area = Math.abs(
        (current[0] - previous[0]) * (next[1] - previous[1]) -
          (next[0] - previous[0]) * (current[1] - previous[1]),
      );
      if (area < leastArea) {
        leastArea = area;
        leastIndex = index;
      }
    }
    remaining.splice(leastIndex, 1);
  }

  return remaining;
}

function withoutClosingPoint<T extends readonly [number, number]>(
  ring: readonly T[],
): readonly T[] {
  if (ring.length < 2) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

function centroid(points: readonly (readonly [number, number])[]): readonly [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of points) {
    x += px;
    y += py;
  }
  return [x / points.length, y / points.length];
}

/** Millimetre resolution, matching the geometry contracts' own write rounding. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
