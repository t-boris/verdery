'use client';

import type { PlatReading, ProposedPlatObject } from '@verdery/api-contracts';
import type { CreateObjectSource, Geometry, Position } from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import { buildAcceptProposedObjectCommand, generateMapId } from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';
import type { CreatableCategory } from './types';

/**
 * Accepting what a plat reading proposed (ADR-0018).
 *
 * The reading itself writes nothing; this is where a person's decision
 * becomes garden state, and it does so through the ordinary `createObject`
 * command — same authorization, same revision journal, same audit trail, same
 * undo. What the drawing was read from is recorded on each object rather than
 * inferred later: the lot's outline comes from the survey's own printed
 * measurements (`importedPlan`), everything else was traced off the drawing
 * by a model (`imageExtraction`), and the model's confidence rides along.
 *
 * Objects are committed one at a time, in order, and a failure stops the run
 * rather than pressing on: a half-accepted plan a person can see is far
 * easier to finish than one that silently skipped three objects.
 */
export function useMapEditorPlatActions({ commit, findRecord, store }: MapEditorActionDeps) {
  void findRecord;

  const acceptPlatProposals = useCallback(
    async (reading: PlatReading, acceptedIndices: readonly number[], includeBoundary: boolean) => {
      let created = 0;

      if (includeBoundary && reading.boundary !== null) {
        const boundaryGeometry = toEditorGeometry(reading.boundary.geometry);
        if (boundaryGeometry === null) {
          store.setStatus({ key: 'map.plat.acceptFailed', tone: 'alert' });
          return created;
        }
        const command = buildAcceptProposedObjectCommand(
          generateMapId(),
          'lot',
          boundaryGeometry,
          undefined,
          // The lot is not traced off the picture: it is walked from the
          // bearings and distances the surveyor printed, which is why it
          // carries no confidence — the closure error already said how good
          // the reading was, in metres.
          { provenance: 'importedPlan' },
        );
        const affected = await commit(command, null);
        if (affected === null) {
          store.setStatus({ key: 'map.plat.acceptFailed', tone: 'alert' });
          return created;
        }
        created += 1;
      }

      for (const index of acceptedIndices) {
        const proposal = reading.objects[index];
        if (proposal === undefined) {
          continue;
        }
        const category = acceptableCategory(proposal);
        const geometry = toEditorGeometry(proposal.geometry);
        if (category === null || geometry === null) {
          continue;
        }
        const source: CreateObjectSource = {
          provenance: 'imageExtraction',
          confidence: proposal.confidence,
        };
        const command = buildAcceptProposedObjectCommand(
          generateMapId(),
          category,
          geometry,
          proposal.label,
          source,
        );
        const affected = await commit(command, null);
        if (affected === null) {
          store.setStatus({ key: 'map.plat.acceptFailed', tone: 'alert' });
          return created;
        }
        created += 1;
      }

      if (created > 0) {
        store.setTool('select');
        store.setStatus({
          key: 'map.plat.accepted',
          args: { count: String(created) },
          tone: 'status',
        });
      }
      return created;
    },
    [commit, store],
  );

  return { acceptPlatProposals };
}

/**
 * The wire's geometry as the editor's own `Geometry`.
 *
 * The generated contract types say `number[]` where this package says
 * `Position` — a pair — so the pairs are checked rather than asserted. A
 * coordinate that is not a pair is a reading this client will not place, and
 * dropping it is better than casting it into the map.
 */
function toEditorGeometry(wire: ProposedPlatObject['geometry']): Geometry | null {
  if (wire.type === 'Point') {
    const point = toPosition(wire.coordinates);
    return point === null ? null : { type: 'Point', coordinates: point };
  }
  if (wire.type === 'LineString') {
    const line = toPositions(wire.coordinates);
    return line === null || line.length < 2 ? null : { type: 'LineString', coordinates: line };
  }
  if (wire.type === 'Polygon') {
    const rings = wire.coordinates.map(toPositions);
    return rings.some((ring) => ring === null)
      ? null
      : { type: 'Polygon', coordinates: rings as readonly (readonly Position[])[] };
  }
  return null;
}

function toPosition(coordinates: readonly number[]): Position | null {
  const [x, y] = coordinates;
  return x === undefined || y === undefined ? null : [x, y];
}

function toPositions(coordinates: readonly (readonly number[])[]): readonly Position[] | null {
  const positions = coordinates.map(toPosition);
  return positions.some((position) => position === null)
    ? null
    : (positions as readonly Position[]);
}

/**
 * `null` for anything this editor cannot create directly — a `gate` needs a
 * fence to belong to, and the reader never proposes one, but refusing here
 * rather than casting keeps that guarantee local instead of assumed.
 */
function acceptableCategory(
  proposal: ProposedPlatObject,
): Exclude<CreatableCategory, 'gate'> | null {
  const category = proposal.category;
  return category === 'gate' || category === 'importedBackground' ? null : category;
}
