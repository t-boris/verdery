/**
 * Database access boundary.
 *
 * Modules depend on this interface, never on `pg`. Swapping the driver, adding
 * pool instrumentation, or running a module against a transaction-scoped handle
 * then stays a platform concern.
 *
 * Source: architecture/backend-modular-monolith.md, section "17. Database Access".
 */

import type { Kysely } from 'kysely';
import type { IdentityAccessDatabaseSchema } from '../../modules/identity-access/persistence/schema.js';
import type { GardensMappingDatabaseSchema } from '../../modules/gardens-mapping/persistence/schema.js';
import type { MediaDatabaseSchema } from '../../modules/media/persistence/schema.js';
import type { ObservationsHistoryDatabaseSchema } from '../../modules/observations-history/persistence/schema.js';
import type { PlantsInventoryDatabaseSchema } from '../../modules/plants-inventory/persistence/schema.js';
import type { TasksRecommendationsDatabaseSchema } from '../../modules/tasks-recommendations/persistence/schema.js';
import type { PlatformDatabaseSchema } from './platform-schema.js';

/**
 * Typed database schema: every module's row types, intersected.
 *
 * A type-only aggregation point, not a runtime dependency — this file never
 * imports module *behavior*, only the shape of the tables each module owns.
 *
 * Every repository and store in the service is typed `Kysely<DatabaseSchema>`
 * — this exact type, not a module-scoped subset intersection — even though
 * each one only ever names its own tables. Kysely's generic `Database` type
 * parameter appears in enough contravariant and conditional positions
 * (`mergeInto(...).returning(...)`, `$extendTables()`, among others) that
 * `Kysely<A & B>` is not structurally assignable to a parameter typed
 * `Kysely<A>`, confirmed directly: narrower per-module aliases were tried
 * first and `tsc` rejected passing the pooled instance to any of them.
 * Sharing one type throughout sidesteps the mismatch entirely.
 *
 * Source: architecture/data-and-geospatial-design.md, section "3. Schema Ownership".
 */
export type DatabaseSchema = IdentityAccessDatabaseSchema &
  GardensMappingDatabaseSchema &
  MediaDatabaseSchema &
  ObservationsHistoryDatabaseSchema &
  PlantsInventoryDatabaseSchema &
  TasksRecommendationsDatabaseSchema &
  PlatformDatabaseSchema;

export interface DatabaseGateway {
  /** Typed query surface used by module repositories. */
  readonly queries: Kysely<DatabaseSchema>;

  /**
   * Verifies that a connection can be acquired and a trivial statement runs.
   * Throws when the database cannot currently serve queries.
   */
  ping(): Promise<void>;

  /** Drains and closes the connection pool. */
  close(): Promise<void>;
}
