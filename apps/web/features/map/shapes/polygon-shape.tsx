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
            strokeWidth={selected ? 4 : 2.5}
            shadowColor="#000000"
            shadowBlur={1}
            shadowOpacity={0.55}
            {...fillProp}
            {...dashProp}
            /*
             * The outline is grabbable, not just the fill. A dashed, 15 %-alpha
             * underlay reads as "not really there", and a drag that misses it
             * pans the stage instead — which looks like the object moving
             * together with the aerial backdrop, because everything moves
             * (reported 2026-08-06 for an imported plan). Twelve pixels is one
             * fingertip either side of the line.
             */
            hitStrokeWidth={12}
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
        shadowColor="#000000"
        shadowBlur={2}
        shadowOpacity={0.8}
        offsetX={(style.glyph.length * 11) / 3.2}
        offsetY={5.5}
        listening={false}
      />
    </>
  );
}
