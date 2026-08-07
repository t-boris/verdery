import type { PolygonGeometry, Position } from '@verdery/geometry-contracts';

import type { CreatableCategory } from './types';

const CIRCLE_VERTEX_COUNT = 16;
const DEFAULT_RADIUS_METRES: Readonly<Record<'tree' | 'plant', number>> = {
  tree: 1.5,
  plant: 0.35,
};

/**
 * A one-click plant/tree placement is still a real editable area.
 *
 * Sixteen vertices look circular at garden-map scale while remaining normal
 * polygon geometry: move, resize, and individual-edge editing need no special
 * circle-only command or storage format.
 */
export function defaultLivingAreaGeometry(
  category: Extract<CreatableCategory, 'tree' | 'plant'>,
  center: Position,
): PolygonGeometry {
  const radius = DEFAULT_RADIUS_METRES[category];
  const ring: Position[] = Array.from({ length: CIRCLE_VERTEX_COUNT }, (_, index) => {
    const angle = (index / CIRCLE_VERTEX_COUNT) * Math.PI * 2;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
  const first = ring[0] as Position;
  return { type: 'Polygon', coordinates: [[...ring, first]] };
}
