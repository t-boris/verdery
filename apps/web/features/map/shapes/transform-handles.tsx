'use client';

import {
  positionsOf,
  roundGeometry,
  type Geometry,
  type Position,
} from '@verdery/geometry-contracts';
import type Konva from 'konva';
import { Circle, Line } from 'react-konva';

import {
  angleBetween,
  boundingBoxCentroid,
  cornerScaleFactor,
  rotateGeometry,
  scaleGeometry,
} from '../geometry-transform';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { boundingBoxOfPositions, toLocal, toScreen, type ScreenPoint } from '../viewport';

export interface TransformHandlesProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly onReplaceGeometry: (geometry: Geometry) => void;
}

const HANDLE_RADIUS_PX = 6;
const ROTATE_HANDLE_OFFSET_PX = 28;
const HANDLE_STROKE = '#2563eb';
const HANDLE_FILL = '#ffffff';

interface Corner {
  readonly xKey: 'minX' | 'maxX';
  readonly yKey: 'minY' | 'maxY';
}

const CORNERS: readonly Corner[] = [
  { xKey: 'minX', yKey: 'minY' },
  { xKey: 'maxX', yKey: 'minY' },
  { xKey: 'maxX', yKey: 'maxY' },
  { xKey: 'minX', yKey: 'maxY' },
];

/** The pointer's current local-metres position, or `null` when the drag ends outside the stage. */
function pointerLocalFromEvent(
  event: Konva.KonvaEventObject<DragEvent>,
  camera: MapCamera,
  size: CanvasSize,
): Position | null {
  const stage = event.target.getStage();
  const pointer = stage?.getPointerPosition();
  return pointer === null || pointer === undefined ? null : toLocal(pointer, camera, size);
}

/**
 * Whole-shape resize (corner handles, independent x/y scale around the
 * bounding-box center) and rotate (a handle above the shape) for `Polygon`
 * objects. Both gestures commit once, on release, as `replaceGeometry` — see
 * `geometry-transform.ts`'s module doc comment for why a single command
 * covers both.
 *
 * Every handle renders at the object's *original* (pre-drag) position for
 * the whole gesture, and every drag computation is solved directly from
 * that fixed original reference against the pointer's current absolute
 * position — never incrementally from the previous frame — so no per-frame
 * local "live geometry" state is needed; only the position on release
 * matters. This means the connecting guide line and the other three corners
 * do not visually track a resize or rotation in progress, only the handle
 * actually being dragged (which Konva already moves natively) — a
 * deliberate scope cut against a fully live preview outline, given `command.ts`'s
 * own framing that only the *committed* shape is domain-meaningful.
 * `onDragEnd` explicitly resets the dragged node back to its original
 * screen position regardless of outcome, the same `resetPosition` pattern
 * `shapes/object-shape.tsx` uses for a whole-object move: on success the
 * object's geometry — and this component's handle positions, derived from
 * it — updates from the server response on the next render; on failure
 * nothing else would ever reset it.
 */
export function TransformHandles({
  record,
  camera,
  size,
  onReplaceGeometry,
}: TransformHandlesProps) {
  if (record.geometry.type !== 'Polygon') {
    return null;
  }
  const geometry = record.geometry;

  const positions = positionsOf(geometry);
  const box = boundingBoxOfPositions(positions);
  const centroid = boundingBoxCentroid(positions);
  if (box === null || centroid === null) {
    return null;
  }

  const topCenterLocal: Position = [(box.minX + box.maxX) / 2, box.maxY];
  const rotateHandleLocal: Position = [
    topCenterLocal[0],
    topCenterLocal[1] + ROTATE_HANDLE_OFFSET_PX / camera.scale,
  ];
  const topCenterScreen = toScreen(topCenterLocal, camera, size);
  const rotateHandleScreen = toScreen(rotateHandleLocal, camera, size);

  const commitScale = (corner: Corner, pointerLocal: Position) => {
    const scaleX = cornerScaleFactor(centroid[0], box[corner.xKey], pointerLocal[0]);
    const scaleY = cornerScaleFactor(centroid[1], box[corner.yKey], pointerLocal[1]);
    onReplaceGeometry(roundGeometry(scaleGeometry(geometry, centroid, scaleX, scaleY)));
  };

  const commitRotate = (pointerLocal: Position) => {
    const angle = angleBetween(centroid, rotateHandleLocal, pointerLocal);
    onReplaceGeometry(roundGeometry(rotateGeometry(geometry, centroid, angle)));
  };

  const resetTo = (event: Konva.KonvaEventObject<DragEvent>, screen: ScreenPoint) => {
    event.target.position({ x: screen.x, y: screen.y });
    event.target.getLayer()?.batchDraw();
  };

  return (
    <>
      <Line
        points={[topCenterScreen.x, topCenterScreen.y, rotateHandleScreen.x, rotateHandleScreen.y]}
        stroke={HANDLE_STROKE}
        strokeWidth={1}
        dash={[3, 3]}
        listening={false}
      />
      {CORNERS.map((corner) => {
        const local: Position = [box[corner.xKey], box[corner.yKey]];
        const screen = toScreen(local, camera, size);
        return (
          <Circle
            key={`${corner.xKey}-${corner.yKey}`}
            x={screen.x}
            y={screen.y}
            radius={HANDLE_RADIUS_PX}
            fill={HANDLE_FILL}
            stroke={HANDLE_STROKE}
            strokeWidth={2}
            draggable
            onDragEnd={(event) => {
              const pointerLocal = pointerLocalFromEvent(event, camera, size);
              resetTo(event, screen);
              if (pointerLocal !== null) {
                commitScale(corner, pointerLocal);
              }
            }}
          />
        );
      })}
      <Circle
        x={rotateHandleScreen.x}
        y={rotateHandleScreen.y}
        radius={HANDLE_RADIUS_PX}
        fill={HANDLE_STROKE}
        stroke={HANDLE_FILL}
        strokeWidth={2}
        draggable
        onDragEnd={(event) => {
          const pointerLocal = pointerLocalFromEvent(event, camera, size);
          resetTo(event, rotateHandleScreen);
          if (pointerLocal !== null) {
            commitRotate(pointerLocal);
          }
        }}
      />
    </>
  );
}
