/**
 * Full-stack integration tests for the sync PUSH boundary's own capability
 * assertion (P9A-SYNC-01, G-8 `docs/development/garden-capability-matrix.md`)
 * — real `SyncOperationRouter`, real membership grants via real
 * `CreateInvitation`/`AcceptInvitation`, against real PostgreSQL/PostGIS.
 *
 * `sync-operation-capability.test.ts` already pins the DECLARED capability
 * per family as a pure unit test; this file proves the router actually
 * ENFORCES it end to end — a viewer's push of a representative mutation from
 * every routed family is rejected, and an editor's/owner's legitimate push
 * still succeeds (the boundary check must not become a false-positive block
 * on top of the per-command checks that already pass).
 *
 * Source: docs/development/garden-capability-matrix.md, G-8;
 *         architecture/offline-synchronization.md, section "8. Push Protocol".
 */

import type { SyncOperation, SyncPushRequest } from '@verdery/api-contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness, syncActor } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'synchronization push authorization boundary integration';
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

function pushRequest(operation: SyncOperation): SyncPushRequest {
  return {
    clientInstallationId: generateUuidV7(),
    protocolVersion: 1,
    operationPayloadVersion: 1,
    operations: [operation],
  };
}

function renameGardenOperation(gardenId: string): SyncOperation {
  return {
    operationId: generateUuidV7(),
    localSequence: 0,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'garden',
      gardenId,
      command: { commandType: 'gardens.rename', expectedRevision: 1, request: { name: 'Renamed' } },
    },
  };
}

function createGardenObjectOperation(gardenId: string): SyncOperation {
  // Deliberately no `Geometry` (`@verdery/geometry-contracts`) type
  // annotation here: that type's `coordinates` are `readonly`, while the
  // wire `SyncGardenObjectOperationPayload.command` this literal is
  // contextually typed against expects mutable arrays — the exact,
  // already-documented divergence `route-garden-object-operation.ts`'s own
  // header comment resolves with a cast on the OTHER side (wire -> domain).
  // Left as a plain, contextually-typed literal here, matching the wire
  // shape directly rather than fighting it with a second cast.
  return {
    operationId: generateUuidV7(),
    localSequence: 0,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'gardenObject',
      gardenId,
      command: {
        type: 'createObject',
        objectId: generateUuidV7(),
        category: 'bed',
        geometry: {
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
        },
      },
    },
  };
}

function addPlantOperation(gardenId: string): SyncOperation {
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
        request: { displayName: 'Tomato', groupingKind: 'individual' },
      },
    },
  };
}

function recordObservationOperation(gardenId: string): SyncOperation {
  return {
    operationId: generateUuidV7(),
    localSequence: 0,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'observation',
      gardenId,
      command: {
        commandType: 'observations.record',
        observationId: generateUuidV7(),
        request: { photos: [], measurements: [], noteText: 'Looks healthy' },
      },
    },
  };
}

function createManualTaskOperation(gardenId: string): SyncOperation {
  return {
    operationId: generateUuidV7(),
    localSequence: 0,
    dependsOnOperationIds: [],
    mediaPrerequisites: [],
    payload: {
      recordType: 'task',
      gardenId,
      command: {
        commandType: 'tasks.createManualTask',
        taskId: generateUuidV7(),
        request: { target: { kind: 'garden' }, title: 'Water the beds' },
      },
    },
  };
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
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

  async function createGardenWithMember(now: Date, role: 'viewer' | 'editor') {
    const ownerId = generateUuidV7();
    const memberId = generateUuidV7();
    await insertProfile(db, ownerId);
    await insertProfile(db, memberId);

    const harness = buildSyncTestHarness(db, fixedClock(now));
    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    const invitation = await harness.createInvitation.execute(
      garden.id,
      ownerId,
      { intendedRole: role },
      generateUuidV7(),
    );
    await harness.acceptInvitation.execute(
      { profileId: memberId, email: undefined, emailVerified: false },
      invitation.token,
      generateUuidV7(),
    );

    return { ownerId, memberId, gardenId: garden.id };
  }

  const familyOperations: ReadonlyArray<{
    readonly name: string;
    readonly build: (gardenId: string) => SyncOperation;
  }> = [
    { name: 'garden (rename)', build: renameGardenOperation },
    { name: 'gardenObject (createObject)', build: createGardenObjectOperation },
    { name: 'plant (addPlant)', build: addPlantOperation },
    { name: 'observation (record)', build: recordObservationOperation },
    { name: 'task (createManualTask)', build: createManualTaskOperation },
  ];

  it.each(familyOperations)(
    "rejects a viewer's push of the $name family at the router boundary",
    async ({ build }) => {
      const now = new Date('2026-07-22T09:00:00Z');
      const { memberId, gardenId } = await createGardenWithMember(now, 'viewer');
      const harness = buildSyncTestHarness(db, fixedClock(now));

      const result = await harness.pushSyncOperations.execute(
        syncActor(memberId),
        pushRequest(build(gardenId)),
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ outcome: 'rejected' });
      const rejected = result.results[0];
      if (rejected === undefined || rejected.outcome !== 'rejected') {
        throw new Error('expected rejected');
      }
      expect(rejected.error.code).toBe('auth.forbidden');
    },
  );

  it("accepts an editor's push of a content-family mutation (editGardenContent families are not over-restricted by the boundary check)", async () => {
    const now = new Date('2026-07-22T09:10:00Z');
    const { memberId, gardenId } = await createGardenWithMember(now, 'editor');
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const result = await harness.pushSyncOperations.execute(
      syncActor(memberId),
      pushRequest(addPlantOperation(gardenId)),
    );

    expect(result.results[0]).toMatchObject({ outcome: 'accepted' });
  });

  it("rejects an editor's push of a garden-admin mutation (manageGarden, not editGardenContent)", async () => {
    const now = new Date('2026-07-22T09:15:00Z');
    const { memberId, gardenId } = await createGardenWithMember(now, 'editor');
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const result = await harness.pushSyncOperations.execute(
      syncActor(memberId),
      pushRequest(renameGardenOperation(gardenId)),
    );

    expect(result.results[0]).toMatchObject({ outcome: 'rejected' });
  });

  it('does not block gardens.create at the boundary — no membership exists yet to check against', async () => {
    const now = new Date('2026-07-22T09:20:00Z');
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const newGardenId = generateUuidV7();
    const operation: SyncOperation = {
      operationId: generateUuidV7(),
      localSequence: 0,
      dependsOnOperationIds: [],
      mediaPrerequisites: [],
      payload: {
        recordType: 'garden',
        gardenId: newGardenId,
        command: { commandType: 'gardens.create', request: { name: 'New Garden' } },
      },
    };

    const result = await harness.pushSyncOperations.execute(
      syncActor(ownerId),
      pushRequest(operation),
    );

    expect(result.results[0]).toMatchObject({ outcome: 'accepted' });
  });
});
