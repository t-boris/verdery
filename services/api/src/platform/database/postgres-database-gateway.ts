/**
 * PostgreSQL implementation of the database boundary.
 *
 * Pool size and timeouts are configuration-driven because Cloud Run scales the
 * number of instances independently of Cloud SQL's connection limit, and an
 * unbounded pool per instance exhausts the server long before the service is
 * saturated.
 *
 * Source: architecture/backend-modular-monolith.md, section "17. Database Access".
 */

import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DatabaseConfiguration } from '../configuration/configuration-schema.js';
import type { DatabaseGateway, DatabaseSchema } from './database-gateway.js';

/** Notified when an idle pooled connection fails outside of any query. */
export type PoolErrorListener = (error: Error) => void;

export class PostgresDatabaseGateway implements DatabaseGateway {
  readonly queries: Kysely<DatabaseSchema>;

  readonly #pool: pg.Pool;

  constructor(
    configuration: DatabaseConfiguration,
    applicationName: string,
    onPoolError?: PoolErrorListener,
  ) {
    this.#pool = new pg.Pool({
      connectionString: configuration.url,
      max: configuration.maxConnections,
      connectionTimeoutMillis: configuration.connectionTimeoutMs,
      statement_timeout: configuration.statementTimeoutMs,
      application_name: applicationName,
    });

    // node-postgres emits 'error' on the pool when an *idle* connection dies —
    // a database restart or failover, for example. Node treats an unhandled
    // 'error' event as a fatal exception, so without this listener the process
    // is killed outright: graceful shutdown never runs, in-flight requests are
    // dropped, and readiness never gets the chance to report the outage.
    //
    // Recovery is the pool's own job; it discards the dead connection and opens
    // a new one on demand. This listener therefore only records the event so it
    // reaches telemetry instead of the default crash path.
    //
    // Source: architecture/reliability-and-disaster-recovery.md — a dependency
    // failure must degrade the service, not terminate it.
    this.#pool.on('error', (error: Error) => {
      onPoolError?.(error);
    });

    this.queries = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: this.#pool }),
    });
  }

  async ping(): Promise<void> {
    await sql`select 1`.execute(this.queries);
  }

  async close(): Promise<void> {
    // Closing the Kysely instance destroys the underlying pool, so the pool is
    // not closed separately.
    await this.queries.destroy();
  }
}
