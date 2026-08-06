/**
 * Local editor-domain types for the map feature.
 *
 * `MapObjectRecord` is the shape every component in this feature reads and
 * writes — a flattened, camelCase view of `WireGardenObject` with the
 * envelope's geometry hoisted to a top-level field. Deliberately not the wire
 * type itself, so a future transport change (a second API version, a batched
 * fetch) touches only `object-mapper.ts`.
 *
 * Source: architecture/map-rendering-and-editing.md, section "6. Hybrid Data Model".
 */

import type {
  GardenObjectCategory,
  GardenObjectDetails,
  Geometry,
} from '@verdery/geometry-contracts';

export interface MapObjectRecord {
  readonly id: string;
  readonly gardenId: string;
  readonly category: GardenObjectCategory;
  readonly geometry: Geometry;
  readonly label?: string;
  readonly categoryDetails?: GardenObjectDetails;
  readonly lifecycleState: 'active' | 'deleted';
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Every category except `importedBackground` can be created from this
 * editor's drawing tools. `importedBackground` (a raster/PDF property-plan
 * asset) is created from a real uploaded plan document through the
 * imported-background panel instead (`imported-background-panel.tsx`,
 * P6-PLAN-01) — never drawn: its geometry is a placeholder placement, not
 * user linework. It renders, is listed, is selectable, is movable, and is
 * deletable like every other category — see `map-canvas.tsx`,
 * `map-object-list.tsx`, and `use-map-editor-actions.ts`, none of which
 * switch on this set — only *drawing-tool creation* is scoped by it.
 *
 * `gate` is creatable but not through the generic create flow other
 * categories use: `GateDetails.fenceObjectId` is required (a gate is always
 * positioned along exactly one fence), so its command is always built with a
 * real, user-picked fence id — see `commands.ts#buildCreateGateObjectCommand`
 * and `use-map-editor-actions.ts`'s gate-creation flow.
 *
 * One thing remains out of this editor entirely, deferred to its own later
 * phase rather than cut for this pass: reviewing generated proposals
 * (`decideProposal` — needs a proposal, and assisted capture is Phase 10
 * scope, itself gated behind an explicit research decision the plan has
 * not yet made). Calibration (`upsertCalibration`) is P6-PLAN-02's own
 * flow: `calibration-panel.tsx` + `calibration-session.ts`, never a
 * drawing tool. See `commands.ts`'s module doc comment.
 */
export const CREATABLE_CATEGORIES = [
  'lot',
  'structure',
  'fence',
  'gate',
  'path',
  'zone',
  'bed',
  'waterFeature',
  'utilityExclusion',
  'tree',
  'plant',
  'annotation',
] as const;
export type CreatableCategory = (typeof CREATABLE_CATEGORIES)[number];

/**
 * The primary geometry type each creatable category draws with. `gate`
 * draws as a short line (like a mini `fence`) even though its schema also
 * permits a bare `Point` — a short segment is the more useful default, per
 * `object-category.ts`'s comment on `ALLOWED_GEOMETRY_TYPES.gate`.
 * `annotation` draws as a point (a measurement-reference pin) even though
 * its schema also permits a `LineString` — a point is the simpler,
 * sufficient choice for this pass.
 */
export const CREATABLE_GEOMETRY_KIND: Readonly<
  Record<CreatableCategory, 'polygon' | 'line' | 'point'>
> = {
  lot: 'polygon',
  structure: 'polygon',
  fence: 'line',
  gate: 'line',
  path: 'line',
  zone: 'polygon',
  bed: 'polygon',
  waterFeature: 'polygon',
  utilityExclusion: 'polygon',
  tree: 'point',
  plant: 'point',
  annotation: 'point',
};

export type ToolMode = 'select' | `create:${CreatableCategory}`;

export function createToolMode(category: CreatableCategory): ToolMode {
  return `create:${category}`;
}

export function creatableCategoryOfTool(tool: ToolMode): CreatableCategory | null {
  if (tool === 'select') {
    return null;
  }
  return tool.slice('create:'.length) as CreatableCategory;
}

/**
 * Existing geometry must leave the Konva hit graph while a creation tool is
 * active. It remains visible and available for snapping, but clicks pass
 * through filled polygons such as the lot to the stage drawing handler.
 */
export function existingObjectsAreInteractive(tool: ToolMode): boolean {
  return tool === 'select';
}

/** Screen-space camera: centre, pixels per metre, and clockwise view rotation. */
export interface MapCamera {
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
  readonly rotationDegrees: number;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}
