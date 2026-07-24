/**
 * The relay's own database connection: a plain `pg` pool and a `Kysely`
 * instance typed against `RelayDatabaseSchema` — the narrow two-table slice
 * this package touches, never the API's own full `DatabaseSchema`. See
 * `relay-database-schema.ts`'s own header comment for why this is a
 * deliberate duplication, not an oversight.
 *
 * Source: architecture/backend-modular-monolith.md, section "19. Worker Boundary".
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { WorkerDatabaseConfiguration } from '../configuration.js';
import type { RelayDatabaseSchema } from './relay-database-schema.js';

export interface RelayDatabase {
  readonly db: Kysely<RelayDatabaseSchema>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createRelayDatabase(configuration: WorkerDatabaseConfiguration): RelayDatabase {
  const pool = new pg.Pool({
    connectionString: configuration.url,
    max: configuration.maxConnections,
    connectionTimeoutMillis: configuration.connectionTimeoutMs,
    statement_timeout: configuration.statementTimeoutMs,
  });

  const db = new Kysely<RelayDatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    async ping(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async close(): Promise<void> {
      await db.destroy();
    },
  };
}
