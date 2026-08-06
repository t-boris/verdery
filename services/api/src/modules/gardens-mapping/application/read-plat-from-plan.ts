/**
 * Reading an uploaded plat of survey into something a person can look at
 * next to the drawing.
 *
 * WRITES NOTHING. Not the georeference, not an object, not a stored proposal:
 * it transcribes, walks the calls, and hands back the result. Accepting any
 * of it is a separate ordinary act — `SetGardenGeoreference` for the location
 * and north, a map command for the boundary — each of which already carries
 * its own authorization, revision guard and audit trail. That separation is
 * ADR-0018's point, and keeping this use case free of writes is what makes it
 * structural rather than a rule someone must remember.
 *
 * The model transcribes; the geometry is arithmetic. `closeTraverse` reports
 * the closure error, and a reading that does not close is returned as a
 * reading that does not close — never quietly straightened into a plausible
 * shape.
 *
 * Source: docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md.
 */

import type { FastifyBaseLogger } from 'fastify';

import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlatExtractionProviderAdapter } from '../../integrations/public.js';
import {
  fitPageToGround,
  outlineToGround,
  pointsToGround,
  type PageToGroundTransform,
} from '../domain/page-to-ground.js';
import { closeTraverse, type SurveyCall } from '../domain/survey-traverse.js';
import type { GardenAuthorization } from './garden-authorization.js';

