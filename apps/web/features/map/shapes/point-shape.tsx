import { Circle, Text } from 'react-konva';

import { SELECTION_STROKE, styleForCategory } from '../category-style';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { toScreen } from '../viewport';

export interface PointShapeProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly selected: boolean;
}

/** Point categories (tree, plant, and any other category whose geometry happens to be a `Point`). */
export function PointShape({ record, camera, size, selected }: PointShapeProps) {
  if (record.geometry.type !== 'Point') {
    return null;
  }

  const style = styleForCategory(record.category);
  const screen = toScreen(record.geometry.coordinates, camera, size);
  const radiusPx = Math.max(style.pointRadiusMetres * camera.scale, 6);

  return (
    <>
      <Circle
        x={screen.x}
        y={screen.y}
        radius={radiusPx}
        fill={style.fill}
        stroke={selected ? SELECTION_STROKE : style.stroke}
        strokeWidth={selected ? 3 : 1.5}
      />
      <Text
        text={style.glyph}
        x={screen.x}
        y={screen.y}
        fontSize={Math.min(radiusPx, 11)}
        fontStyle="bold"
        fill="#ffffff"
        offsetX={(style.glyph.length * Math.min(radiusPx, 11)) / 3.2}
        offsetY={Math.min(radiusPx, 11) / 2}
        listening={false}
      />
    </>
  );
}
