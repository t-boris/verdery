import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Garden } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';

/**
 * A garden paired with the listing profile's own role.
 *
 * `listForProfile` already joins through membership to decide which gardens
 * qualify; returning the role from that same join avoids an N+1 membership
 * lookup per item.
 */
export interface GardenWithCallerRole extends Garden {
  readonly callerRole: GardenRole;
}

export interface GardenListPage {
  readonly items: readonly GardenWithCallerRole[];
  /** Opaque. `null` means no further page exists. */
  readonly nextCursor: string | null;
}

export interface GardenRepository {
  findById(id: Uuid): Promise<Garden | null>;
  insert(garden: Garden): Promise<void>;

  /**
   * Writes the garden's new state guarded by `expectedRevision`. Returns
   * `false` when the stored revision no longer matches — a concurrent write
   * already happened — without throwing, so the use case decides how to
   * report it (stale `If-Match` versus a replayed idempotent retry look
   * different to the caller even though both fail this same check).
   */
  update(garden: Garden, expectedRevision: number): Promise<boolean>;

  /**
   * Every garden the profile has *active* membership on. `nameQuery === null`
   * lists them most recently created first, unchanged from before P4-SEARCH-01
   * added the parameter; a non-null `nameQuery` instead trigram-fuzzy matches
   * `name` and orders most-similar first, the same query-vs-no-query split
   * `PlantRepository.search`'s own `filters.query` draws.
   */
  listForProfile(
    profileId: Uuid,
    cursor: string | null,
    limit: number,
    nameQuery: string | null,
  ): Promise<GardenListPage>;
}
