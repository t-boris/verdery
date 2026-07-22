import { Line, Text } from 'react-konva';

import { SELECTION_STROKE, styleForCategory } from '../category-style';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { labelAnchor, positionsOf, ringToPoints, ringsOf } from './shape-geometry';

export interface LineShapeProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly selected: boolean;
}

/**
 * LineString and MultiLineString categories (fence, path, and a `gate` whose
 * geometry is a short segment along its fence rather than a single point —
 * `gate`'s `GateDetails.fenceObjectId` records which fence it belongs to, but
 * this component renders purely from `record.geometry`; drawing gate marks
 * relative to the referenced fence's own direction is not attempted this pass).
 */
export function LineShape({ record, camera, size, selected }: LineShapeProps) {
  if (record.geometry.type !== 'LineString' && record.geometry.type !== 'MultiLineString') {
    return null;
  }

  const style = styleForCategory(record.category);
  const rings = ringsOf(record.geometry);
  const anchor = labelAnchor(positionsOf(record.geometry), camera, size);
  // `exactOptionalPropertyTypes` forbids `dash={undefined}` — see the same
  // comment in `polygon-shape.tsx`.
  const dashProp = style.dash === undefined ? {} : { dash: [...style.dash] };

  return (
    <>
      {rings.map((line, index) => (
        <Line
          key={index}
          points={ringToPoints(line, camera, size)}
          stroke={selected ? SELECTION_STROKE : style.stroke}
          strokeWidth={selected ? 3 : 2}
          lineCap="round"
          {...dashProp}
        />
      ))}
      <Text
        text={style.glyph}
        x={anchor.x}
        y={anchor.y}
        fontSize={10}
        fontStyle="bold"
        fill={style.stroke}
        offsetX={(style.glyph.length * 10) / 3.2}
        offsetY={13}
        listening={false}
      />
    </>
  );
}
