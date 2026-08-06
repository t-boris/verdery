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
import { fitPageToGround, outlineToGround } from '../domain/page-to-ground.js';
import { closeTraverse, type SurveyCall } from '../domain/survey-traverse.js';

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
}

/** One thing the sheet draws, carried into garden metres and waiting to be accepted. */
export interface ProposedPlatObject {
  readonly category: string;
  readonly label: string;
  readonly geometry: { readonly type: 'Polygon'; readonly coordinates: number[][][] };
  /** The model's own confidence in having seen this, `0..1`. Shown at review; decides nothing. */
  readonly confidence: number;
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
    private readonly callTimeoutMs: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(gardenId: Uuid, planMediaId: Uuid): Promise<PlatReadingResult> {
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
        hasAddress: outcome.plat.address !== null,
        drawnObjectCount: outcome.plat.pageObjects.length,
      },
      'A plat was read into a reviewable boundary.',
    );

    /*
     * The lot is the ruler. Its page outline fitted onto its surveyed polygon
     * gives one similarity transform, and every other outline rides it — so
     * the house lands at the survey's scale without the model ever stating a
     * dimension. No surveyed boundary, or no lot outline, means nothing can
     * be carried, and nothing is: an object placed by a guess at scale would
     * be worse than none.
     */
    const fit =
      traverse === null ? null : fitPageToGround(outcome.plat.lotPageOutline, traverse.ring);

    const objects: ProposedPlatObject[] = [];
    if (fit !== null) {
      for (const drawn of outcome.plat.pageObjects) {
        const ring = outlineToGround(drawn.pageOutline, fit);
        if (ring === null) {
          continue;
        }
        objects.push({
          category: drawn.category,
          label: drawn.label,
          geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [x, y])] },
          confidence: drawn.confidence,
          areaSquareMetres: ringArea(ring),
        });
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
            },
    };
  }
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
