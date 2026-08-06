/**
 * Turns a provider's north-up, image-normalized site traces into reviewable
 * garden-local geometry. This use case writes nothing: the web client lets a
 * person accept each proposal through ordinary map commands.
 */

import type { Geometry, Position } from '@verdery/geometry-contracts';
import type { FastifyBaseLogger } from 'fastify';

import {
  AERIAL_TRACE_SPAN_METRES,
  type AerialTraceCategory,
  type AerialTraceEvidence,
  type AerialTracingProviderAdapter,
} from '../../integrations/public.js';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { Georeference, GeoreferenceReader } from './georeference-repository.js';

export interface AerialTracingProposal {
  readonly category: AerialTraceCategory | 'lot';
  readonly label: string;
  readonly geometry: Geometry;
  readonly confidence: number;
  readonly evidence: AerialTraceEvidence;
}

export interface AerialTracingResult {
  readonly source: 'usgsNaip';
  readonly proposals: readonly AerialTracingProposal[];
  readonly disclaimer: string;
}

const DISCLAIMER =
  'AI traces from aerial imagery are approximate planning proposals, not surveyed boundaries.';

export class TraceGardenFromAerial {
  constructor(
    private readonly adapter: AerialTracingProviderAdapter | null,
    private readonly georeferences: GeoreferenceReader,
    private readonly authorization: GardenAuthorization,
    private readonly callTimeoutMs: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<AerialTracingResult> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');
    if (this.adapter === null) {
      throw new ValidationError(
        'map.aerial_tracing_unavailable',
        'Aerial tracing is not configured in this environment.',
      );
    }
    const georeference = await this.georeferences.findCurrentForGarden(gardenId);
    if (georeference === null) {
      throw new ValidationError(
        'map.aerial_tracing_needs_location',
        'Save a garden location before tracing aerial imagery.',
      );
    }

    const outcome = await this.adapter.traceSite(
      {
        geographicCenter: georeference.geographicAnchor,
        displayAddress: georeference.displayAddress,
      },
      AbortSignal.timeout(this.callTimeoutMs),
    );
    if (outcome.kind !== 'extracted') {
      this.logger.warn(
        { event: 'map.aerial_tracing_unusable', outcome: outcome.kind, gardenId },
        'The aerial tracer returned no reviewable site.',
      );
      throw new ValidationError(
        'map.aerial_tracing_failed',
        'The property could not be traced from aerial imagery.',
      );
    }

    const proposals: AerialTracingProposal[] = [];
    if (outcome.site.lot !== null) {
      const geometry = geometryFor('lot', outcome.site.lot.imagePoints, georeference);
      if (geometry !== null) {
        proposals.push({
          category: 'lot',
          label: 'Property lot',
          geometry,
          confidence: outcome.site.lot.confidence,
          evidence: outcome.site.lot.evidence,
        });
      }
    }
    for (const object of outcome.site.objects) {
      const geometry = geometryFor(object.category, object.imagePoints, georeference);
      if (geometry !== null) {
        proposals.push({ ...object, geometry });
      }
    }

    this.logger.info(
      {
        event: 'map.aerial_traced',
        gardenId,
        proposalCount: proposals.length,
        categories: proposals.map((proposal) => proposal.category),
      },
      'Aerial imagery was traced into reviewable map proposals.',
    );
    return { source: 'usgsNaip', proposals, disclaimer: DISCLAIMER };
  }
}

function geometryFor(
  category: AerialTraceCategory | 'lot',
  imagePoints: readonly Position[],
  georeference: Georeference,
): Geometry | null {
  const points = imagePoints
    .filter(
      ([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1,
    )
    .map((point) => imagePointToLocal(point, georeference));

  if (category === 'tree') {
    return points[0] === undefined ? null : { type: 'Point', coordinates: points[0] };
  }
  if (category === 'path' || category === 'fence') {
    return points.length < 2 ? null : { type: 'LineString', coordinates: points };
  }
  if (points.length < 3) {
    return null;
  }
  return { type: 'Polygon', coordinates: [[...points, points[0]!]] };
}

function imagePointToLocal(point: Position, georeference: Georeference): Position {
  const east = (point[0] - 0.5) * AERIAL_TRACE_SPAN_METRES;
  const north = (0.5 - point[1]) * AERIAL_TRACE_SPAN_METRES;
  const radians = (-georeference.rotationDegrees * Math.PI) / 180;
  const localX =
    (east * Math.cos(radians) - north * Math.sin(radians)) / georeference.scaleCorrection;
  const localY =
    (east * Math.sin(radians) + north * Math.cos(radians)) / georeference.scaleCorrection;
  return [georeference.localAnchor[0] + localX, georeference.localAnchor[1] + localY];
}
