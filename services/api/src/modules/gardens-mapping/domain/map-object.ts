/**
 * The garden object aggregate: identity, geometry, and lifecycle common to
 * every category, plus the category-specific detail payload where the
 * category has one.
 *
 * Mirrors `gardens_mapping.garden_object` and its detail tables exactly, the
 * same way `Garden` (domain/garden.ts) mirrors `gardens_mapping.garden` —
 * and reuses `packages/geometry-contracts`'s `Geometry`, `GardenObjectCategory`,
 * and `GardenObjectDetails` rather than redeclaring them, since those types
 * are the canonical cross-platform domain model this command handlers
 * implement the semantics of.
 *
 * Source: architecture/data-and-geospatial-design.md, section
 * "7. Garden Object Model".
 */

import type {
  GardenObjectCategory,
  GardenObjectDetails,
  Geometry,
  ProvenanceKind,
} from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type MapObjectLifecycleState = 'active' | 'deleted';

export interface MapObject {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly coordinateSpaceId: Uuid;
  readonly category: GardenObjectCategory;
  readonly geometry: Geometry;
  readonly label: string | null;
  readonly provenance: ProvenanceKind;
  /** 0..1 where the source supplies one; `null` means "not expressed," not "certain." */
  readonly confidence: number | null;
  readonly lifecycleState: MapObjectLifecycleState;
  readonly currentRevision: number;
  /** Absent for categories with no specialized fields (lot, path, waterFeature, importedBackground). */
  readonly details: GardenObjectDetails | undefined;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Lightweight projection used for reference-existence checks (a gate's fence,
 * a plant's assignment target) that need only identity and category, not the
 * full detail join `findByIdWithDetails` performs.
 */
export interface MapObjectSummary {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly category: GardenObjectCategory;
  readonly lifecycleState: MapObjectLifecycleState;
  readonly currentRevision: number;
}
