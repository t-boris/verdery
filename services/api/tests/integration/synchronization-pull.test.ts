/**
 * Full-stack integration tests for `GET /v1/sync/changes` (P5-BE-02) against
 * real PostgreSQL/PostGIS — the real `GetSyncChanges`, real sibling-module
 * `Get*` readers, real `platform.sync_change` rows written by real command
 * classes. Split out from `tests/integration/synchronization.test.ts` (push/
 * acknowledge/registration) purely to keep both files well under the
 * repository's 600-line limit, mirroring `map-objects.test.ts`/
 * `map-objects-relationships.test.ts`'s own split.
 *
 * Covers: an initial pull (`after` omitted) returning upsert changes across
 * two record families with full current snapshots; incremental resumption
 * from a previous page's `nextCursor`; authorization filtering excluding a
 * garden the profile has no membership on; a `gardenObject` delete tombstone
 * carrying no `record` payload; `nextCursor` present on an empty page;
 * `sync.protocol_version.unsupported`; `sync.changes.cursor_expired`; and the
 * garden-revocation-tombstone visibility rule (exercised directly against
 * `collaboration.membership`/`platform.sync_change`, since no command in
 * this codebase produces a real revocation today — see
 * `get-sync-changes.ts`'s own header comment).
 *
 * Source: migrations/1785000000000_synchronization-baseline.sql;
 *         architecture/offline-synchronization.md, sections "10. Pull
 *         Protocol", "11. Authorization Changes", "13. Full
 *         Resynchronization", "17. Deletion and Tombstones";
 *         architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import type { SyncChangesResult } from '@verdery/api-contracts';
import type { Geometry } from '@verdery/geometry-contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { encodeSyncChangesCursor } from '../../src/modules/synchronization/public.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'synchronization pull integration';
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

  it('returns upsert changes across two record families on an initial pull, each carrying the current record', async () => {
    const now = new Date('2026-07-21T10:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    await harness.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );

    const result: SyncChangesResult = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    // Garden creation (revision 1) and the plant just added — deterministic
    // sequence order.
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      recordType: 'garden',
      operation: 'upsert',
      recordId: gardenId,
      record: { recordType: 'garden', data: { id: gardenId, revision: 1 } },
    });
    expect(result.items[1]).toMatchObject({
      recordType: 'plant',
      operation: 'upsert',
      record: { recordType: 'plant', data: { displayName: 'Tomato' } },
    });
    expect(typeof result.nextCursor).toBe('string');
  });

  it('resumes strictly after a previous page nextCursor, never re-delivering an already-pulled change', async () => {
    const now = new Date('2026-07-21T10:05:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const first = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(first.items).toHaveLength(1);

    await harness.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Basil', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );

    const second = await harness.getSyncChanges.execute(ownerId, {
      after: first.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ recordType: 'plant', operation: 'upsert' });
  });

  it('never surfaces a change for a garden the profile has no membership on', async () => {
    const now = new Date('2026-07-21T10:10:00Z');
    const { gardenId: otherGardenId } = await createGardenWithOwner(now);

    const outsiderId = generateUuidV7();
    await insertProfile(db, outsiderId);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const result = await harness.getSyncChanges.execute(outsiderId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    expect(result.items).toHaveLength(0);
    expect(result.items.every((item) => item.gardenId !== otherGardenId)).toBe(true);
    expect(typeof result.nextCursor).toBe('string');
  });

  it('delivers a gardenObject delete tombstone with no record payload', async () => {
    const now = new Date('2026-07-21T10:15:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const bedPolygon: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    };

    const created = await harness.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: generateUuidV7(), category: 'bed', geometry: bedPolygon },
      generateUuidV7(),
    );
    const objectId = created.affectedObjects[0]?.id;
    if (objectId === undefined) {
      throw new Error('expected an affected object');
    }

    await harness.deleteMapObject.execute(
      gardenId,
      ownerId,
      { type: 'deleteObject', objectId, expectedRevision: 1 },
      generateUuidV7(),
    );

    const result = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    const tombstone = result.items.find(
      (item) => item.recordType === 'gardenObject' && item.operation === 'delete',
    );
    expect(tombstone).toBeDefined();
    expect(tombstone).not.toHaveProperty('record');
  });

  it('rejects protocolVersion below the supported window with sync.protocol_version.unsupported', async () => {
    const now = new Date('2026-07-21T10:20:00Z');
    const { ownerId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    await expect(
      harness.getSyncChanges.execute(ownerId, { after: null, limit: 50, protocolVersion: 0 }),
    ).rejects.toMatchObject({ code: 'sync.protocol_version.unsupported' });
  });

  it('rejects a cursor older than the retention window with sync.changes.cursor_expired', async () => {
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const staleCursor = encodeSyncChangesCursor({ afterSequence: 0, issuedAt });
    const farFuture = new Date('2026-12-01T00:00:00Z');

    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);
    const harness = buildSyncTestHarness(db, fixedClock(farFuture));

    await expect(
      harness.getSyncChanges.execute(ownerId, {
        after: staleCursor,
        limit: 50,
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'sync.changes.cursor_expired' });
  });

  it('surfaces a garden removal tombstone despite the profile no longer having active membership, without leaking that garden ordinary upserts', async () => {
    const now = new Date('2026-07-21T10:25:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    // No command in this codebase revokes membership today (see
    // `get-sync-changes.ts`'s own header comment) — this test exercises the
    // pull-side machinery directly against the two tables a real future
    // revocation command would write to, the same shape
    // `delete-map-object.ts` already establishes for every other tombstone.
    await db
      .updateTable('collaboration.membership')
      .set({ state: 'removed' })
      .where('garden_id', '=', gardenId)
      .where('profile_id', '=', ownerId)
      .execute();
    await db
      .insertInto('platform.sync_change')
      .values({
        garden_id: gardenId,
        record_id: gardenId,
        record_type: 'garden',
        operation: 'delete',
        record_revision: 1,
      })
      .execute();

    const result = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    // Only the tombstone — not the garden's own earlier `upsert` (revision 1
    // at creation), which a revoked profile must no longer see.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      recordType: 'garden',
      operation: 'delete',
      gardenId,
    });
    expect(result.items[0]).not.toHaveProperty('record');
  });
});
