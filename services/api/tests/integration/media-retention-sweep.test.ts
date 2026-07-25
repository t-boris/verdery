/**
 * Integration tests for P6-RET-01's retention sweep against real
 * PostgreSQL: the export-package deadline stamped at registration, a passed
 * deadline scheduling deletion, stale-upload orphan reconciliation (section
 * 15's "metadata without objects" and section 17's "A failed abandoned
 * upload eventually releases reserved capacity"), and the bounds that keep
 * a fresh registration and an undated record untouched.
 *
 * Same "real commands, simulated relay" shape as `media-deletion.test.ts`.
 */

import { randomUUID } from 'node:crypto';
import { MEDIA_DELETION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
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
import {
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { RegisterMediaUpload } from '../../src/modules/media/application/register-media-upload.js';
import { RecordMediaProcessingResult } from '../../src/modules/media/application/record-media-processing-result.js';
import { RunMediaRetentionSweep } from '../../src/modules/media/application/run-media-retention-sweep.js';
import {
  EXPORT_PACKAGE_RETENTION_DAYS,
  STALE_UPLOAD_RECONCILIATION_DAYS,
} from '../../src/modules/media/domain/media-retention.js';
import {
  createProcessingJob,
  markProcessingJobQueued,
  MEDIA_DELETION_JOB_KIND,
} from '../../src/modules/media/domain/processing-job.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { KyselyProcessingJobRepository } from '../../src/modules/media/persistence/kysely-processing-job-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media retention sweep integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-21T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_AGO = new Date(NOW.getTime() - (STALE_UPLOAD_RECONCILIATION_DAYS + 1) * DAY_MS);

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
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

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  async function createGardenWithOwner(): Promise<{ gardenId: string; ownerId: string }> {
    const ownerId = randomUUID();
    await insertProfile(ownerId);
    const clock = fixedClock(NOW);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());
    return { gardenId: garden.id, ownerId };
  }

  function buildRegistration(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'application/zip', sizeBytes: 123_456 },
    });
    return {
      register: new RegisterMediaUpload(
        idempotency,
        unitOfWork,
        authorization,
        storage,
        TEST_BUCKETS,
        clock,
      ),
      complete: new CompleteMediaUpload(idempotency, unitOfWork, authorization, storage, clock),
    };
  }

  function buildSweep(): RunMediaRetentionSweep {
    return new RunMediaRetentionSweep(
      new KyselyMediaUnitOfWork(db, fixedClock(NOW)),
      TEST_BUCKETS,
      fixedClock(NOW),
    );
  }

  it('stamps an export_package registration with registration + 7 days, and a passed deadline schedules deletion on the next sweep', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const clock = fixedClock(NOW);
    const { register, complete } = buildRegistration(clock);

    const session = await register.execute(
      gardenId,
      ownerId,
      {
        mediaClass: 'export_package',
        displayFilename: 'export.zip',
        declaredContentType: 'application/zip',
        declaredByteSize: 123_456,
      },
      randomUUID(),
    );
    expect(session.media.retentionDeadlineAt).toBe(
      new Date(NOW.getTime() + EXPORT_PACKAGE_RETENTION_DAYS * DAY_MS).toISOString(),
    );
    await complete.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );

    // Not yet expired: the sweep leaves it alone.
    let result = await buildSweep().execute();
    expect(result.retentionScheduled).toBe(0);

    // Time passes: push the stored deadline into the past.
    await db
      .updateTable('media.media_record')
      .set({ retention_deadline_at: new Date(NOW.getTime() - DAY_MS) })
      .where('id', '=', session.media.id)
      .execute();

    result = await buildSweep().execute();
    expect(result.retentionScheduled).toBe(1);

    const record = await new KyselyMediaRepository(db).get(session.media.id);
    expect(record?.uploadState).toBe('deletion_scheduled');
    const events = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', session.media.id)
      .where('event_type', '=', MEDIA_DELETION_REQUESTED_EVENT_TYPE)
      .execute();
    expect(events).toHaveLength(1);
    const audit = await db
      .selectFrom('platform.audit_event')
      .select(['event_type', 'actor_type', 'details'])
      .where('subject_id', '=', session.media.id)
      .executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ event_type: 'media.deletion_requested', actor_type: 'system' });
  });

  it('orphan-reconciles a stale authorized upload through the full deletion workflow, releasing its reservation at completion', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    // Registered over a week ago; the upload never completed. The Cloud
    // Storage resumable session it was issued expired long ago too — this
    // registration can never finish.
    const { register } = buildRegistration(fixedClock(LONG_AGO));
    const session = await register.execute(
      gardenId,
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'never-finished.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      randomUUID(),
    );

    const result = await buildSweep().execute();
    expect(result.staleScheduled).toBe(1);

    const mediaRepository = new KyselyMediaRepository(db);
    expect((await mediaRepository.get(session.media.id))?.uploadState).toBe('deletion_scheduled');

    // Partial bytes may exist under the authorized target, so the worker
    // round-trip runs; its succeeded callback finishes the reconciliation.
    const jobId = randomUUID();
    const jobs = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      {
        id: jobId,
        mediaId: session.media.id,
        processorConfigVersion: 'v1',
        inputChecksums: [],
        jobKind: MEDIA_DELETION_JOB_KIND,
      },
      NOW,
    );
    await jobs.insert(requested);
    await jobs.updateState(markProcessingJobQueued(requested, NOW), requested.revision);
    await new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(NOW)),
      fixedClock(NOW),
      TEST_BUCKETS.derived,
    ).execute(jobId, {
      jobId,
      processorVersion: 'media-deletion-v1',
      inputChecksums: [],
      outputObjects: [],
      resultSummary: { deletedObjectCount: 0, prefixCount: 2, absenceVerified: true },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 20 },
      outcome: 'succeeded',
    });

    expect((await mediaRepository.get(session.media.id))?.uploadState).toBe('deleted');
    // Section 17: "A failed abandoned upload eventually releases reserved
    // capacity" — the reservation was still `reserved` (never committed)
    // and is now released.
    const reservation = await db
      .selectFrom('media.quota_reservation')
      .select(['state'])
      .where('media_id', '=', session.media.id)
      .executeTakeFirstOrThrow();
    expect(reservation.state).toBe('released');
  });

  it('leaves a registration inside the staleness window untouched — its resumable session may still legitimately finish', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const { register } = buildRegistration(fixedClock(new Date(NOW.getTime() - DAY_MS)));
    const session = await register.execute(
      gardenId,
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'in-progress.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      randomUUID(),
    );

    const result = await buildSweep().execute();

    expect(result.staleScheduled).toBe(0);
    expect((await new KyselyMediaRepository(db).get(session.media.id))?.uploadState).toBe(
      'authorized',
    );
  });
});
