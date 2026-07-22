import { Line, Text } from 'react-konva';

import { SELECTION_STROKE, styleForCategory } from '../category-style';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { labelAnchor, positionsOf, ringToPoints, ringsOf } from './shape-geometry';

export interface PolygonShapeProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly selected: boolean;
}

/**
 * Polygon and MultiPolygon categories (lot, structure, zone, bed,
 * waterFeature, utilityExclusion, importedBackground).
 *
 * Only the exterior ring (index 0 of each polygon) is filled. A ring beyond
 * the first is a hole, and Konva's `Line` cannot punch a hole out of a sibling
 * shape without a compound `Konva.Path` — out of scope this pass, so a hole
 * still renders as its own unfilled dashed outline, which is honest about the
 * ring's presence without pretending to render a true hole.
 */
export function PolygonShape({ record, camera, size, selected }: PolygonShapeProps) {
  if (record.geometry.type !== 'Polygon' && record.geometry.type !== 'MultiPolygon') {
    return null;
  }

  const style = styleForCategory(record.category);
  const rings = ringsOf(record.geometry);
  const anchor = labelAnchor(positionsOf(record.geometry), camera, size);

  return (
    <>
      {rings.map((ring, index) => {
        // `exactOptionalPropertyTypes` forbids passing `fill`/`dash` as
        // explicit `undefined` even though Konva's own config types mark
        // them optional — conditionally spreading the key omits it entirely
        // instead of setting it to `undefined`.
        const isExterior = index === 0;
        const fillProp = isExterior && style.fill !== 'transparent' ? { fill: style.fill } : {};
        const dashProp = isExterior
          ? style.dash === undefined
            ? {}
            : { dash: [...style.dash] }
          : { dash: [4, 4] };

        return (
          <Line
            key={index}
            points={ringToPoints(ring, camera, size)}
            closed
            stroke={selected ? SELECTION_STROKE : style.stroke}
            strokeWidth={selected ? 3 : 1.5}
            {...fillProp}
            {...dashProp}
          />
        );
      })}
      <Text
        text={style.glyph}
        x={anchor.x}
        y={anchor.y}
        fontSize={11}
        fontStyle="bold"
        fill={style.stroke}
        offsetX={(style.glyph.length * 11) / 3.2}
        offsetY={5.5}
        listening={false}
      />
    </>
  );
}
