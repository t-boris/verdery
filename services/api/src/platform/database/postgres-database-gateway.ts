/**
 * PostgreSQL implementation of the database boundary.
 *
 * Pool size and timeouts are configuration-driven because Cloud Run scales the
 * number of instances independently of Cloud SQL's connection limit, and an
 * unbounded pool per instance exhausts the server long before the service is
 * saturated.
 *
 * Construction is asynchronous because the 'cloudSqlIam' connection mode must
 * exchange credentials with the Cloud SQL Admin API before a pool can be
 * created; a synchronous constructor cannot express that.
 *
 * Source: architecture/backend-modular-monolith.md, section "17. Database Access".
 */

import { AuthTypes, Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DatabaseConfiguration } from '../configuration/configuration-schema.js';
import type { DatabaseGateway, DatabaseSchema } from './database-gateway.js';
// Side effect: registers the bigint (revision, sync sequence) type parser
// before any query runs. See that module for why this must be explicit.
import './pg-bigint-parser.js';

/** Notified when an idle pooled connection fails outside of any query. */
export type PoolErrorListener = (error: Error) => void;

export class PostgresDatabaseGateway implements DatabaseGateway {
  readonly queries: Kysely<DatabaseSchema>;

  readonly #pool: pg.Pool;
  readonly #connector: Connector | undefined;

  private constructor(
    pool: pg.Pool,
    connector: Connector | undefined,
    onPoolError?: PoolErrorListener,
  ) {
    this.#pool = pool;
    this.#connector = connector;

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

  /**
   * Builds the gateway for either connection mode.
   *
   * 'url' opens an ordinary password-authenticated pool, used locally and by
   * the Testcontainers suite. 'cloudSqlIam' opens a pool over the Cloud SQL
   * connector's TLS socket with no password at all: the connecting identity is
   * this process's own Google credentials (the Cloud Run runtime service
   * account in production), authorized in Postgres through membership in the
   * verdery_application / verdery_migration NOLOGIN roles.
   */
  static async create(
    configuration: DatabaseConfiguration,
    applicationName: string,
    onPoolError?: PoolErrorListener,
  ): Promise<PostgresDatabaseGateway> {
    if (configuration.mode === 'url') {
      const pool = new pg.Pool({
        connectionString: configuration.url,
        max: configuration.maxConnections,
        connectionTimeoutMillis: configuration.connectionTimeoutMs,
        statement_timeout: configuration.statementTimeoutMs,
        application_name: applicationName,
      });

      return new PostgresDatabaseGateway(pool, undefined, onPoolError);
    }

    const connector = new Connector();
    const connectorOptions = await connector.getOptions({
      instanceConnectionName: configuration.instanceConnectionName,
      authType: AuthTypes.IAM,
      ipType: IpAddressTypes.PRIVATE,
    });

    const pool = new pg.Pool({
      ...connectorOptions,
      user: configuration.iamUser,
      database: configuration.databaseName,
      max: configuration.maxConnections,
      connectionTimeoutMillis: configuration.connectionTimeoutMs,
      statement_timeout: configuration.statementTimeoutMs,
      application_name: applicationName,
    });

    return new PostgresDatabaseGateway(pool, connector, onPoolError);
  }

  async ping(): Promise<void> {
    await sql`select 1`.execute(this.queries);
  }

  async close(): Promise<void> {
    // Closing the Kysely instance destroys the underlying pool, so the pool is
    // not closed separately. The connector, if this gateway opened one, is
    // this gateway's own resource and closes only when this gateway does.
    await this.queries.destroy();
    this.#connector?.close();
  }
}
