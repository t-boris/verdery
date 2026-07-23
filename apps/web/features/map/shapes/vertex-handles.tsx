'use client';

import { SNAP_TOLERANCE_SCREEN_PIXELS, type Position } from '@verdery/geometry-contracts';
import type Konva from 'konva';
import { useState } from 'react';
import { Circle } from 'react-konva';

import { SNAP_INDICATOR_STROKE } from '../category-style';
import { snapPosition, type SnapContext, type SnapResult } from '../snapping';
import {
  canRemoveVertexAt,
  editableRingOf,
  editableVertexIndices,
  edgesOf,
  referenceVertexFor,
} from '../vertex-ring';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { toLocal, toScreen } from '../viewport';

export interface VertexHandlesProps {
  readonly record: MapObjectRecord;
  /** Every object in the garden, including `record` itself — the source of vertex/edge snap targets (`snapping.ts`). */
  readonly records: readonly MapObjectRecord[];
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
const SNAP_INDICATOR_RADIUS_PX = 9;
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
 *
 * Dragging a vertex runs it through `snapping.ts#snapPosition` before either
 * reporting it live (`onDragMove`, for the on-canvas indicator) or committing
 * it (`onDragEnd`, via `onMoveVertex`) — see the module doc comment there for
 * the full target list and precedence. The dragged vertex itself is excluded
 * from the vertex/edge candidates so it cannot snap to its own un-moved
 * position; `vertex-ring.ts#referenceVertexFor` picks the ring-neighbor the
 * three direction/distance snaps measure from. Holding the platform Cmd/Meta
 * key (`metaKey`/`ctrlKey`) while dragging suppresses snapping for that one
 * drag — Alt and Shift already remove/split a vertex on this same handle, so
 * reusing either would collide; Cmd/Meta has no existing meaning here.
 */
export function VertexHandles({
  record,
  records,
  camera,
  size,
  onMoveVertex,
  onInsertVertex,
  onRemoveVertex,
  onSplitAtVertex,
}: VertexHandlesProps) {
  const [activeSnap, setActiveSnap] = useState<SnapResult | null>(null);

  const ring = editableRingOf(record.geometry);
  if (ring === null) {
    return null;
  }

  const canSplit = onSplitAtVertex !== undefined;
  const toleranceMetres = SNAP_TOLERANCE_SCREEN_PIXELS / camera.scale;

  const snapContextFor = (
    vertexIndex: number,
    nativeEvent: { metaKey: boolean; ctrlKey: boolean },
  ): SnapContext => ({
    objects: records,
    excludeVertex: { objectId: record.id, ringIndex: ring.ringIndex, vertexIndex },
    referencePoint: referenceVertexFor(ring, vertexIndex),
    toleranceMetres,
    disabled: nativeEvent.metaKey || nativeEvent.ctrlKey,
  });

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

  // Live preview: continuously re-snaps the dragged node to its screen
  // position as the gesture moves, so the visual indicator (and the handle
  // itself) shows where the drop will land before the user releases.
  const handleVertexDragMove =
    (vertexIndex: number) => (event: Konva.KonvaEventObject<DragEvent>) => {
      const node = event.target;
      const raw = toLocal({ x: node.x(), y: node.y() }, camera, size);
      const { position, snap } = snapPosition(raw, snapContextFor(vertexIndex, event.evt));
      const screen = toScreen(position, camera, size);
      node.position({ x: screen.x, y: screen.y });
      setActiveSnap(snap);
    };

  const handleVertexDragEnd =
    (vertexIndex: number) => (event: Konva.KonvaEventObject<DragEvent>) => {
      const node = event.target;
      const raw = toLocal({ x: node.x(), y: node.y() }, camera, size);
      const { position } = snapPosition(raw, snapContextFor(vertexIndex, event.evt));
      setActiveSnap(null);
      onMoveVertex(ring.ringIndex, vertexIndex, position);
    };

  const snapIndicator = activeSnap === null ? null : toScreen(activeSnap.position, camera, size);

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
            onDragMove={handleVertexDragMove(vertexIndex)}
            onDragEnd={handleVertexDragEnd(vertexIndex)}
            onClick={handleVertexClick(vertexIndex)}
            onTap={handleVertexClick(vertexIndex)}
          />
        );
      })}
      {snapIndicator !== null && (
        <Circle
          x={snapIndicator.x}
          y={snapIndicator.y}
          radius={SNAP_INDICATOR_RADIUS_PX}
          stroke={SNAP_INDICATOR_STROKE}
          strokeWidth={2}
          fill="transparent"
          listening={false}
        />
      )}
    </>
  );
}
