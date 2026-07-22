/**
 * Deterministic local undo.
 *
 * Section "9. Undo and Redo" of the map design: "Undo creates the inverse
 * domain command; it does not rewind the database... Once synchronized, undo
 * remains a new explicit change." The inverse this module derives is
 * therefore an ordinary new {@link MapCommandPayload}, not a special "undo"
 * API — it carries the revision the object had immediately after the
 * original command, since that is what the server now expects as the base
 * for the next command.
 *
 * Not every command type inverts as a single deterministic command, and this
 * is a property of the domain, not a gap in this function: the design
 * explicitly special-cases proposal acceptance ("can be undone through
 * revision restoration, not by deleting processing history") and split/join
 * linework recreate object identity in a way a single inverse command cannot
 * express. Those cases return `null` on purpose — the editor's undo stack
 * must treat `null` as "not locally undoable this way," not as an error.
 *
 * Source: architecture/map-rendering-and-editing.md, section
 * "9. Undo and Redo".
 */

import type { Geometry, Position } from './geometry.js';
import type { GardenObjectCategory, GardenObjectDetails } from './object-category.js';
import { positionsOf } from './geometry.js';
import type { MapCommandPayload } from './command.js';

export type ObjectLifecycleState = 'active' | 'deleted';

/** What the object looked like immediately before a command was applied — exactly what a client already holds before performing its own local optimistic update. */
export interface ObjectSnapshot {
  readonly objectId: string;
  readonly category: GardenObjectCategory;
  readonly geometry: Geometry;
  readonly label?: string;
  readonly categoryDetails?: GardenObjectDetails;
  readonly lifecycleState: ObjectLifecycleState;
}

function ringOf(geometry: Geometry, ringIndex: number): readonly Position[] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates];
    case 'LineString':
      return geometry.coordinates;
    case 'MultiLineString':
      return geometry.coordinates[ringIndex] ?? [];
    case 'Polygon':
      return geometry.coordinates[ringIndex] ?? [];
    case 'MultiPolygon':
      // Flattened across polygons; callers that need per-polygon addressing
      // track polygon and ring separately. Foundation-release geometry
      // editing does not yet reach MultiPolygon vertex-level commands.
      return positionsOf(geometry);
  }
}

/**
 * Derives the inverse of a single command, given the object's state
 * immediately before the command and the revision the server assigned after
 * applying it (the base the inverse must target).
 *
 * Returns `null` when the command type has no single-command inverse — see
 * the module doc comment.
 */
export function deriveInverseCommand(
  command: MapCommandPayload,
  priorSnapshot: ObjectSnapshot | null,
  revisionAfterCommand: number,
): MapCommandPayload | null {
  switch (command.type) {
    case 'createObject':
      return {
        type: 'deleteObject',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
      };

    case 'duplicateObject':
      return {
        type: 'deleteObject',
        objectId: command.newObjectId,
        expectedRevision: revisionAfterCommand,
      };

    case 'moveObject':
      return {
        type: 'moveObject',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
        translationMetres: {
          dx: -command.translationMetres.dx,
          dy: -command.translationMetres.dy,
        },
      };

    case 'replaceGeometry':
      if (priorSnapshot === null) return null;
      return {
        type: 'replaceGeometry',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
        geometry: priorSnapshot.geometry,
      };

    case 'editVertex': {
      if (priorSnapshot === null) return null;
      const priorRing = ringOf(priorSnapshot.geometry, command.ringIndex);

      if (command.operation === 'insert') {
        return {
          type: 'editVertex',
          objectId: command.objectId,
          expectedRevision: revisionAfterCommand,
          operation: 'remove',
          ringIndex: command.ringIndex,
          vertexIndex: command.vertexIndex,
        };
      }

      const priorPosition = priorRing[command.vertexIndex];
      if (priorPosition === undefined) return null;

      if (command.operation === 'move') {
        return {
          type: 'editVertex',
          objectId: command.objectId,
          expectedRevision: revisionAfterCommand,
          operation: 'move',
          ringIndex: command.ringIndex,
          vertexIndex: command.vertexIndex,
          position: priorPosition,
        };
      }

      // operation === 'remove'
      return {
        type: 'editVertex',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
        operation: 'insert',
        ringIndex: command.ringIndex,
        vertexIndex: command.vertexIndex,
        position: priorPosition,
      };
    }

    case 'changeProperties':
      if (priorSnapshot === null) return null;
      return {
        type: 'changeProperties',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
        ...(priorSnapshot.label === undefined ? {} : { label: priorSnapshot.label }),
        ...(priorSnapshot.categoryDetails === undefined
          ? {}
          : { categoryDetails: priorSnapshot.categoryDetails }),
      };

    case 'assignPlant': {
      if (priorSnapshot === null) return null;
      const priorTarget =
        priorSnapshot.categoryDetails?.category === 'plant'
          ? (priorSnapshot.categoryDetails.details.assignedToObjectId ?? null)
          : null;
      return {
        type: 'assignPlant',
        plantObjectId: command.plantObjectId,
        expectedRevision: revisionAfterCommand,
        targetObjectId: priorTarget,
      };
    }

    case 'deleteObject':
      return {
        type: 'restoreObject',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
      };

    case 'restoreObject':
      return {
        type: 'deleteObject',
        objectId: command.objectId,
        expectedRevision: revisionAfterCommand,
      };

    // Split and join recreate object identity in ways a single inverse
    // command cannot express; calibration and proposal decisions are
    // explicitly excluded from single-command undo by the design itself.
    // See the module doc comment.
    case 'splitLinework':
    case 'joinLinework':
    case 'upsertCalibration':
    case 'decideProposal':
      return null;
  }
}
