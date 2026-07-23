/**
 * Full-stack integration tests for the media module against real PostgreSQL:
 * the real `KyselyMediaRepository`, the real `KyselyMediaUnitOfWork`, and the
 * real idempotency table — not fakes. Mirrors
 * tests/integration/gardens-mapping.test.ts's structure and rationale for why
 * this must run against a real transaction, not an in-memory fake.
 *
 * Source: implementation-plan.md work packages P4-DATA-01, P6-DATA-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import type { RegisterMediaRecordInput } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ConflictError, ValidationError } from '../../src/platform/errors/application-error.js';
import '../../src/platform/database/pg-bigint-parser.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media integration';
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

async function insertGarden(
  db: Kysely<DatabaseSchema>,
  id: string,
  createdByProfileId: string,
): Promise<void> {
  await db
    .insertInto('gardens_mapping.garden')
    .values({
      id,
      name: 'Backyard',
      lifecycle_state: 'active',
      created_by_profile_id: createdByProfileId,
    })
    .execute();
}

const BASE_INPUT: RegisterMediaRecordInput = {
  mediaClass: 'garden_photo',
  displayFilename: 'vacation photo.jpg',
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

  it('registers a media record, persists it, and makes it readable through the repository port', async () => {
    const uploaderId = randomUUID();
    await insertProfile(db, uploaderId);
    const gardenId = randomUUID();
    await insertGarden(db, gardenId, uploaderId);

    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );

    const registered = await registerMediaRecord.execute(
      uploaderId,
      { ...BASE_INPUT, gardenId, displayFilename: '  ../secret/vacation photo.jpg  ' },
      randomUUID(),
    );

    expect(registered).toMatchObject({
      gardenId,
      uploadedByProfileId: uploaderId,
      mediaClass: 'garden_photo',
      displayFilename: 'vacation photo.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 123_456,
      uploadState: 'registered',
      processingState: null,
      sensitivityClassification: 'standard',
      revision: 1,
      createdAt: now.toISOString(),
    });

    const row = await db
      .selectFrom('media.media_record')
      .selectAll()
      .where('id', '=', registered.id)
      .executeTakeFirstOrThrow();
    expect(row.garden_id).toBe(gardenId);
    expect(row.declared_content_type).toBe('image/jpeg');
    expect(row.declared_byte_size).toBe(123_456);
    expect(row.uploaded_by_profile_id).toBe(uploaderId);

    const mediaRepository = new KyselyMediaRepository(db);
    await expect(mediaRepository.get(registered.id)).resolves.toMatchObject({
      id: registered.id,
      gardenId,
      declaredContentType: 'image/jpeg',
      uploadState: 'registered',
    });
    await expect(mediaRepository.get(randomUUID())).resolves.toBeNull();
  });

  it('registers a media record with no garden yet, and a raw_capture record classified as restricted', async () => {
    const uploaderId = randomUUID();
    await insertProfile(db, uploaderId);

    const clock = fixedClock(new Date());
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );

    const registered = await registerMediaRecord.execute(
      uploaderId,
      { ...BASE_INPUT, mediaClass: 'raw_capture', displayFilename: 'scan.mov' },
      randomUUID(),
    );

    expect(registered.gardenId).toBeNull();
    expect(registered.sensitivityClassification).toBe('restricted');
  });

  it('replays the same idempotency key without creating a second record, and rejects a reused key with a different body', async () => {
    const uploaderId = randomUUID();
    await insertProfile(db, uploaderId);

    const clock = fixedClock(new Date());
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const key = randomUUID();

    const first = await registerMediaRecord.execute(uploaderId, BASE_INPUT, key);
    const replay = await registerMediaRecord.execute(uploaderId, BASE_INPUT, key);
    expect(replay).toEqual(first);

    await expect(
      registerMediaRecord.execute(uploaderId, { ...BASE_INPUT, displayFilename: 'other.jpg' }, key),
    ).rejects.toBeInstanceOf(ConflictError);

    const mediaCount = await db
      .selectFrom('media.media_record')
      .select(db.fn.countAll().as('count'))
      .where('uploaded_by_profile_id', '=', uploaderId)
      .executeTakeFirstOrThrow();
    expect(Number(mediaCount.count)).toBe(1);
  });

  it('rejects a blank displayFilename or declaredContentType and writes nothing to either table', async () => {
    const uploaderId = randomUUID();
    await insertProfile(db, uploaderId);

    const clock = fixedClock(new Date());
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );

    await expect(
      registerMediaRecord.execute(
        uploaderId,
        { ...BASE_INPUT, displayFilename: '   ' },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      registerMediaRecord.execute(
        uploaderId,
        { ...BASE_INPUT, declaredContentType: '   ' },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const mediaCount = await db
      .selectFrom('media.media_record')
      .select(db.fn.countAll().as('count'))
      .where('uploaded_by_profile_id', '=', uploaderId)
      .executeTakeFirstOrThrow();
    expect(Number(mediaCount.count)).toBe(0);

    const idempotencyCount = await db
      .selectFrom('platform.idempotency_record')
      .select(db.fn.countAll().as('count'))
      .where('actor_profile_id', '=', uploaderId)
      .executeTakeFirstOrThrow();
    expect(Number(idempotencyCount.count)).toBe(0);
  });

  it('rejects a media record for a profile that does not exist', async () => {
    const clock = fixedClock(new Date());
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );

    await expect(
      registerMediaRecord.execute(randomUUID(), BASE_INPUT, randomUUID()),
    ).rejects.toThrow(/media_record_uploaded_by_profile_id_fkey/);
  });
});
