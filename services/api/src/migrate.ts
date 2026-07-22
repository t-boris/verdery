/**
 * Migration CLI entry point.
 *
 * Runs against whichever connection mode `loadConfiguration()` resolves —
 * the same config surface `main.ts` uses — so this file works unmodified for
 * a local developer's `.env`-exported DATABASE_URL and for a Cloud Run Job
 * connecting through the Cloud SQL connector with no password at all. There
 * is deliberately no separate "cloud migration script": the connection mode
 * is an environment concern, not a code-path fork a human has to choose.
 *
 * Source: implementation-plan.md work packages P1-DATA-01, P1-PLAT-03.
 */

import { fileURLToPath } from 'node:url';

import { AuthTypes, Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

import {
  ConfigurationError,
  loadConfiguration,
} from './platform/configuration/load-configuration.js';
import { createLogger } from './platform/telemetry/logger.js';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../migrations', import.meta.url));

type Direction = 'up' | 'down';

/**
 * Reads the direction from argv, defaulting to 'up'.
 *
 * Scaffolding a new migration file needs no database connection at all, so it
 * stays on the plain `node-pg-migrate` CLI (`pnpm exec node-pg-migrate create
 * <name>`) rather than being added here.
 */
function resolveDirection(argv: readonly string[]): Direction {
  const requested = argv[2];

  if (requested === undefined || requested === 'up') {
    return 'up';
  }

  if (requested === 'down') {
    return 'down';
  }

  process.stderr.write(`Unknown direction "${requested}". Expected "up" or "down".\n`);
  process.exit(1);
}

async function connect(
  configuration: ReturnType<typeof loadConfiguration>['database'],
): Promise<{ client: pg.Client; close: () => Promise<void> }> {
  if (configuration.mode === 'url') {
    const client = new pg.Client({ connectionString: configuration.url });
    await client.connect();
    return { client, close: () => client.end() };
  }

  const connector = new Connector();
  const connectorOptions = await connector.getOptions({
    instanceConnectionName: configuration.instanceConnectionName,
    authType: AuthTypes.IAM,
    ipType: IpAddressTypes.PRIVATE,
  });

  const client = new pg.Client({
    ...connectorOptions,
    user: configuration.iamUser,
    database: configuration.databaseName,
  });
  await client.connect();

  return {
    client,
    close: async () => {
      await client.end();
      connector.close();
    },
  };
}

async function main(): Promise<void> {
  const configuration = (() => {
    try {
      return loadConfiguration();
    } catch (error) {
      const message = error instanceof ConfigurationError ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  })();

  const direction = resolveDirection(process.argv);
  const logger = createLogger(configuration, 'verdery-api-migrate');
  const { client, close } = await connect(configuration.database);

  try {
    const applied = await runner({
      dbClient: client,
      dir: MIGRATIONS_DIRECTORY,
      direction,
      migrationsTable: 'pgmigrations',
      logger: {
        info: (message) => logger.info({ event: 'migration.progress' }, message),
        warn: (message) => logger.warn({ event: 'migration.progress' }, message),
        error: (message) => logger.error({ event: 'migration.progress' }, message),
      },
    });

    logger.info(
      { event: 'migration.complete', direction, appliedCount: applied.length },
      `Applied ${String(applied.length)} migration(s) (${direction}).`,
    );
  } catch (error) {
    logger.error({ err: error, event: 'migration.failed' }, 'Migration failed.');
    process.exitCode = 1;
  } finally {
    await close();
  }
}

await main();
