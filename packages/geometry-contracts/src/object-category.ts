/**
 * Canonical garden object categories and their category-specific detail
 * shapes.
 *
 * `garden_object` carries identity, geometry, provenance, confidence, and
 * lifecycle state common to every category; specialized detail types here
 * carry only what a category adds. This mirrors the database's hybrid model
 * exactly, so a client never has to reshape data between the wire and the
 * domain.
 *
 * The plant catalog (species, care profiles) is Phase 4 scope — a plant
 * placement here is a lightweight reference plus a free-text name, not a
 * foreign key into a catalog that does not exist yet.
 *
 * Source: architecture/map-rendering-and-editing.md, section
 * "4. Canonical Object Categories"; architecture/data-and-geospatial-design.md,
 * section "7. Garden Object Model".
 */

import type { Geometry } from './geometry.js';
import type { Measurement } from './measurement.js';

export type GardenObjectCategory =
  | 'lot'
  | 'structure'
  | 'fence'
  | 'gate'
  | 'path'
  | 'zone'
  | 'bed'
  | 'waterFeature'
  | 'utilityExclusion'
  | 'tree'
  | 'plant'
  | 'annotation'
  | 'importedBackground';

export const GARDEN_OBJECT_CATEGORIES: readonly GardenObjectCategory[] = [
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
  'importedBackground',
];

/** The GeoJSON geometry type(s) a category's primary geometry may use. */
const ALLOWED_GEOMETRY_TYPES: Record<GardenObjectCategory, readonly Geometry['type'][]> = {
  lot: ['Polygon', 'MultiPolygon'],
  structure: ['Polygon', 'MultiPolygon'],
  fence: ['LineString', 'MultiLineString'],
  // A short segment, not a full linework category of its own.
  gate: ['Point', 'LineString'],
  path: ['LineString', 'MultiLineString'],
  zone: ['Polygon', 'MultiPolygon'],
  bed: ['Polygon', 'MultiPolygon'],
  waterFeature: ['Polygon', 'MultiPolygon'],
  utilityExclusion: ['Polygon', 'MultiPolygon'],
  // Trunk position; canopy is a second, optional geometry — see TreeDetails.
  tree: ['Point'],
  plant: ['Point', 'Polygon'],
  annotation: ['Point', 'LineString'],
  importedBackground: ['Polygon'],
};

/** True when a geometry's type is one this category's primary geometry may use. */
export function isGeometryTypeAllowedForCategory(
  category: GardenObjectCategory,
  geometryType: Geometry['type'],
): boolean {
  return ALLOWED_GEOMETRY_TYPES[category].includes(geometryType);
}

export type StructureKind = 'house' | 'shed' | 'greenhouse' | 'deck' | 'garage' | 'other';

export interface StructureDetails {
  readonly structureKind: StructureKind;
  readonly heightMetres?: number;
}

export type FenceKind = 'wood' | 'chainLink' | 'vinyl' | 'metal' | 'hedge' | 'other';

export interface FenceDetails {
  readonly fenceKind: FenceKind;
  readonly heightMetres?: number;
}

/** A gate is always positioned along exactly one fence. */
export interface GateDetails {
  readonly fenceObjectId: string;
  readonly widthMetres?: number;
}

export type ZoneKind = 'lawn' | 'garden' | 'mulch' | 'gravel' | 'groundCover' | 'other';

export interface ZoneDetails {
  readonly zoneKind: ZoneKind;
}

export type BedKind = 'inGround' | 'raised' | 'container';

export interface BedDetails {
  readonly bedKind: BedKind;
  readonly soilNotes?: string;
}

export interface TreeDetails {
  /** Absent until the user draws or accepts a canopy outline. */
  readonly canopyGeometry?: Geometry;
  readonly commonName?: string;
  readonly estimatedHeightMetres?: number;
  readonly estimatedSpreadMetres?: number;
}

/** Deliberately without a plant-catalog reference — see the module doc comment. */
export interface PlantPlacementDetails {
  readonly commonName: string;
  /** More than one for a grouped planting sharing one geometry. */
  readonly quantity: number;
  readonly spacingMetres?: number;
  /** The zone or bed object this plant is assigned to, if any. */
  readonly assignedToObjectId?: string;
}

export type UtilityExclusionKind =
  'undergroundUtility' | 'septicField' | 'wellRadius' | 'setback' | 'other';

export interface UtilityExclusionDetails {
  readonly utilityExclusionKind: UtilityExclusionKind;
  readonly notes?: string;
}

/**
 * The "Annotation and measurement reference" category (section 4) is where a
 * {@link Measurement} attaches — an ordinary object's length or area is
 * derived from its geometry at render time, not stored, so only a dedicated
 * measurement reference needs this table.
 */
export interface AnnotationDetails {
  readonly measurement?: Measurement;
}

/** The category-specific detail payload for a category that has one. Categories without a row here (lot, path, water feature, imported background) carry no specialized fields beyond the common `garden_object` shape. */
export type GardenObjectDetails =
  | { readonly category: 'structure'; readonly details: StructureDetails }
  | { readonly category: 'fence'; readonly details: FenceDetails }
  | { readonly category: 'gate'; readonly details: GateDetails }
  | { readonly category: 'zone'; readonly details: ZoneDetails }
  | { readonly category: 'bed'; readonly details: BedDetails }
  | { readonly category: 'annotation'; readonly details: AnnotationDetails }
  | { readonly category: 'tree'; readonly details: TreeDetails }
  | { readonly category: 'plant'; readonly details: PlantPlacementDetails }
  | { readonly category: 'utilityExclusion'; readonly details: UtilityExclusionDetails };
