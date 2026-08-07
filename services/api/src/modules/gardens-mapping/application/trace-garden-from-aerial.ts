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
import type { MapObjectRepository } from './map-object-repository.js';

export interface AerialTracingProposal {
  readonly category: AerialTraceCategory;
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
  'The saved lot comes from the aligned survey; aerial objects are approximate AI planning proposals inside it.';

export class TraceGardenFromAerial {
  constructor(
    private readonly adapter: AerialTracingProviderAdapter | null,
    private readonly mapObjects: MapObjectRepository,
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

    const lots = (await this.mapObjects.listForGarden(gardenId, null)).filter(
      (object) =>
        object.lifecycleState === 'active' &&
        object.category === 'lot' &&
        object.geometry.type === 'Polygon',
    );
    if (lots.length !== 1) {
      throw new ValidationError(
        'map.aerial_tracing_needs_lot',
        'Align and save exactly one lot from the plat before detecting aerial objects.',
      );
    }
    const lot = lots[0]!;
    const localBoundary =
      lot.geometry.type === 'Polygon' ? (lot.geometry.coordinates[0] ?? []) : [];
    const uniqueBoundary = withoutRepeatedClosure(localBoundary);
    const localCenter = boundingBoxCenter(uniqueBoundary);
    const imageCenter = localToGeographic(localCenter, georeference);
    const lotImagePoints = uniqueBoundary.map((point) =>
      geographicPointToImage(localToGeographic(point, georeference), imageCenter),
    );
    if (lotImagePoints.some(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1)) {
      throw new ValidationError(
        'map.aerial_tracing_lot_too_large',
        'The saved lot does not fit within the supported aerial tracing image.',
      );
    }

    const outcome = await this.adapter.traceSite(
      {
        geographicCenter: imageCenter,
        displayAddress: georeference.displayAddress,
        lotBoundaryImagePoints: lotImagePoints,
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
    for (const object of outcome.site.objects) {
      if (!object.imagePoints.every((point) => pointInsideLot(point, lotImagePoints))) {
        continue;
      }
      const geometry = geometryFor(object.category, object.imagePoints, imageCenter, georeference);
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
  category: AerialTraceCategory,
  imagePoints: readonly Position[],
  imageCenter: Position,
  georeference: Georeference,
): Geometry | null {
  const points = imagePoints
    .filter(
      ([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1,
    )
    .map((point) => imagePointToLocal(point, imageCenter, georeference));

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

function imagePointToLocal(
  point: Position,
  imageCenter: Position,
  georeference: Georeference,
): Position {
  const east = (point[0] - 0.5) * AERIAL_TRACE_SPAN_METRES;
  const north = (0.5 - point[1]) * AERIAL_TRACE_SPAN_METRES;
  const longitude = imageCenter[0] + east / metresPerDegreeLongitude(imageCenter[1]);
  const latitude = imageCenter[1] + north / METRES_PER_DEGREE_LATITUDE;
  return geographicToLocal([longitude, latitude], georeference);
}

const METRES_PER_DEGREE_LATITUDE = 111_320;
const RADIANS_PER_DEGREE = Math.PI / 180;

function metresPerDegreeLongitude(latitude: number): number {
  return METRES_PER_DEGREE_LATITUDE * Math.cos(latitude * RADIANS_PER_DEGREE);
}

function geographicPointToImage(point: Position, center: Position): Position {
  const east = (point[0] - center[0]) * metresPerDegreeLongitude(center[1]);
  const north = (point[1] - center[1]) * METRES_PER_DEGREE_LATITUDE;
  return [0.5 + east / AERIAL_TRACE_SPAN_METRES, 0.5 - north / AERIAL_TRACE_SPAN_METRES];
}

function geographicToLocal(point: Position, georeference: Georeference): Position {
  const east =
    (point[0] - georeference.geographicAnchor[0]) *
    metresPerDegreeLongitude(georeference.geographicAnchor[1]);
  const north = (point[1] - georeference.geographicAnchor[1]) * METRES_PER_DEGREE_LATITUDE;
  const radians = (-georeference.rotationDegrees * Math.PI) / 180;
  return [
    georeference.localAnchor[0] +
      (east * Math.cos(radians) - north * Math.sin(radians)) / georeference.scaleCorrection,
    georeference.localAnchor[1] +
      (east * Math.sin(radians) + north * Math.cos(radians)) / georeference.scaleCorrection,
  ];
}

function localToGeographic(point: Position, georeference: Georeference): Position {
  const x = (point[0] - georeference.localAnchor[0]) * georeference.scaleCorrection;
  const y = (point[1] - georeference.localAnchor[1]) * georeference.scaleCorrection;
  const radians = (georeference.rotationDegrees * Math.PI) / 180;
  const east = x * Math.cos(radians) - y * Math.sin(radians);
  const north = x * Math.sin(radians) + y * Math.cos(radians);
  return [
    georeference.geographicAnchor[0] +
      east / metresPerDegreeLongitude(georeference.geographicAnchor[1]),
    georeference.geographicAnchor[1] + north / METRES_PER_DEGREE_LATITUDE,
  ];
}

function withoutRepeatedClosure(points: readonly Position[]): readonly Position[] {
  const first = points[0];
  const last = points.at(-1);
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
    ? points.slice(0, -1)
    : points;
}

function boundingBoxCenter(points: readonly Position[]): Position {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function pointInsideLot(point: Position, polygon: readonly Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (currentPoint === undefined || previousPoint === undefined) continue;
    const [x, y] = currentPoint;
    const [previousX, previousY] = previousPoint;
    const crosses =
      y > point[1] !== previousY > point[1] &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}
