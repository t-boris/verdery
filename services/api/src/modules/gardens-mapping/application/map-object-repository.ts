import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MapObject, MapObjectSummary } from '../domain/map-object.js';

/** Viewport bounding box, in the garden's local planar metres — the same space `garden_object.geometry` is stored in. */
export interface ViewportBoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface MapObjectRepository {
  /** Lightweight projection — no category-detail join — for reference-existence checks (a gate's fence, a plant's assignment target). */
  findById(gardenId: Uuid, objectId: Uuid): Promise<MapObjectSummary | null>;

  /** The full aggregate, joined against the one detail table its category owns, if any. */
  findByIdWithDetails(gardenId: Uuid, objectId: Uuid): Promise<MapObject | null>;

  /** Writes the object row and, when `object.details` is present, its category detail row, in one call — command handlers commit both together. */
  insert(object: MapObject): Promise<void>;

  /**
   * Writes the object's new state guarded by `expectedRevision`, same
   * `boolean`-return pattern as `GardenRepository.update`. `object.details`
   * mirrors the aggregate's full current state: `undefined` for a category
   * with no detail table, otherwise the detail row is upserted every call —
   * including one a pure geometry command makes without changing
   * `categoryDetails` at all. That upsert is idempotent (it rewrites the same
   * values already stored), so this is a minor redundant write, not a
   * correctness concern; a future pass could skip it when the caller can
   * prove nothing in `details` actually changed.
   */
  update(object: MapObject, expectedRevision: number): Promise<boolean>;

  /** Every active object in the garden, optionally restricted to a viewport bounding box via the geometry GiST index. */
  listForGarden(gardenId: Uuid, viewport: ViewportBoundingBox | null): Promise<MapObject[]>;
}
