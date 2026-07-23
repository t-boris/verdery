import type { Uuid } from '../../../shared/identifiers/uuid.js';

/**
 * Read-only existence/ownership check against `plants_inventory.plant`, a
 * table this module does not own — `plants-inventory` does.
 *
 * `RecordObservation` must reject a `plantId` that does not belong to the
 * `gardenId` it was given, and the only way to know that is to look at the
 * plant's own `garden_id` column. This module has no application-layer
 * dependency on `plants-inventory` (it never imports from that module at
 * all, since that module builds no `public.ts` this pass and has no query
 * port to import even if it did): it reads the table directly, the same way
 * `gardens-mapping`'s own `KyselyMembershipRepository` reads
 * `collaboration.membership` — a table it does not "own" in the eventual
 * architecture either, declared locally in that module's own
 * `persistence/schema.ts` for exactly the columns it needs. No existing
 * module in this codebase reaches across into a table owned by a sibling
 * *code* module's own persistence layer (there was no precedent for that
 * before Phase 4), so this is a judgment call, not a mirrored pattern: it
 * follows the *closest* existing precedent (a module reading a table it does
 * not conceptually own, declared narrowly, read-only) rather than inventing
 * a new cross-module RPC mechanism for a single existence check.
 *
 * Never writes to `plants_inventory.plant` — only `findGardenId`, nothing
 * else.
 */
export interface PlantOwnershipRepository {
  /** The plant's owning `gardenId`, or `null` if no such plant exists. */
  findGardenId(plantId: Uuid): Promise<Uuid | null>;
}
