import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface CoordinateSpace {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly kind: 'localPlanarMetres';
  readonly axisConvention: 'xEastYNorth';
  readonly originDescription: string;
  readonly createdAt: Date;
}

/**
 * A garden's coordinate space is created lazily, not at garden creation —
 * see the judgment-call comment on `findOrCreateForGarden` in
 * `persistence/kysely-coordinate-space-repository.ts` for why.
 */
export interface CoordinateSpaceRepository {
  findByGardenId(gardenId: Uuid): Promise<CoordinateSpace | null>;

  /** Returns the garden's one coordinate space, creating it first if this is the garden's first map interaction. Race-safe via the table's unique index on `garden_id`. */
  findOrCreateForGarden(gardenId: Uuid, now: Date): Promise<CoordinateSpace>;
}
