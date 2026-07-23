/**
 * "Process termination during push" (architecture/offline-synchronization.md,
 * section "24. Testing Matrix") for the server side of the protocol, against
 * real PostgreSQL/PostGIS.
 *
 * `push-sync-operations.ts`'s own header comment already documents the exact
 * exposure this test pins down: `PushSyncOperations.execute` persists the
 * sync-level idempotency record (`IdempotencyStore.save()`) AFTER the routed
 * domain command's own transaction has already committed, not inside it —
 * "a documented compromise, not an oversight," because extending every
 * sibling module's unit-of-work to accept an externally supplied,
 * cross-module write is exactly the kind of architecture change this
 * repository's rules require approval for. That comment's own claim is: "if
 * the process crashes between a routed command's commit and this module's
 * own `save()`... No mutation is ever double-applied; at worst the
 * *sync-level* bookkeeping of 'already told the client' is redone once."
 *
 * This test proves that claim directly rather than merely trusting the
 * comment: it simulates the crash by deleting the just-written
 * `platform.idempotency_record` row out from under a completed, accepted
 * push — the same end state a process death between the command's commit
 * and `save()` would leave — then resubmits the identical operationId and
 * payload.
 *
 * What actually keeps the retry safe turns out to be a SECOND, independent
 * layer this file's own initial draft had not accounted for, found while
 * writing this test: `route-garden-operation.ts`'s own header comment
 * documents that `operationId` is ALSO passed as `RenameGarden`'s own
 * `idempotencyKey` argument, "a second, independent layer of protection
 * against double-executing the same domain write, on top of (and orthogonal
 * to)" the sync-level one this test wipes. So the retry does NOT reach a
 * stale-`expectedRevision` conflict at all (there is a still-earlier guard
 * before that check would ever run) — `RenameGarden`'s own idempotency
 * check recognizes the same `(actorProfileId, 'gardens.rename',
 * operationId)` key from the first attempt and replays ITS OWN stored
 * `accepted` result rather than re-executing the rename. From
 * `PushSyncOperations`'s own now-amnesiac point of view this still looks
 * like a fresh `accepted` outcome (not relabeled `duplicate` — exactly what
 * the header comment's "delivered a second time as an ordinary
 * duplicate-shaped retry" describes), so this test's real assertion is on
 * the record's own untouched revision, not the wire outcome label: the
 * rename is never actually re-applied.
 *
 * A separate file from `synchronization.test.ts` (which already covers the
 * ordinary, idempotency-record-intact duplicate-resubmission case) rather
 * than an addition to it, for this repository's own file-size discipline and
 * to keep "the idempotency record survived" and "the idempotency record was
 * lost to a crash" as two clearly distinct scenarios, not two branches of
 * one test.
 *
 * Source: architecture/offline-synchronization.md, section "9. Server
 * Idempotency" ("An unknown client response after a network failure is
 * resolved by retrying the same operation ID"); `push-sync-operations.ts`.
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
import { SYNC_PUSH_OPERATION } from '../../src/modules/synchronization/application/sync-push-idempotency.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'synchronization crash recovery (process termination during push)';
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
  operationId: string,
): SyncOperation {
  return {
    operationId,
    localSequence: 0,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'garden',
      gardenId,
      command: { commandType: 'gardens.rename', expectedRevision, request: { name } },
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

  it("a retry after the sync-level idempotency record is lost (simulating a crash between the command commit and IdempotencyStore.save) never double-applies the mutation, protected by the domain command's own independent idempotency layer", async () => {
    const now = new Date('2026-07-21T11:20:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));
    const operationId = generateUuidV7();
    const operation = renameGardenOperation(gardenId, 1, 'Sunroom', operationId);

    const first = await harness.pushSyncOperations.execute(ownerId, pushRequest([operation]));
    expect(first.results[0]).toMatchObject({
      outcome: 'accepted',
      recordRevisions: [{ recordType: 'garden', recordId: gardenId, revision: 2 }],
    });

    // Simulate "the process died after the rename's own transaction
    // committed but before PushSyncOperations.execute ever reached its own
    // IdempotencyStore.save() call" — the exact window push-sync-
    // operations.ts's own header comment names — by deleting the row that
    // `save()` would have written, out from under an otherwise-complete,
    // accepted push. A real crash could not leave any other observable
    // state: `save()` is the very last thing `execute()` does for a durable
    // outcome, so "the domain write committed, the bookkeeping row does
    // not exist" is the full and only intermediate state to reproduce.
    const deleted = await db
      .deleteFrom('platform.idempotency_record')
      .where('actor_profile_id', '=', ownerId)
      .where('operation', '=', SYNC_PUSH_OPERATION)
      .where('idempotency_key', '=', operationId)
      .executeTakeFirst();
    expect(Number(deleted.numDeletedRows)).toBe(1);

    // The client, having never received (or trusted) a response, retries
    // with the identical operationId and payload — exactly what section "9.
    // Server Idempotency" prescribes ("An unknown client response after a
    // network failure is resolved by retrying the same operation ID"). With
    // no memory of the first attempt at the SYNC level, this re-enters the
    // router — but `RenameGarden`'s own internal idempotency layer (keyed by
    // the same `operationId`, per `route-garden-operation.ts`'s own header
    // comment) still remembers it, and replays its own stored `accepted`
    // result instead of re-executing the rename.
    const retry = await harness.pushSyncOperations.execute(ownerId, pushRequest([operation]));

    // The wire outcome reads as an ordinary `accepted` (the sync layer has
    // no memory of the first attempt, so it cannot relabel this a
    // `duplicate` the way `synchronization.test.ts`'s own intact-bookkeeping
    // case does) — but crucially, still revision 2, the SAME revision the
    // first attempt already produced. If the rename had genuinely
    // re-executed, this would read revision 3.
    expect(retry.results[0]).toMatchObject({
      outcome: 'accepted',
      recordRevisions: [{ recordType: 'garden', recordId: gardenId, revision: 2 }],
    });

    // The mutation itself was never re-applied: still revision 2, still
    // named "Sunroom" — not a third rename, not a corrupted intermediate
    // state. This is the test's real proof of "no mutation is ever
    // double-applied," independent of how the wire outcome happens to be
    // labeled.
    const garden = await harness.gardenRepository.findById(gardenId);
    expect(garden).toMatchObject({ revision: 2, name: 'Sunroom' });
  });
});
