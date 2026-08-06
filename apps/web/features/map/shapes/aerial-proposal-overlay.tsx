import { Group } from 'react-konva';

import type { WireAerialTraceProposal } from '@/core/api/public';

import {
  aerialProposalRecord,
  insertProposalVertex,
  moveProposalVertex,
  removeProposalVertex,
  translateProposalGeometry,
} from '../aerial-proposal-geometry';
import type { CanvasSize, MapCamera } from '../types';
import { ObjectShape } from './object-shape';
import { VertexHandles } from './vertex-handles';

interface AerialProposalOverlayProps {
  readonly proposals: readonly WireAerialTraceProposal[];
  readonly selectedId: string | null;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly onSelect: (proposalId: string) => void;
  readonly onGeometryChange: (
    proposalId: string,
    geometry: WireAerialTraceProposal['geometry'],
  ) => void;
}

/** Ephemeral proposal layer: editable, but never confused with canonical map objects. */
export function AerialProposalOverlay({
  proposals,
  selectedId,
  camera,
  size,
  onSelect,
  onGeometryChange,
}: AerialProposalOverlayProps) {
  const records = proposals.map(aerialProposalRecord);
  const selected = records.find((record) => record.id === selectedId) ?? null;

  return (
    <Group>
      {records.map((record) => (
        <ObjectShape
          key={record.id}
          record={record}
          camera={camera}
          size={size}
          selected={record.id === selectedId}
          interactive
          draggable
          onSelect={onSelect}
          onMoveEnd={(proposalId, dx, dy, resetPosition) => {
            onGeometryChange(proposalId, translateProposalGeometry(record.geometry, dx, dy));
            resetPosition();
          }}
        />
      ))}
      {selected !== null && (
        <VertexHandles
          record={selected}
          records={records}
          camera={camera}
          size={size}
          onMoveVertex={(_ringIndex, vertexIndex, position) =>
            onGeometryChange(
              selected.id,
              moveProposalVertex(selected.geometry, vertexIndex, position),
            )
          }
          onInsertVertex={(_ringIndex, vertexIndex, position) =>
            onGeometryChange(
              selected.id,
              insertProposalVertex(selected.geometry, vertexIndex, position),
            )
          }
          onRemoveVertex={(_ringIndex, vertexIndex) =>
            onGeometryChange(selected.id, removeProposalVertex(selected.geometry, vertexIndex))
          }
        />
      )}
    </Group>
  );
}
