/**
 * The content freeze a garden deletion request opens (P8-DELETE-01):
 * architecture/data-export-and-deletion.md section 10.3, "marks deletion
 * requested and REVOKES NEW EDITS".
 *
 * The freeze is enforced in exactly one place —
 * `GardenAuthorization.requireCapability`, which refuses the
 * `editGardenContent` capability once a garden is `deletion_requested` or
 * `purging` — so this suite proves the consequence at the boundary that
 * matters: real commands from every module that writes garden content, against
 * a real migrated database, plus the four things the freeze must NOT break.
 *
 * What it covers, and why each one is here rather than assumed:
 *
 * - One refused mutation per module (gardens-mapping map objects and
 *   calibration, plants-inventory, observations-history,
 *   tasks-recommendations, media). Unit tests prove the matrix; only this
 *   proves each module's command actually consults it.
 * - Reads and garden export still succeed. A recovery window in which the
 *   owner cannot see or take a copy of what they are about to lose is not a
 *   recovery window (section 10.4).
 * - Restore still succeeds, and the same write that was refused succeeds
 *   afterwards — proving the refusal was the lifecycle state and nothing else.
 * - `purging` refuses export too, unlike `deletion_requested`: past the
 *   sweep's claim the purge has already closed the garden's active export
 *   requests, so a new one would outlive the garden row it points at.
 * - The purge sweep still purges. The purge writes through its own executor,
 *   never through `GardenAuthorization`, and this is what keeps that true.
 * - An offline edit replayed into a garden marked for deletion since it was
 *   queued comes back `rejected`, not `conflict` and not `retryLater` — the
 *   one classification a client treats as terminal, so it is dropped rather
 *   than retried forever (architecture/offline-synchronization.md, section
 *   "9. Server Idempotency").
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { GardenErrorCode } from '@verdery/api-contracts';
import type { SyncOperation, SyncPushRequest } from '@verdery/api-contracts';
import type { Geometry } from '@verdery/geometry-contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { RegisterMediaUpload } from '../../src/modules/media/public.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { buildDeletionTestHarness, MovableClock } from '../support/deletion-test-harness.js';
import type { DeletionTestHarness } from '../support/deletion-test-harness.js';
import { actorFor, buildExportHarness } from '../support/export-test-harness.js';
import type { ExportHarness } from '../support/export-test-harness.js';
import { buildSyncTestHarness, syncActor } from '../support/sync-test-harness.js';

const SUITE_NAME = 'garden content freeze during deletion integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const START = new Date('2026-07-25T09:00:00Z');

const BED_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ],
  ],
};

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
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
  let db: Kysely<DatabaseSchema>;
  let clock: MovableClock;
  let sync: ReturnType<typeof buildSyncTestHarness>;
  let deletion: DeletionTestHarness;
  let exports: ExportHarness;
  let registerMediaUpload: RegisterMediaUpload;

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

    db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
    });
    clock = new MovableClock(START);
    sync = buildSyncTestHarness(db, clock);
    deletion = buildDeletionTestHarness(db, clock);
    exports = buildExportHarness(db, clock);
    registerMediaUpload = new RegisterMediaUpload(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      sync.gardenAuthorization,
      new FakeMediaStorageGateway(),
      TEST_BUCKETS,
      clock,
    );
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  interface GardenFixture {
    readonly ownerId: string;
    readonly gardenId: string;
    readonly revision: number;
  }

  async function activeGarden(name: string): Promise<GardenFixture> {
    const ownerId = generateUuidV7();
    await db
      .insertInto('identity_access.profile')
      .values({ id: ownerId, firebase_uid: `firebase-${ownerId}`, account_state: 'active' })
      .execute();
    const garden = await sync.createGarden.execute(ownerId, name, generateUuidV7());
    return { ownerId, gardenId: garden.id, revision: garden.revision };
  }

  async function gardenPendingDeletion(name: string): Promise<GardenFixture> {
    const garden = await activeGarden(name);
    const requested = await deletion.requestGardenDeletion.execute(
      garden.gardenId,
      { profileId: garden.ownerId, authenticatedAt: clock.now() },
      garden.revision,
      generateUuidV7(),
    );
    return { ...garden, revision: requested.revision };
  }

  /** Every module that writes garden content, one representative command each. */
  function contentMutations(
    garden: GardenFixture,
  ): readonly (readonly [string, () => Promise<unknown>])[] {
    const { gardenId, ownerId } = garden;
    return [
      [
        'gardens-mapping / map object',
        () =>
          sync.createMapObject.execute(
            gardenId,
            ownerId,
            {
              type: 'createObject',
              objectId: generateUuidV7(),
              category: 'bed',
              geometry: BED_POLYGON,
              categoryDetails: { category: 'bed', details: { bedKind: 'raised' } },
            },
            generateUuidV7(),
          ),
      ],
      [
        'gardens-mapping / calibration',
        () =>
          sync.upsertMapCalibration.execute(
            gardenId,
            ownerId,
            {
              type: 'upsertCalibration',
              backgroundObjectId: generateUuidV7(),
              expectedRevision: 1,
              pageAspectRatio: 1,
              knownDistance: { pointA: [0, 0], pointB: [1, 0], distanceMetres: 10 },
              referencePoints: [],
            },
            generateUuidV7(),
          ),
      ],
      [
        'plants-inventory',
        () =>
          sync.addPlant.execute(
            gardenId,
            ownerId,
            { displayName: 'Tomato', groupingKind: 'individual' },
            generateUuidV7(),
          ),
      ],
      [
        'observations-history',
        () =>
          sync.recordObservation.execute(
            gardenId,
            ownerId,
            {
              plantId: null,
              gardenObjectId: null,
              noteText: 'Leaves look healthy.',
              conditionSummary: null,
              observedAt: null,
              photos: [],
              measurements: [],
              observedPhenologicalStage: null,
            },
            generateUuidV7(),
          ),
      ],
      [
        'tasks-recommendations',
        () =>
          sync.createManualTask.execute(
            gardenId,
            ownerId,
            { target: { kind: 'garden' }, title: 'Water the whole garden' },
            generateUuidV7(),
          ),
      ],
      [
        'media',
        () =>
          registerMediaUpload.execute(
            gardenId,
            ownerId,
            {
              mediaClass: 'garden_photo',
              displayFilename: 'photo.jpg',
              declaredContentType: 'image/jpeg',
              declaredByteSize: 123_456,
            },
            randomUUID(),
          ),
      ],
    ];
  }

  it('refuses a content mutation from every module once deletion is requested', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Frozen Garden');

    for (const [label, attempt] of contentMutations(garden)) {
      await expect(attempt(), label).rejects.toMatchObject({
        code: GardenErrorCode.LifecycleConflict,
        category: 'domainRuleViolated',
      });
    }
  });

  it('refuses the same mutations once the sweep has claimed the garden for purging', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Purging Garden');
    await sql`
      UPDATE gardens_mapping.garden SET lifecycle_state = 'purging' WHERE id = ${garden.gardenId}
    `.execute(db);

    for (const [label, attempt] of contentMutations(garden)) {
      await expect(attempt(), label).rejects.toMatchObject({
        code: GardenErrorCode.LifecycleConflict,
      });
    }
  });

  it('keeps the garden readable and exportable throughout the recovery window', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Readable Garden');

    await expect(sync.getGarden.execute(garden.gardenId, garden.ownerId)).resolves.toMatchObject({
      id: garden.gardenId,
      lifecycleState: 'deletionRequested',
    });

    await expect(
      exports.requestExport.execute(
        actorFor(garden.ownerId, clock.now()),
        { scope: 'garden', gardenId: garden.gardenId, includeMedia: false },
        generateUuidV7(),
      ),
    ).resolves.toMatchObject({ scope: 'garden', gardenId: garden.gardenId });
  });

  it('refuses a new export once the garden is purging, when its active exports have already been closed', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Unexportable Garden');
    await sql`
      UPDATE gardens_mapping.garden SET lifecycle_state = 'purging' WHERE id = ${garden.gardenId}
    `.execute(db);

    // Reads survive even here: only the write-shaped capabilities are refused.
    await expect(sync.getGarden.execute(garden.gardenId, garden.ownerId)).resolves.toMatchObject({
      id: garden.gardenId,
    });

    await expect(
      exports.requestExport.execute(
        actorFor(garden.ownerId, clock.now()),
        { scope: 'garden', gardenId: garden.gardenId, includeMedia: false },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({ code: GardenErrorCode.LifecycleConflict });
  });

  it('restores the garden and unfreezes exactly the mutation the freeze refused', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Recovered Garden');

    await expect(
      sync.addPlant.execute(
        garden.gardenId,
        garden.ownerId,
        { displayName: 'Basil', groupingKind: 'individual' },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({ code: GardenErrorCode.LifecycleConflict });

    const restored = await deletion.restoreGardenDeletion.execute(
      garden.gardenId,
      { profileId: garden.ownerId, authenticatedAt: clock.now() },
      garden.revision,
      generateUuidV7(),
    );
    expect(restored).toMatchObject({ lifecycleState: 'active' });

    await expect(
      sync.addPlant.execute(
        garden.gardenId,
        garden.ownerId,
        { displayName: 'Basil', groupingKind: 'individual' },
        generateUuidV7(),
      ),
    ).resolves.toMatchObject({ displayName: 'Basil' });
  });

  it('lets the purge finish its own writes — the freeze never applies to the sweep', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Swept Garden');

    clock.advanceDays(31);
    const result = await deletion.runDeletionSweep.execute();
    expect(result.gardensClaimed).toBeGreaterThanOrEqual(1);

    await expect(deletion.gardens.findById(garden.gardenId)).resolves.toBeNull();
  });

  it('classifies a replayed offline edit as rejected, the one outcome a client never retries', async () => {
    clock.set(START);
    const garden = await gardenPendingDeletion('Offline Garden');

    const result = await sync.pushSyncOperations.execute(
      syncActor(garden.ownerId),
      pushRequest([addPlantOperation(garden.gardenId, 'Queued Offline')]),
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      outcome: 'rejected',
      error: { code: GardenErrorCode.LifecycleConflict },
    });
  });
});
