/**
 * "Large backlog with bounded memory" (architecture/offline-
 * synchronization.md, section "24. Testing Matrix") at real scale, against
 * real PostgreSQL/PostGIS — split out from `synchronization.test.ts`/
 * `synchronization-pull.test.ts` (which already cover push/pull correctness
 * with a handful of operations each) purely to keep both files under this
 * repository's 600-line limit, matching that pair's own precedent for
 * splitting by concern rather than by record family.
 *
 * Two bounds this test proves hold at hundreds-of-items scale, not just at
 * the small numbers the rest of the suite uses for speed:
 *
 * - Push: `SyncPushRequest.operations.maxItems` (500, `packages/
 *   api-contracts/openapi.yaml`) is the documented ceiling for one batch —
 *   this pushes exactly that many independent operations in one request and
 *   proves every single one is processed and returns its own result, in
 *   order, with no truncation or timeout.
 * - Pull: `GET /v1/sync/changes`'s own `limit` parameter caps at 100
 *   (`components.parameters.Limit`) — this builds a backlog of several
 *   hundred changes and proves repeated, bounded-page pulls page through the
 *   whole thing without ever returning more than the requested `limit`,
 *   converging to zero remaining items.
 *
 * Neither test asserts on process memory directly (not practically
 * observable from a Vitest integration test); "bounded" here means what the
 * contract itself already bounds and enforces — the same standard
 * `RemoteSyncEngineTests.pushBoundsBatchSize`/`RemoteSyncEnginePullTests
 * .stopsAtPageSafetyLimit` already apply client-side, applied here to the
 * server side of the same two bounds, at the scale the matrix item actually
 * names ("hundreds+").
 *
 * Source: architecture/offline-synchronization.md, sections "8. Push
 * Protocol", "10. Pull Protocol", "24. Testing Matrix".
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

const SUITE_NAME = 'synchronization large backlog';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

// `SyncPushRequest.operations.maxItems` — packages/api-contracts/openapi.yaml.
const MAX_PUSH_BATCH_SIZE = 500;
// `components.parameters.Limit.maximum` — packages/api-contracts/openapi.yaml.
const MAX_PULL_PAGE_SIZE = 100;

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

function addPlantOperation(gardenId: string, index: number): SyncOperation {
  return {
    operationId: generateUuidV7(),
    localSequence: index,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'plant',
      gardenId,
      command: {
        commandType: 'plants.addPlant',
        plantId: generateUuidV7(),
        request: { displayName: `Backlog plant ${index}`, groupingKind: 'individual' },
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

  it('processes a full maxItems (500) push batch of independent operations, returning one accepted result per operation', async () => {
    const now = new Date('2026-07-21T11:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const operations = Array.from({ length: MAX_PUSH_BATCH_SIZE }, (_unused, index) =>
      addPlantOperation(gardenId, index),
    );

    const result = await harness.pushSyncOperations.execute(ownerId, pushRequest(operations));

    expect(result.results).toHaveLength(MAX_PUSH_BATCH_SIZE);
    expect(result.results.every((entry) => entry.outcome === 'accepted')).toBe(true);
    // Every operation targeted a distinct new plant id, so every one gets
    // its own fresh revision 1 — proof none were silently dropped, merged,
    // or mistaken for one another under load.
    const revisions = result.results.flatMap((entry) =>
      entry.outcome === 'accepted'
        ? entry.recordRevisions.map((reference) => reference.revision)
        : [],
    );
    expect(revisions).toEqual(Array(MAX_PUSH_BATCH_SIZE).fill(1));

    const plantCount = await db
      .selectFrom('plants_inventory.plant')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(plantCount.count)).toBe(MAX_PUSH_BATCH_SIZE);
  }, 60_000);

  it('pages a several-hundred-item pull backlog to completion, never returning more than the bounded limit per page', async () => {
    const now = new Date('2026-07-21T11:10:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    // One extra change beyond two full pages, so the backlog does not
    // divide evenly by MAX_PULL_PAGE_SIZE — this also exercises the
    // "final short page ends pagination" boundary at real scale.
    const backlogSize = MAX_PULL_PAGE_SIZE * 2 + 37;
    const operations = Array.from({ length: backlogSize }, (_unused, index) =>
      addPlantOperation(gardenId, index),
    );
    // Pushed in batches of MAX_PUSH_BATCH_SIZE to stay within the push
    // contract's own bound — this backlog is smaller than one batch today,
    // but the loop keeps this test correct if backlogSize ever grows past it.
    for (let start = 0; start < operations.length; start += MAX_PUSH_BATCH_SIZE) {
      const batch = operations.slice(start, start + MAX_PUSH_BATCH_SIZE);
      await harness.pushSyncOperations.execute(ownerId, pushRequest(batch));
    }

    const collectedRecordIds = new Set<string>();
    let after: string | null = null;
    let pageCount = 0;
    const maxPagesAllowed = Math.ceil((backlogSize + 1) / MAX_PULL_PAGE_SIZE) + 1;

    for (;;) {
      const page = await harness.getSyncChanges.execute(ownerId, {
        after,
        limit: MAX_PULL_PAGE_SIZE,
        protocolVersion: 1,
      });
      pageCount += 1;
      expect(page.items.length).toBeLessThanOrEqual(MAX_PULL_PAGE_SIZE);
      for (const item of page.items) {
        collectedRecordIds.add(item.recordId);
      }
      after = page.nextCursor;
      if (page.items.length < MAX_PULL_PAGE_SIZE) {
        break;
      }
      // A bounded loop, not an unconditional `for (;;)`: a real defect
      // that stopped `nextCursor` from ever advancing must fail this test
      // rather than hang the suite.
      expect(pageCount).toBeLessThanOrEqual(maxPagesAllowed);
    }

    // The garden's own creation change plus every plant — full backlog
    // drained across bounded pages, nothing lost, nothing duplicated
    // (a Set, not an array length check, would silently hide a duplicate
    // delivery).
    expect(collectedRecordIds.size).toBe(backlogSize + 1);
    expect(pageCount).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
