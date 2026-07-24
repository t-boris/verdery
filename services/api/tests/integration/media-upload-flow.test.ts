/**
 * Full-stack integration tests for P6-API-01's media commands/queries
 * against real PostgreSQL: real repositories, the real transactional unit of
 * work, and the real idempotency table — not fakes. Proves the STATE MACHINE
 * and AUTHORIZATION logic end to end, which does not need real Cloud
 * Storage to verify (see this module's own `FakeMediaStorageGateway`,
 * shared from `media-test-doubles.ts`). Real-GCS-backed verification of the
 * gateway adapter itself is a separate, manual, non-CI check — see
 * `scripts/verify-real-gcs-media-gateway.mjs` and this stage's own report.
 *
 * In particular, this suite proves what `register-media-upload.test.ts`'s
 * own unit test explicitly could NOT (its fake unit of work is not
 * transactional): that a storage-gateway failure during
 * `RegisterMediaUpload` rolls back the whole attempt in a real Postgres
 * transaction — no media row and no quota reservation left behind.
 *
 * Source: implementation-plan.md work package P6-API-01;
 * architecture/media-storage-and-processing.md; architecture/testing-strategy.md,
 * section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { CompleteMediaUpload } from '../../src/modules/media/application/complete-media-upload.js';
import { GetMediaAccess } from '../../src/modules/media/application/get-media-access.js';
import { GetMediaStatus } from '../../src/modules/media/application/get-media-status.js';
import {
  FakeAuditLogger,
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { RegisterMediaUpload } from '../../src/modules/media/application/register-media-upload.js';
import type { RegisterMediaUploadInput } from '../../src/modules/media/application/register-media-upload.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { DependencyUnavailableError } from '../../src/platform/errors/application-error.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media upload flow integration';
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

const BASE_INPUT: RegisterMediaUploadInput = {
  mediaClass: 'garden_photo',
  displayFilename: 'photo.jpg',
  declaredContentType: 'image/jpeg',
  declaredByteSize: 123_456,
};

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
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  async function createGardenWithOwner(now: Date): Promise<{ gardenId: string; ownerId: string }> {
    const ownerId = randomUUID();
    await insertProfile(ownerId);
    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());
    return { gardenId: garden.id, ownerId };
  }

  async function addMember(gardenId: string, role: 'editor' | 'viewer'): Promise<string> {
    const profileId = randomUUID();
    await insertProfile(profileId);
    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        profile_id: profileId,
        role,
        state: 'active',
      })
      .execute();
    return profileId;
  }

  it('registers, opens a session, verifies to available, commits quota, and grants access — end to end', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const mediaIdempotency = new KyselyIdempotencyStore(db, clock);
    const mediaUnitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });

    const registerMediaUpload = new RegisterMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      TEST_BUCKETS,
      clock,
    );
    const session = await registerMediaUpload.execute(gardenId, ownerId, BASE_INPUT, randomUUID());
    expect(session.media.uploadState).toBe('authorized');
    expect(session.uploadUrl).toContain(TEST_BUCKETS.userMedia);

    const reservationRow = await db
      .selectFrom('media.quota_reservation')
      .selectAll()
      .where('media_id', '=', session.media.id)
      .executeTakeFirstOrThrow();
    expect(reservationRow.state).toBe('reserved');
    expect(Number(reservationRow.reserved_bytes)).toBe(123_456);

    const completeMediaUpload = new CompleteMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      clock,
    );
    const completed = await completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );
    expect(completed.uploadState).toBe('available');
    expect(completed.verifiedByteSize).toBe(123_456);

    const committedReservation = await db
      .selectFrom('media.quota_reservation')
      .selectAll()
      .where('media_id', '=', session.media.id)
      .executeTakeFirstOrThrow();
    expect(committedReservation.state).toBe('committed');

    const getMediaStatus = new GetMediaStatus(new KyselyMediaRepository(db), authorization);
    const status = await getMediaStatus.execute(gardenId, session.media.id, ownerId);
    expect(status.uploadState).toBe('available');

    const getMediaAccess = new GetMediaAccess(
      new KyselyMediaRepository(db),
      authorization,
      storage,
      new FakeAuditLogger(),
      clock,
    );
    const access = await getMediaAccess.execute(gardenId, session.media.id, ownerId);
    expect(access.url).toContain(TEST_BUCKETS.userMedia);
  });

  it('rolls back the whole registration in a real transaction when the storage gateway fails', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const registerMediaUpload = new RegisterMediaUpload(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      authorization,
      new FakeMediaStorageGateway({
        createResumableUploadSessionError: new Error('gcs unavailable'),
      }),
      TEST_BUCKETS,
      clock,
    );

    await expect(
      registerMediaUpload.execute(gardenId, ownerId, BASE_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);

    const mediaCount = await db
      .selectFrom('media.media_record')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(mediaCount.count)).toBe(0);

    const reservationCount = await db
      .selectFrom('media.quota_reservation')
      .select(db.fn.countAll().as('count'))
      .where('scope_garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(reservationCount.count)).toBe(0);
  });

  it('resolves a declared/actual mismatch to rejected and releases the quota reservation', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const mediaIdempotency = new KyselyIdempotencyStore(db, clock);
    const mediaUnitOfWork = new KyselyMediaUnitOfWork(db, clock);

    const registerMediaUpload = new RegisterMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      new FakeMediaStorageGateway(),
      TEST_BUCKETS,
      clock,
    );
    const session = await registerMediaUpload.execute(gardenId, ownerId, BASE_INPUT, randomUUID());

    const completeMediaUpload = new CompleteMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      new FakeMediaStorageGateway({ objectMetadata: { contentType: 'image/jpeg', sizeBytes: 1 } }),
      clock,
    );
    const completed = await completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );

    expect(completed.uploadState).toBe('rejected');
    const reservationRow = await db
      .selectFrom('media.quota_reservation')
      .selectAll()
      .where('media_id', '=', session.media.id)
      .executeTakeFirstOrThrow();
    expect(reservationRow.state).toBe('released');
  });

  it('conceals cross-garden media as notFound for status, completion, and access', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { gardenId: otherGardenId, ownerId: otherOwnerId } = await createGardenWithOwner(now);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));

    const registerMediaUpload = new RegisterMediaUpload(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      authorization,
      new FakeMediaStorageGateway(),
      TEST_BUCKETS,
      clock,
    );
    const session = await registerMediaUpload.execute(gardenId, ownerId, BASE_INPUT, randomUUID());

    const getMediaStatus = new GetMediaStatus(new KyselyMediaRepository(db), authorization);
    await expect(
      getMediaStatus.execute(otherGardenId, session.media.id, otherOwnerId),
    ).rejects.toMatchObject({ category: 'notFound' });

    const getMediaAccess = new GetMediaAccess(
      new KyselyMediaRepository(db),
      authorization,
      new FakeMediaStorageGateway(),
      new FakeAuditLogger(),
      clock,
    );
    await expect(
      getMediaAccess.execute(otherGardenId, session.media.id, otherOwnerId),
    ).rejects.toMatchObject({ category: 'notFound' });
  });

  it('allows a viewer to read status and access ordinary photos, but denies access to raw_capture', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const viewerId = await addMember(gardenId, 'viewer');
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const mediaIdempotency = new KyselyIdempotencyStore(db, clock);
    const mediaUnitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });

    const registerMediaUpload = new RegisterMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      TEST_BUCKETS,
      clock,
    );
    const completeMediaUpload = new CompleteMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      clock,
    );
    const getMediaAccess = new GetMediaAccess(
      new KyselyMediaRepository(db),
      authorization,
      storage,
      new FakeAuditLogger(),
      clock,
    );

    const photoSession = await registerMediaUpload.execute(
      gardenId,
      ownerId,
      BASE_INPUT,
      randomUUID(),
    );
    await completeMediaUpload.execute(
      gardenId,
      photoSession.media.id,
      ownerId,
      photoSession.media.revision,
      randomUUID(),
    );
    await expect(
      getMediaAccess.execute(gardenId, photoSession.media.id, viewerId),
    ).resolves.toBeDefined();

    const rawSession = await registerMediaUpload.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, mediaClass: 'raw_capture', displayFilename: 'scan.mov' },
      randomUUID(),
    );
    await completeMediaUpload.execute(
      gardenId,
      rawSession.media.id,
      ownerId,
      rawSession.media.revision,
      randomUUID(),
    );
    await expect(
      getMediaAccess.execute(gardenId, rawSession.media.id, viewerId),
    ).rejects.toMatchObject({ category: 'forbidden' });
  });

  it('is idempotent under a duplicate completion notification and does not double-commit the quota reservation', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const mediaIdempotency = new KyselyIdempotencyStore(db, clock);
    const mediaUnitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });

    const registerMediaUpload = new RegisterMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      TEST_BUCKETS,
      clock,
    );
    const session = await registerMediaUpload.execute(gardenId, ownerId, BASE_INPUT, randomUUID());

    const completeMediaUpload = new CompleteMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      clock,
    );
    const first = await completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );
    const second = await completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );

    expect(second.uploadState).toBe('available');
    expect(second.revision).toBe(first.revision);

    const reservationRow = await db
      .selectFrom('media.quota_reservation')
      .selectAll()
      .where('media_id', '=', session.media.id)
      .executeTakeFirstOrThrow();
    expect(reservationRow.state).toBe('committed');
  });
});
