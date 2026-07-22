import type { Position } from '@verdery/geometry-contracts';
import { Circle, Line } from 'react-konva';

import { DRAFT_STROKE } from '../category-style';
import type { CanvasSize, MapCamera } from '../types';
import { toScreen } from '../viewport';

export interface DraftPreviewShapeProps {
  readonly points: readonly Position[];
  /** Current pointer position in local metres, or `null` when the pointer is outside the stage. */
  readonly pointer: Position | null;
  readonly kind: 'polygon' | 'line';
  readonly camera: MapCamera;
  readonly size: CanvasSize;
}

/**
 * The in-progress shape while a `create:*` tool is drawing: placed vertices,
 * a "rubber band" segment to the pointer, and — for a polygon draft — a
 * dashed closing segment back to the first vertex.
 *
 * This is the gesture-preview layer section "8. Gesture Lifecycle" describes
 * ("preview movement at frame rate... only committed commands enter durable
 * state"): nothing here is a domain command until the toolbar's "Finish
 * shape" action builds one from `points`.
 */
export function DraftPreviewShape({ points, pointer, kind, camera, size }: DraftPreviewShapeProps) {
  if (points.length === 0) {
    return null;
  }

  const screenPoints = points.map((point) => toScreen(point, camera, size));
  const rubberBand = pointer === null ? [] : [toScreen(pointer, camera, size)];
  const flat = [...screenPoints, ...rubberBand].flatMap((point) => [point.x, point.y]);

  const closing =
    kind === 'polygon' && screenPoints.length >= 2
      ? [
          screenPoints[screenPoints.length - 1]?.x ?? 0,
          screenPoints[screenPoints.length - 1]?.y ?? 0,
          screenPoints[0]?.x ?? 0,
          screenPoints[0]?.y ?? 0,
        ]
      : null;

  return (
    <>
      <Line points={flat} stroke={DRAFT_STROKE} strokeWidth={2} dash={[6, 4]} listening={false} />
      {closing !== null && (
        <Line
          points={closing}
          stroke={DRAFT_STROKE}
          strokeWidth={1}
          dash={[2, 4]}
          listening={false}
        />
      )}
      {screenPoints.map((point, index) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={4}
          fill="#ffffff"
          stroke={DRAFT_STROKE}
          strokeWidth={2}
          listening={false}
        />
      ))}
    </>
  );
}
