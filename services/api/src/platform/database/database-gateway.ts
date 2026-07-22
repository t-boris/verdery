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

/**
 * Typed database schema.
 *
 * Phase 1 creates no domain tables: the first migration establishes extensions,
 * roles, and module schema ownership only. Each module contributes its own
 * tables here as it is implemented.
 *
 * Source: architecture/data-and-geospatial-design.md, section "3. Schema Ownership".
 */
export type DatabaseSchema = Record<never, never>;

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
