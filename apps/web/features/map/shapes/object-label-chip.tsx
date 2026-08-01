'use client';

import { Group, Rect, Text } from 'react-konva';

import { boundingBoxOfPositions, toScreen } from '../viewport';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { ringsOf } from './shape-geometry';

const CHIP_HEIGHT = 16;
const CHIP_PADDING_X = 5;
/** Gap between the chip's baseline and the shape's top edge. */
const CHIP_OFFSET = 6;
const CHIP_FONT_SIZE = 10;
/** Matches `--font-family-mono`'s first entry; Konva needs a literal family name. */
const CHIP_FONT = 'IBM Plex Mono, ui-monospace, monospace';

export interface ObjectLabelChipProps {
  readonly record: MapObjectRecord;
  /** The same number the object index prints — see `map-object-ordinals.ts`. */
  readonly text: string;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly fill: string;
  readonly textColor: string;
}

/**
 * The object's ordinal, as a solid ink chip sitting ABOVE the shape's top
 * edge rather than inside it.
 *
 * Above, not inside, for two reasons the direction names: a chip inside a
 * small shape either overflows it or is clipped by it, and ink-on-shape has
 * no contrast guarantee at all — the shape's own fill is category-coloured
 * and user-influenced, whereas the chip paints its own background and so can
 * guarantee its own contrast.
 *
 * The chip prints the ORDINAL, not the object's name. It is a handle for
 * matching a shape to its row in the object index, and a name would neither
 * fit at 10px nor stay legible at low zoom. `map-canvas.tsx` keeps the
 * accessible object list as the real naming surface.
 *
 * `listening={false}`: the chip must never swallow a click meant for the
 * shape it labels.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 3 ("Canvas").
 */
export function ObjectLabelChip({
  record,
  text,
  camera,
  size,
  fill,
  textColor,
}: ObjectLabelChipProps) {
  const positions = ringsOf(record.geometry).flat();
  const box = boundingBoxOfPositions(positions);
  if (box === null) {
    return null;
  }

  // The top edge in LOCAL metres is `maxY`: the screen projection flips the
  // axis, so the largest local Y is the smallest screen Y.
  const anchor = toScreen([(box.minX + box.maxX) / 2, box.maxY], camera, size);
  const width = text.length * (CHIP_FONT_SIZE * 0.62) + CHIP_PADDING_X * 2;
  const x = anchor.x - width / 2;
  const y = anchor.y - CHIP_HEIGHT - CHIP_OFFSET;

  return (
    <Group listening={false}>
      <Rect x={x} y={y} width={width} height={CHIP_HEIGHT} fill={fill} />
      <Text
        x={x}
        y={y}
        width={width}
        height={CHIP_HEIGHT}
        text={text}
        fontSize={CHIP_FONT_SIZE}
        fontFamily={CHIP_FONT}
        fontStyle="600"
        fill={textColor}
        align="center"
        verticalAlign="middle"
      />
    </Group>
  );
}
