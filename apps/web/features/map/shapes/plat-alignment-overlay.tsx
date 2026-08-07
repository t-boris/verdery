import type { PlatReading } from '@verdery/api-contracts';
import type { Geometry } from '@verdery/geometry-contracts';
import { Circle, Group, Line } from 'react-konva';

import type { PlatAlignmentDraft } from '../plat-alignment';
import { alignedPlatReading, editorGeometryOf } from '../plat-alignment';
import type { CanvasSize, MapCamera } from '../types';
import { screenDeltaToLocalDelta, toScreen } from '../viewport';
import { ringToPoints, ringsOf } from './shape-geometry';

export interface PlatAlignmentOverlayProps {
  readonly draft: PlatAlignmentDraft;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly onTranslate: (dx: number, dy: number) => void;
}

export function PlatAlignmentOverlay({
  draft,
  camera,
  size,
  onTranslate,
}: PlatAlignmentOverlayProps) {
  const reading = alignedPlatReading(draft);
  const shapes = geometries(reading);
  return (
    <Group
      draggable
      onDragEnd={(event) => {
        const node = event.target;
        const delta = screenDeltaToLocalDelta(node.x(), node.y(), camera);
        node.position({ x: 0, y: 0 });
        onTranslate(delta.dx, delta.dy);
      }}
    >
      {shapes.map(({ geometry, lot }, index) => {
        const color = lot ? '#2ee88b' : '#ff642f';
        if (geometry.type === 'Point') {
          const point = toScreen(geometry.coordinates, camera, size);
          return (
            <Circle
              key={index}
              x={point.x}
              y={point.y}
              radius={5}
              fill={color}
              stroke="#15150f"
              strokeWidth={1.5}
            />
          );
        }
        const fillProp = geometry.type === 'Polygon' ? { fill: `${color}24` } : {};
        const dashProp = lot ? {} : { dash: [7, 4] };
        return ringsOf(geometry).map((ring, ringIndex) => (
          <Line
            key={`${String(index)}-${String(ringIndex)}`}
            points={ringToPoints(ring, camera, size)}
            closed={geometry.type === 'Polygon'}
            stroke={color}
            strokeWidth={lot ? 3.5 : 2.5}
            {...fillProp}
            {...dashProp}
            hitStrokeWidth={16}
          />
        ));
      })}
    </Group>
  );
}

function geometries(reading: PlatReading): readonly { geometry: Geometry; lot: boolean }[] {
  const result: { geometry: Geometry; lot: boolean }[] = [];
  if (reading.boundary !== null) {
    const lot = editorGeometryOf(reading.boundary.geometry);
    if (lot !== null) result.push({ geometry: lot, lot: true });
  }
  for (const object of reading.objects) {
    const geometry = editorGeometryOf(object.geometry);
    if (geometry !== null) result.push({ geometry, lot: false });
  }
  return result;
}
