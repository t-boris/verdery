/**
 * Full-stack integration tests for the synchronization module against real
 * PostgreSQL/PostGIS: real sibling-module command classes routed through the
 * real `SyncOperationRouter`, the real `KyselyIdempotencyStore` — not fakes.
 * Mirrors the rigor of `tests/integration/tasks-recommendations.test.ts`.
 *
 * Covers: a push batch mixing two record-type families succeeding together;
 * a stale-revision conflict on one operation not blocking an independent
 * sibling operation in the same batch; a dependency-blocked operation when
 * its declared dependency itself fails; resubmitting the exact same
 * operationId+payload replaying the stored `duplicate` outcome without
 * re-executing the domain command (proven by an unchanged revision);
 * resubmitting the same operationId with a different payload being
 * rejected; and `acknowledge` returning a stored outcome for a
 * previously-pushed operationId and `unknown` for one never submitted.
 *
 * Source: migrations/1785000000000_synchronization-baseline.sql;
 *         architecture/offline-synchronization.md;
 *         architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import type { SyncOperation, SyncPushRequest } from '@verdery/api-contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'synchronization integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
}

function renameGardenOperation(
  gardenId: string,
  expectedRevision: number,
  name: string,
  operationId: string = generateUuidV7(),
  dependsOnOperationIds: readonly string[] = [],
): SyncOperation {
  return {
    operationId,
    localSequence: 0,
    dependsOnOperationIds: [...dependsOnOperationIds],
    mediaPrerequisites: [],
    payload: {
      recordType: 'garden',
      gardenId,
      command: { commandType: 'gardens.rename', expectedRevision, request: { name } },
    },
  };
}

function addPlantOperation(gardenId: string, displayName: string): SyncOperation {
  return {
    operationId: generateUuidV7(),
    localSequence: 0,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'plant',
      gardenId,
      command: {
        commandType: 'plants.addPlant',
        plantId: generateUuidV7(),
        request: { displayName, groupingKind: 'individual' },
      },
    },
  };
}

function pushRequest(operations: readonly SyncOperation[]): SyncPushRequest {
  return {
    clientInstallationId: generateUuidV7(),
    protocolVersion: 1,
    operationPayloadVersion: 1,
    operations: [...operations],
  };
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function createGardenWithOwner(now: Date) {
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);

    const harness = buildSyncTestHarness(db, fixedClock(now));
    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    return { ownerId, gardenId: garden.id };
  }

  it('accepts a batch mixing two record-type families in the same push', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const result = await harness.pushSyncOperations.execute(
      ownerId,
      pushRequest([
        renameGardenOperation(gardenId, 1, 'Front Yard'),
        addPlantOperation(gardenId, 'Tomato'),
      ]),
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      outcome: 'accepted',
      recordRevisions: [{ recordType: 'garden', recordId: gardenId, revision: 2 }],
    });
    expect(result.results[1]).toMatchObject({ outcome: 'accepted' });
    const plantResult = result.results[1];
    if (plantResult === undefined || plantResult.outcome !== 'accepted') {
      throw new Error('expected accepted');
    }
    expect(plantResult.recordRevisions).toEqual([
      { recordType: 'plant', recordId: plantResult.recordRevisions[0]?.recordId, revision: 1 },
    ]);
  });

  it('does not let a stale-revision conflict on one operation block an independent sibling operation', async () => {
    const now = new Date('2026-07-21T09:05:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const result = await harness.pushSyncOperations.execute(
      ownerId,
      pushRequest([
        renameGardenOperation(gardenId, 99, 'Stale Rename'),
        addPlantOperation(gardenId, 'Basil'),
      ]),
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ outcome: 'conflict' });
    const conflictResult = result.results[0];
    if (conflictResult === undefined || conflictResult.outcome !== 'conflict') {
      throw new Error('expected conflict');
    }
    expect(typeof conflictResult.conflictCode).toBe('string');
    expect(conflictResult.currentRecord).toMatchObject({
      recordType: 'garden',
      data: { id: gardenId, revision: 1 },
    });
    expect(result.results[1]).toMatchObject({ outcome: 'accepted' });
  });

  it('blocks an operation whose declared dependency fails in the same batch', async () => {
    const now = new Date('2026-07-21T09:10:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const failingRename = renameGardenOperation(gardenId, 99, 'Stale Rename');
    const dependentAddPlant: SyncOperation = {
      ...addPlantOperation(gardenId, 'Mint'),
      dependsOnOperationIds: [failingRename.operationId],
    };

    const result = await harness.pushSyncOperations.execute(
      ownerId,
      pushRequest([failingRename, dependentAddPlant]),
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ outcome: 'conflict' });
    expect(result.results[1]).toMatchObject({
      outcome: 'blockedByDependency',
      blockingOperationIds: [failingRename.operationId],
    });

    // The blocked operation never reached the router — no plant was created.
    const plants = await db
      .selectFrom('plants_inventory.plant')
      .select('id')
      .where('garden_id', '=', gardenId)
      .execute();
    expect(plants).toHaveLength(0);
  });

  it('replays the stored duplicate outcome for a resubmitted operationId+payload without re-executing the command', async () => {
    const now = new Date('2026-07-21T09:15:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));
    const operation = renameGardenOperation(gardenId, 1, 'Sunroom');

    const first = await harness.pushSyncOperations.execute(ownerId, pushRequest([operation]));
    expect(first.results[0]).toMatchObject({
      outcome: 'accepted',
      recordRevisions: [{ recordType: 'garden', recordId: gardenId, revision: 2 }],
    });

    const second = await harness.pushSyncOperations.execute(ownerId, pushRequest([operation]));
    expect(second.results[0]).toMatchObject({
      outcome: 'duplicate',
      operationId: operation.operationId,
      recordRevisions: [{ recordType: 'garden', recordId: gardenId, revision: 2 }],
    });

    // Proof the domain command did not re-run: the garden's own revision
    // stayed at 2, not 3.
    const garden = await harness.gardenRepository.findById(gardenId);
    expect(garden?.revision).toBe(2);
  });

  it('rejects a resubmitted operationId used with a different payload', async () => {
    const now = new Date('2026-07-21T09:20:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));
    const operationId = generateUuidV7();

    const first = await harness.pushSyncOperations.execute(
      ownerId,
      pushRequest([renameGardenOperation(gardenId, 1, 'Sunroom', operationId)]),
    );
    expect(first.results[0]).toMatchObject({ outcome: 'accepted' });

    const second = await harness.pushSyncOperations.execute(
      ownerId,
      pushRequest([renameGardenOperation(gardenId, 1, 'Different Name', operationId)]),
    );
    expect(second.results[0]).toMatchObject({
      outcome: 'rejected',
      operationId,
      error: { code: 'request.idempotency.key_reused' },
    });

    // The original acceptance is untouched — still revision 2 named "Sunroom".
    const garden = await harness.gardenRepository.findById(gardenId);
    expect(garden).toMatchObject({ revision: 2, name: 'Sunroom' });
  });

  it('acknowledge returns the stored outcome for a pushed operation and unknown for one never submitted', async () => {
    const now = new Date('2026-07-21T09:25:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));
    const operation = renameGardenOperation(gardenId, 1, 'Conservatory');

    await harness.pushSyncOperations.execute(ownerId, pushRequest([operation]));

    const neverPushedOperationId = generateUuidV7();
    const acknowledged = await harness.acknowledgeSyncOperations.execute(ownerId, {
      clientInstallationId: generateUuidV7(),
      operationIds: [operation.operationId, neverPushedOperationId],
    });

    expect(acknowledged.results).toHaveLength(2);
    expect(acknowledged.results[0]).toMatchObject({
      outcome: 'accepted',
      operationId: operation.operationId,
      recordRevisions: [{ recordType: 'garden', recordId: gardenId, revision: 2 }],
    });
    expect(acknowledged.results[1]).toEqual({
      outcome: 'unknown',
      operationId: neverPushedOperationId,
    });
  });

  it('registers a new client installation and refreshes it on a second call', async () => {
    const now = new Date('2026-07-21T09:30:00Z');
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);
    const harness = buildSyncTestHarness(db, fixedClock(now));
    const clientInstallationId = generateUuidV7();

    const created = await harness.registerSyncClient.execute(
      clientInstallationId,
      ownerId,
      { platform: 'ios', appVersion: '1.0.0', protocolVersion: 1 },
      generateUuidV7(),
    );
    expect(created.statusCode).toBe(201);
    expect(created.installation).toMatchObject({ id: clientInstallationId, platform: 'ios' });

    const refreshed = await harness.registerSyncClient.execute(
      clientInstallationId,
      ownerId,
      { platform: 'ios', appVersion: '1.1.0', protocolVersion: 1 },
      generateUuidV7(),
    );
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.installation).toMatchObject({ id: clientInstallationId, appVersion: '1.1.0' });
    expect(refreshed.installation.registeredAt).toBe(created.installation.registeredAt);
  });

  it('rejects registration below the supported protocol version window', async () => {
    const now = new Date('2026-07-21T09:35:00Z');
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    // Below the wire schema's own `minimum: 1` — unreachable through real
    // HTTP request parsing today (see `tests/http/sync-routes.test.ts`'s own
    // comment), but this proves the command's own guard rejects it directly.
    await expect(
      harness.registerSyncClient.execute(
        generateUuidV7(),
        ownerId,
        { platform: 'ios', appVersion: '1.0.0', protocolVersion: 0 },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({ code: 'sync.protocol_version.unsupported' });
  });
});
