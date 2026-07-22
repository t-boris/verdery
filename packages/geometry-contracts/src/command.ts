/**
 * The canonical map editor command model.
 *
 * User changes are expressed as typed commands, never as raw geometry
 * overwrites — this is what makes editing undoable, revision-guarded, and
 * identical in meaning on iOS, web, and the backend. A gesture (drag, pinch,
 * rotate handle) is a client-only concept; only the command it commits
 * crosses into durable state.
 *
 * `resize`, `rotate`, and freehand `reshape` gestures all commit as
 * {@link ReplaceGeometryPayload} — the domain does not care how a client
 * derived a new shape, only what it is. Layer assignment is deliberately
 * absent: architecture/map-rendering-and-editing.md section "12. Layer
 * Model" derives layer from category and treats visibility/opacity as a
 * client-local preference, not mutable domain state.
 *
 * Source: architecture/map-rendering-and-editing.md, sections
 * "7. Editor Command Model" and "9. Undo and Redo".
 */

import type { Geometry } from './geometry.js';
import type { GardenObjectCategory, GardenObjectDetails } from './object-category.js';

export type MapCommandActorType = 'user' | 'system';

/** Metadata every command carries, regardless of its payload. */
export interface MapCommandEnvelope {
  readonly commandId: string;
  readonly gardenId: string;
  readonly actorProfileId: string;
  readonly actorType: MapCommandActorType;
  readonly clientTimestamp: string;
}

export interface CreateObjectPayload {
  readonly type: 'createObject';
  readonly objectId: string;
  readonly category: GardenObjectCategory;
  readonly geometry: Geometry;
  readonly label?: string;
  readonly categoryDetails?: GardenObjectDetails;
}

export interface MoveObjectPayload {
  readonly type: 'moveObject';
  readonly objectId: string;
  readonly expectedRevision: number;
  readonly translationMetres: { readonly dx: number; readonly dy: number };
}

export interface ReplaceGeometryPayload {
  readonly type: 'replaceGeometry';
  readonly objectId: string;
  readonly expectedRevision: number;
  readonly geometry: Geometry;
}

export type VertexOperation = 'insert' | 'move' | 'remove';

export interface EditVertexPayload {
  readonly type: 'editVertex';
  readonly objectId: string;
  readonly expectedRevision: number;
  readonly operation: VertexOperation;
  /** Which ring of a Polygon/MultiPolygon; 0 for LineString/Point geometries. */
  readonly ringIndex: number;
  readonly vertexIndex: number;
  /** Required for `insert` and `move`; absent for `remove`. */
  readonly position?: readonly [number, number];
}

export interface SplitLineworkPayload {
  readonly type: 'splitLinework';
  readonly objectId: string;
  readonly expectedRevision: number;
  /** New object identifiers for the two resulting pieces, in original line order. */
  readonly resultObjectIds: readonly [string, string];
  readonly atVertexIndex: number;
}

export interface JoinLineworkPayload {
  readonly type: 'joinLinework';
  readonly firstObjectId: string;
  readonly firstExpectedRevision: number;
  readonly secondObjectId: string;
  readonly secondExpectedRevision: number;
  readonly resultObjectId: string;
}

export interface ChangePropertiesPayload {
  readonly type: 'changeProperties';
  readonly objectId: string;
  readonly expectedRevision: number;
  readonly label?: string;
  readonly categoryDetails?: GardenObjectDetails;
}

export interface AssignPlantPayload {
  readonly type: 'assignPlant';
  readonly plantObjectId: string;
  readonly expectedRevision: number;
  /** `null` unassigns the plant from any zone or bed. */
  readonly targetObjectId: string | null;
}

export interface UpsertCalibrationPayload {
  readonly type: 'upsertCalibration';
  readonly backgroundObjectId: string;
  readonly referencePoints: readonly {
    readonly imagePixel: readonly [number, number];
    readonly localMetres: readonly [number, number];
  }[];
}

export type ProposalDecision = 'accept' | 'modifyAndAccept' | 'reject';

export interface DecideProposalPayload {
  readonly type: 'decideProposal';
  readonly proposalId: string;
  readonly decision: ProposalDecision;
  /** Required only for `modifyAndAccept`. */
  readonly editedGeometry?: Geometry;
}

export interface DeleteObjectPayload {
  readonly type: 'deleteObject';
  readonly objectId: string;
  readonly expectedRevision: number;
}

export interface RestoreObjectPayload {
  readonly type: 'restoreObject';
  readonly objectId: string;
  readonly expectedRevision: number;
}

export interface DuplicateObjectPayload {
  readonly type: 'duplicateObject';
  readonly sourceObjectId: string;
  readonly newObjectId: string;
  readonly offsetMetres: { readonly dx: number; readonly dy: number };
}

export type MapCommandPayload =
  | CreateObjectPayload
  | MoveObjectPayload
  | ReplaceGeometryPayload
  | EditVertexPayload
  | SplitLineworkPayload
  | JoinLineworkPayload
  | ChangePropertiesPayload
  | AssignPlantPayload
  | UpsertCalibrationPayload
  | DecideProposalPayload
  | DeleteObjectPayload
  | RestoreObjectPayload
  | DuplicateObjectPayload;

export interface MapCommand {
  readonly envelope: MapCommandEnvelope;
  readonly payload: MapCommandPayload;
}

export type MapCommandType = MapCommandPayload['type'];