export interface PlatReadingSource {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

/** How the caller supplies the rendered page: the media module owns the lookup, this use case owns the reading. */
export interface PlatPageResolver {
  /** The plan's readable page, or `null` when the plan has no rendered page yet. */
  resolvePage(gardenId: Uuid, planMediaId: Uuid): Promise<PlatReadingSource | null>;
}

export interface PlatBoundaryResult {
  readonly geometry: { readonly type: 'Polygon'; readonly coordinates: number[][][] };
  readonly closureErrorMetres: number;
  readonly closes: boolean;
  readonly areaSquareMetres: number;
  /**
   * Set when one line's direction was taken from the parcel's own closing
   * rather than from the page — see `survey-traverse.ts`'s
   * `repairSingleBearing`. Carried to review because a reviewer is entitled
   * to know which number came off the sheet and which the figure supplied.
   */
  readonly recoveredBearing: {
    /** Which boundary call, numbered from 1 as a person reads them. */
    readonly callNumber: number;
    /** How far the closing line's length is from the distance printed for that line. */
    readonly lengthDisagreementMetres: number;
  } | null;
}

/**
 * One thing the sheet draws, carried into garden metres and waiting to be
 * accepted — as the geometry ITS OWN category requires, so that accepting it
 * is an ordinary `createObject` rather than a conversion. A structure is an
 * area, a path and a fence are lines, a tree is a position.
 */
export type ProposedPlatGeometry =
  | { readonly type: 'Polygon'; readonly coordinates: number[][][] }
  | { readonly type: 'LineString'; readonly coordinates: number[][] }
  | { readonly type: 'Point'; readonly coordinates: number[] };

export interface ProposedPlatObject {
  readonly category: string;
  readonly label: string;
  readonly geometry: ProposedPlatGeometry;
  /** The model's own confidence in having seen this, `0..1`. Shown at review; decides nothing. */
  readonly confidence: number;
  /** Zero for anything that is not an area — a fence encloses nothing. */
  readonly areaSquareMetres: number;
}

export interface PlatReadingResult {
  readonly isPlat: boolean;
  readonly address: string | null;
  readonly northRotationDegrees: number | null;
  readonly statedAreaSquareFeet: number | null;
  readonly boundaryCalls: readonly SurveyCall[];
  readonly boundary: PlatBoundaryResult | null;
  /**
   * Everything else the drawing holds — the house, the deck, the drive, the
   * easement strips — in garden metres at the SURVEY's scale, because the fit
   * that carried them there was anchored on the surveyed lot.
   */
  readonly objects: readonly ProposedPlatObject[];
  /**
   * How well the lot's page outline matched its surveyed shape, in metres.
   * Every object below rides that fit, so this is the honest bound on all of
   * them; `null` when no fit was possible and nothing was carried.
   */
  readonly pageFitResidualMetres: number | null;
}

const EMPTY_READING: PlatReadingResult = {
  isPlat: false,
  address: null,
  northRotationDegrees: null,
  statedAreaSquareFeet: null,
  boundaryCalls: [],
  boundary: null,
  objects: [],
  pageFitResidualMetres: null,
};

export class ReadPlatFromPlan {
  constructor(
    private readonly adapter: PlatExtractionProviderAdapter | null,
    private readonly pages: PlatPageResolver,
    private readonly authorization: GardenAuthorization,
    private readonly callTimeoutMs: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid, planMediaId: Uuid): Promise<PlatReadingResult> {
    // `editGardenContent`, not a read capability: reading a plan is
    // preparation for editing the garden it belongs to, and the reading is
    // paid provider work no viewer should be able to spend.
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    if (this.adapter === null) {
      throw new ValidationError(
        'map.plat_reading_unavailable',
        'No plat reader is configured in this environment.',
      );
    }

    const page = await this.pages.resolvePage(gardenId, planMediaId);
    if (page === null) {
      throw new ValidationError(
        'map.plan_page_not_ready',
        'This plan has no rendered page to read yet.',
        { details: [{ pointer: '/planMediaId', code: 'map.plan_page_not_ready' }] },
      );
    }

    const outcome = await this.adapter.extractPlat(
      { page },
      AbortSignal.timeout(this.callTimeoutMs),
    );

    if (outcome.kind === 'notAPlat') {
      return EMPTY_READING;
    }
    if (outcome.kind !== 'extracted') {
      this.logger.warn(
        { event: 'map.plat_reading_unusable', outcome: outcome.kind },
        'The plat reader returned nothing usable.',
      );
      throw new ValidationError(
        'map.plat_reading_failed',
        'The plat could not be read from this page.',
      );
    }

    const calls: SurveyCall[] = outcome.plat.boundaryCalls.map((call) => ({
      bearing: call.bearing,
      distanceFeet: call.distanceFeet,
    }));
    const traverse = closeTraverse(calls);

    this.logger.info(
      {
        event: 'map.plat_read',
        callCount: calls.length,
        closes: traverse?.closes ?? false,
        closureErrorMetres: traverse?.closureErrorMetres ?? null,
        recoveredBearingCall: traverse?.repairedBearing?.callIndex ?? null,
        hasAddress: outcome.plat.address !== null,
        drawnObjectCount: outcome.plat.pageObjects.length,
      },
      'A plat was read into a reviewable boundary.',
    );

    /*
     * The lot is the ruler. Its page outline fitted onto its surveyed polygon
     * gives one similarity transform, and everything else drawn on the sheet
     * rides it — so the house lands at the survey's scale without the model
     * ever stating a dimension. No surveyed boundary, no lot outline, or a
     * traverse that does not close means nothing can be carried, and nothing
     * is: a boundary that does not close is the wrong shape, and objects
     * fitted onto a wrong shape are placed by a guess at scale, which is
     * worse than no objects at all.
     */
    const fit =
      traverse === null || !traverse.closes
        ? null
        : fitPageToGround(outcome.plat.lotPageOutline, traverse.ring);

    const objects: ProposedPlatObject[] = [];
    if (fit !== null) {
      for (const drawn of outcome.plat.pageObjects) {
        const proposal = proposeObject(drawn, fit);
        if (proposal !== null) {
          objects.push(proposal);
        }
      }
    }

    return {
      isPlat: true,
      address: outcome.plat.address,
      northRotationDegrees: outcome.plat.northRotationDegrees,
      statedAreaSquareFeet: outcome.plat.statedAreaSquareFeet,
      boundaryCalls: outcome.plat.boundaryCalls,
      objects,
      pageFitResidualMetres: fit?.residualMetres ?? null,
      boundary:
        traverse === null
          ? null
          : {
              geometry: {
                type: 'Polygon',
                coordinates: [traverse.ring.map(([x, y]) => [x, y])],
              },
              closureErrorMetres: traverse.closureErrorMetres,
              closes: traverse.closes,
              areaSquareMetres: ringArea(traverse.ring),
              recoveredBearing:
                traverse.repairedBearing === undefined
                  ? null
                  : {
                      callNumber: traverse.repairedBearing.callIndex + 1,
                      lengthDisagreementMetres: traverse.repairedBearing.lengthDisagreementMetres,
                    },
            },
    };
  }
}

/**
 * Which shape a category is, in the map's own vocabulary
 * (`geometry-contracts/object-category.ts`): an area, a line, or a position.
 * Deciding it here rather than trusting the reader means an accepted
 * proposal is always a geometry its category is allowed to hold.
 */
const GEOMETRY_KIND_BY_CATEGORY: Record<string, 'area' | 'line' | 'point'> = {
  structure: 'area',
  zone: 'area',
  waterFeature: 'area',
  utilityExclusion: 'area',
  path: 'line',
  fence: 'line',
  tree: 'point',
};

function proposeObject(
  drawn: {
    category: string;
    label: string;
    pagePoints: readonly (readonly [number, number])[];
    confidence: number;
  },
  fit: PageToGroundTransform,
): ProposedPlatObject | null {
  const kind = GEOMETRY_KIND_BY_CATEGORY[drawn.category];
  if (kind === undefined) {
    return null;
  }

  const common = { category: drawn.category, label: drawn.label, confidence: drawn.confidence };

  if (kind === 'area') {
    const ring = outlineToGround(drawn.pagePoints, fit);
    return ring === null
      ? null
      : {
          ...common,
          geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [x, y])] },
          areaSquareMetres: ringArea(ring),
        };
  }

  const carried = pointsToGround(drawn.pagePoints, fit);

  if (kind === 'line') {
    // Two points is the least a course can be; one is a reading that lost an
    // end, not a fence.
    return carried.length < 2
      ? null
      : {
          ...common,
          geometry: { type: 'LineString', coordinates: carried.map(([x, y]) => [x, y]) },
          areaSquareMetres: 0,
        };
  }

  const trunk = carried[0];
  return trunk === undefined
    ? null
    : {
        ...common,
        geometry: { type: 'Point', coordinates: [trunk[0], trunk[1]] },
        areaSquareMetres: 0,
      };
}

/** Shoelace area, so a reviewer can compare the walk against the area the sheet itself states. */
function ringArea(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0];
    const [x2, y2] = ring[index + 1] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.round((Math.abs(sum) / 2) * 100) / 100;
}
