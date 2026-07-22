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
 * The five categories the toolbar can create this pass — enough to prove the
 * create/select/move/edit/delete pattern generalizes across every primary
 * geometry type (polygon, line, point) without building all thirteen.
 *
 * Every other category (gate, path, zone, bed, waterFeature, utilityExclusion,
 * annotation, importedBackground) still renders, is listed, is selectable,
 * is movable, and is deletable — see `map-canvas.tsx`, `map-object-list.tsx`,
 * and `use-map-editor-actions.ts`, none of which switch on this set. Only
 * *creation* and category-specific *property editing* are scoped to it; see
 * `category-detail-fields.tsx` for the same cut applied to the property panel.
 */
export const CREATABLE_CATEGORIES = ['lot', 'structure', 'fence', 'tree', 'plant'] as const;
export type CreatableCategory = (typeof CREATABLE_CATEGORIES)[number];

/** The primary geometry type each creatable category draws. */
export const CREATABLE_GEOMETRY_KIND: Readonly<
  Record<CreatableCategory, 'polygon' | 'line' | 'point'>
> = {
  lot: 'polygon',
  structure: 'polygon',
  fence: 'line',
  tree: 'point',
  plant: 'point',
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

/** Screen-space camera: the local point at the canvas center, and pixels per metre. */
export interface MapCamera {
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}
