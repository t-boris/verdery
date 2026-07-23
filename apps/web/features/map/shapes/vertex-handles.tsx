'use client';

import type { Position } from '@verdery/geometry-contracts';
import type Konva from 'konva';
import { Circle } from 'react-konva';

import { canRemoveVertexAt, editableRingOf, editableVertexIndices, edgesOf } from '../vertex-ring';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { toLocal, toScreen } from '../viewport';

export interface VertexHandlesProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly onMoveVertex: (ringIndex: number, vertexIndex: number, position: Position) => void;
  readonly onInsertVertex: (ringIndex: number, vertexIndex: number, position: Position) => void;
  readonly onRemoveVertex: (ringIndex: number, vertexIndex: number) => void;
  /** Present only for `fence`/`path` — splitting any other category is out of scope. */
  readonly onSplitAtVertex?: (vertexIndex: number) => void;
}

const VERTEX_RADIUS_PX = 6;
const MIDPOINT_RADIUS_PX = 4;
const VERTEX_STROKE = '#2563eb';
const VERTEX_FILL = '#ffffff';
const MIDPOINT_FILL = '#93c5fd';

/**
 * Per-vertex reshape handles for the vertex-edit sub-mode: a full-size
 * circle at every existing vertex (drag to move, Alt/Option-click to
 * remove, Shift-click on a `fence`/`path` vertex to split the line there),
 * and a smaller circle at every edge midpoint (click to insert a new vertex
 * there). Only `Polygon` (exterior ring) and `LineString` geometries are
 * editable this way — see `vertex-ring.ts`'s module doc comment for why
 * `MultiPolygon`/`MultiLineString`/`Point` render nothing here.
 *
 * A closed ring's first vertex never removes via Alt/Option-click
 * (`canRemoveVertexAt` refuses it) — see `isRingClosureVertex` in
 * `vertex-ring.ts`. Dragging it still works; `map-canvas.tsx`'s
 * `onMoveVertex` handler special-cases that one vertex to commit
 * `replaceGeometry` instead of `editVertex`.
 *
 * `editVertex` commands carry only an operation and indices, never a whole
 * geometry (see `command.ts`'s `EditVertexPayload`), so unlike
 * `transform-handles.tsx` there is no client-side geometry to recompute —
 * every handle here simply reports where the pointer ended up, in local
 * metres, and the server computes the resulting shape.
 */
export function VertexHandles({
  record,
  camera,
  size,
  onMoveVertex,
  onInsertVertex,
  onRemoveVertex,
  onSplitAtVertex,
}: VertexHandlesProps) {
  const ring = editableRingOf(record.geometry);
  if (ring === null) {
    return null;
  }

  const canSplit = onSplitAtVertex !== undefined;

  const handleVertexClick =
    (vertexIndex: number) => (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (event.evt.shiftKey && canSplit) {
        onSplitAtVertex?.(vertexIndex);
        return;
      }
      if (event.evt.altKey && canRemoveVertexAt(ring, vertexIndex)) {
        onRemoveVertex(ring.ringIndex, vertexIndex);
      }
    };

  const handleVertexDragEnd =
    (vertexIndex: number) => (event: Konva.KonvaEventObject<DragEvent>) => {
      const node = event.target;
      const position = toLocal({ x: node.x(), y: node.y() }, camera, size);
      onMoveVertex(ring.ringIndex, vertexIndex, position);
    };

  return (
    <>
      {edgesOf(ring).map((edge) => {
        const screen = toScreen(edge.midpoint, camera, size);
        return (
          <Circle
            key={`mid-${edge.fromIndex}`}
            x={screen.x}
            y={screen.y}
            radius={MIDPOINT_RADIUS_PX}
            fill={MIDPOINT_FILL}
            stroke={VERTEX_STROKE}
            strokeWidth={1}
            onClick={() => onInsertVertex(ring.ringIndex, edge.insertAtIndex, edge.midpoint)}
            onTap={() => onInsertVertex(ring.ringIndex, edge.insertAtIndex, edge.midpoint)}
          />
        );
      })}
      {editableVertexIndices(ring).map((vertexIndex) => {
        const position = ring.positions[vertexIndex];
        if (position === undefined) {
          return null;
        }
        const screen = toScreen(position, camera, size);
        return (
          <Circle
            key={`vertex-${vertexIndex}`}
            x={screen.x}
            y={screen.y}
            radius={VERTEX_RADIUS_PX}
            fill={VERTEX_FILL}
            stroke={VERTEX_STROKE}
            strokeWidth={2}
            draggable
            onDragEnd={handleVertexDragEnd(vertexIndex)}
            onClick={handleVertexClick(vertexIndex)}
            onTap={handleVertexClick(vertexIndex)}
          />
        );
      })}
    </>
  );
}
