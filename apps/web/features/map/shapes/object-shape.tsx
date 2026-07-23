'use client';

import type Konva from 'konva';
import { Group } from 'react-konva';

import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { screenDeltaToLocalDelta } from '../viewport';
import { LineShape } from './line-shape';
import { PointShape } from './point-shape';
import { PolygonShape } from './polygon-shape';

export interface ObjectShapeProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly selected: boolean;
  readonly draggable: boolean;
  readonly onSelect: (objectId: string) => void;
  /**
   * Called once, on drag end, with the translation already converted to
   * local metres — never per frame, matching "Pointer or touch movement does
   * not produce a server mutation per frame" (design principle 2).
   * `resetPosition` snaps the dragged node back to its last confirmed
   * position; the caller invokes it if the resulting `moveObject` command
   * fails, so a rejected move does not leave the shape visually
   * out of sync with the server.
   */
  readonly onMoveEnd: (
    objectId: string,
    dxMetres: number,
    dyMetres: number,
    resetPosition: () => void,
  ) => void;
}

/**
 * One garden object on the Konva stage: a `Group` that owns selection and
 * drag-to-move, wrapping whichever shape component matches the object's
 * geometry type. Every category renders through here — creation is limited
 * to every category but `importedBackground` (see `types.ts`), but
 * rendering, selection, and moving are not.
 */
export function ObjectShape({
  record,
  camera,
  size,
  selected,
  draggable,
  onSelect,
  onMoveEnd,
}: ObjectShapeProps) {
  const handleDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
    const node = event.target;
    const { dx, dy } = screenDeltaToLocalDelta(node.x(), node.y(), camera);
    onMoveEnd(record.id, dx, dy, () => {
      node.position({ x: 0, y: 0 });
      node.getLayer()?.batchDraw();
    });
  };

  return (
    <Group
      x={0}
      y={0}
      draggable={draggable}
      onClick={() => onSelect(record.id)}
      onTap={() => onSelect(record.id)}
      onDragEnd={handleDragEnd}
    >
      <PolygonShape record={record} camera={camera} size={size} selected={selected} />
      <LineShape record={record} camera={camera} size={size} selected={selected} />
      <PointShape record={record} camera={camera} size={size} selected={selected} />
    </Group>
  );
}
