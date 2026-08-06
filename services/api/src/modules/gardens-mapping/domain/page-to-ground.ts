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
 * Umeyama's closed form for the 2-D similarity: centre both point sets, take
 * the covariance, and read the rotation off it. Closed form rather than an
 * iterative fit because the correspondence is known — corner i of the page
 * outline IS corner i of the surveyed polygon — and because a closed form
 * cannot converge to something plausible-looking but wrong.
 *
 * Returns `null` when the two rings do not describe the same corners: fewer
 * than three points, different lengths, or a degenerate page outline.
 */
export function fitPageToGround(
  pageRing: readonly PagePoint[],
  groundRing: readonly GroundPoint[],
): PageToGroundTransform | null {
  const page = withoutClosingPoint(pageRing);
  const ground = withoutClosingPoint(groundRing);

  if (page.length < 3 || page.length !== ground.length) {
    return null;
  }

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
