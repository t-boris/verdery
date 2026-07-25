/**
 * Full-stack integration tests for P6-RET-01's deletion workflow and its
 * race conditions against real PostgreSQL — the work package's own required
 * evidence, "Lifecycle/deletion race tests", exercised through the real
 * commands and the real database (real FK behavior, real transaction
 * rollback, real revision guards), never mocks:
 *
 * - the full workflow: schedule -> derivatives/jobs/outbox/audit -> deletion
 *   result -> `deleted` + quota release;
 * - deletion racing an in-flight processing job (both the scheduling-time
 *   cancellation and the late-result guard);
 * - a derivative registering while its source is being deleted;
 * - double-delete idempotency (one event; duplicate completion converges).
 *
 * The attachment-reference orderings of the same race live in
 * `media-deletion-references.test.ts`, split out for the 600-line rule.
 *
 * The same "real `services/api` commands, simulated relay job creation"
 * shape `media-processing.test.ts` established — the worker's own
 * prefix-deletion behavior is tested in `services/workers`' suite.
 *
 * Source: implementation-plan.md work package P6-RET-01;
 * architecture/media-storage-and-processing.md, sections "15. Retention and
 * Lifecycle", "16. Deletion Workflow", "17. Quotas".
 */

import { randomUUID } from 'node:crypto';
import { MEDIA_DELETION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import type {
  MediaDeletionRequestedEventPayload,
  MediaProcessingOutputObject,
  MediaProcessingResult,
} from '@verdery/api-contracts';
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
import { DeleteGardenMedia } from '../../src/modules/media/application/delete-garden-media.js';
import {
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { objectKeyPrefixForMedia } from '../../src/modules/media/application/media-storage-target.js';
import { RegisterMediaUpload } from '../../src/modules/media/application/register-media-upload.js';
import { RecordMediaProcessingResult } from '../../src/modules/media/application/record-media-processing-result.js';
import {
  createProcessingJob,
  markProcessingJobQueued,
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
} from '../../src/modules/media/domain/processing-job.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { KyselyProcessingJobRepository } from '../../src/modules/media/persistence/kysely-processing-job-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media deletion integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-21T09:00:00Z');
const VALIDATION_CHECKSUM = 'e'.repeat(64);

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

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });

    return {
      registerMediaUpload: new RegisterMediaUpload(
        idempotency,
        unitOfWork,
        authorization,
        storage,
        TEST_BUCKETS,
        clock,
      ),
      completeMediaUpload: new CompleteMediaUpload(
        idempotency,
        unitOfWork,
        authorization,
        storage,
        clock,
      ),
      deleteGardenMedia: new DeleteGardenMedia(
        idempotency,
        unitOfWork,
        authorization,
        TEST_BUCKETS,
        clock,
      ),
      recordResult: new RecordMediaProcessingResult(unitOfWork, clock, TEST_BUCKETS.derived),
    };
  }

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

  /** Drives a fresh upload to `available`, returning its id and current revision. */
  async function completeAnUpload(
    gardenId: string,
    ownerId: string,
  ): Promise<{ mediaId: string; revision: number }> {
    const handlers = buildHandlers(fixedClock(NOW));
    const session = await handlers.registerMediaUpload.execute(
      gardenId,
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'photo.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      randomUUID(),
    );
    const completed = await handlers.completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );
    expect(completed.uploadState).toBe('available');
    return { mediaId: session.media.id, revision: completed.revision };
  }

  /** Simulates the relay: creates a queued job of `jobKind` for `mediaId`. */
  async function seedQueuedJob(
    mediaId: string,
    jobKind: string,
    inputChecksums: readonly string[],
  ): Promise<string> {
    const jobId = randomUUID();
    const repository = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      { id: jobId, mediaId, processorConfigVersion: 'v1', inputChecksums, jobKind },
      NOW,
    );
    await repository.insert(requested);
    await repository.updateState(markProcessingJobQueued(requested, NOW), requested.revision);
    return jobId;
  }

  /** Runs the validation callback to a successful outcome, driving `processingState` to `processed`. */
  async function validateSuccessfully(mediaId: string): Promise<void> {
    const handlers = buildHandlers(fixedClock(NOW));
    const jobId = await seedQueuedJob(mediaId, 'media_validation', []);
    await handlers.recordResult.execute(jobId, {
      jobId,
      processorVersion: 'media-validator-v1',
      inputChecksums: [VALIDATION_CHECKSUM],
      outputObjects: [],
      resultSummary: { accepted: true, detectedContentType: 'image/jpeg', byteSize: 123_456 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 30 },
      outcome: 'succeeded',
    });
  }

  function thumbnailOutput(mediaId: string): MediaProcessingOutputObject {
    return {
      bucketName: TEST_BUCKETS.derived,
      objectKey: `${objectKeyPrefixForMedia(mediaId)}${randomUUID()}`,
      checksumSha256: 'f'.repeat(64),
      contentType: 'image/jpeg',
      byteSize: 8_000,
      derivativeKind: 'thumbnail',
      transformationVersion: 1,
    };
  }

  function derivativeResult(
    jobId: string,
    outputs: readonly MediaProcessingOutputObject[],
  ): MediaProcessingResult {
    return {
      jobId,
      processorVersion: 'media-derivative-generator-v1',
      inputChecksums: [VALIDATION_CHECKSUM],
      outputObjects: outputs,
      resultSummary: { derivativeCount: outputs.length },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 50 },
      outcome: 'succeeded',
    };
  }

  function deletionResult(jobId: string): MediaProcessingResult {
    return {
      jobId,
      processorVersion: 'media-deletion-v1',
      inputChecksums: [],
      outputObjects: [],
      resultSummary: { deletedObjectCount: 2, prefixCount: 2, absenceVerified: true },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 40 },
      outcome: 'succeeded',
    };
  }

  async function deletionEventsFor(mediaId: string) {
    return db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_DELETION_REQUESTED_EVENT_TYPE)
      .orderBy('occurred_at', 'asc')
      .execute();
  }

  it('runs the full workflow: schedule (derivatives, job cancellation, one prefix-scoped event, audit) then completion (deleted, quota released)', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const { mediaId } = await completeAnUpload(gardenId, ownerId);
    await validateSuccessfully(mediaId);
    const handlers = buildHandlers(fixedClock(NOW));

    // A registered derivative row plus a still-queued second derivative job
    // — the in-flight processing the workflow must cancel.
    const derivativeJobId = await seedQueuedJob(mediaId, MEDIA_DERIVATIVE_GENERATION_JOB_KIND, [
      VALIDATION_CHECKSUM,
    ]);
    await handlers.recordResult.execute(
      derivativeJobId,
      derivativeResult(derivativeJobId, [thumbnailOutput(mediaId)]),
    );
    const pendingJobId = await seedQueuedJob(mediaId, MEDIA_DERIVATIVE_GENERATION_JOB_KIND, [
      VALIDATION_CHECKSUM,
    ]);

    const mediaRepository = new KyselyMediaRepository(db);
    const current = await mediaRepository.get(mediaId);

    const scheduled = await handlers.deleteGardenMedia.execute(
      gardenId,
      mediaId,
      ownerId,
      current?.revision ?? 0,
      randomUUID(),
    );
    expect(scheduled.uploadState).toBe('deletion_scheduled');

    // Derivative rows follow their source.
    const derivativeRows = await db
      .selectFrom('media.media_record')
      .select(['upload_state'])
      .where('derived_from_media_id', '=', mediaId)
      .execute();
    expect(derivativeRows).toHaveLength(1);
    expect(derivativeRows[0]?.upload_state).toBe('deletion_scheduled');

    // The queued job was cancelled (section 16 step 3).
    const pendingJob = await new KyselyProcessingJobRepository(db).get(pendingJobId);
    expect(pendingJob).toMatchObject({
      state: 'cancelled',
      outcomeCode: 'media_deletion_scheduled',
    });

    // One prefix-scoped deletion event.
    const events = await deletionEventsFor(mediaId);
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as MediaDeletionRequestedEventPayload;
    expect(payload.objectPrefixes).toEqual([
      { bucketName: TEST_BUCKETS.userMedia, objectKeyPrefix: objectKeyPrefixForMedia(mediaId) },
      { bucketName: TEST_BUCKETS.derived, objectKeyPrefix: objectKeyPrefixForMedia(mediaId) },
    ]);

    // Completion: the deletion job's succeeded callback.
    const deletionJobId = await seedQueuedJob(mediaId, MEDIA_DELETION_JOB_KIND, []);
    await handlers.recordResult.execute(deletionJobId, deletionResult(deletionJobId));

    const deleted = await mediaRepository.get(mediaId);
    expect(deleted?.uploadState).toBe('deleted');
    const derivativeAfter = await db
      .selectFrom('media.media_record')
      .select(['upload_state'])
      .where('derived_from_media_id', '=', mediaId)
      .executeTakeFirstOrThrow();
    expect(derivativeAfter.upload_state).toBe('deleted');

    // Quota released (section 17) — the reservation was committed at
    // completion, released only now that bytes are confirmed gone.
    const reservation = await db
      .selectFrom('media.quota_reservation')
      .select(['state'])
      .where('media_id', '=', mediaId)
      .executeTakeFirstOrThrow();
    expect(reservation.state).toBe('released');

    // Audit trail: requested (user) then deleted (system).
    const auditRows = await db
      .selectFrom('platform.audit_event')
      .select(['event_type', 'actor_type'])
      .where('subject_id', '=', mediaId)
      .orderBy('occurred_at', 'asc')
      .execute();
    expect(auditRows).toEqual([
      { event_type: 'media.deletion_requested', actor_type: 'user' },
      { event_type: 'media.deleted', actor_type: 'system' },
    ]);
  });

  it('double delete is idempotent: the second call replays without a second event, and a duplicate completion converges without error', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const { mediaId } = await completeAnUpload(gardenId, ownerId);
    await validateSuccessfully(mediaId);
    const handlers = buildHandlers(fixedClock(NOW));
    const mediaRepository = new KyselyMediaRepository(db);
    const current = await mediaRepository.get(mediaId);

    const first = await handlers.deleteGardenMedia.execute(
      gardenId,
      mediaId,
      ownerId,
      current?.revision ?? 0,
      randomUUID(),
    );
    // Different idempotency key AND stale revision: the replay path answers
    // from current state, never from the revision precondition.
    const second = await handlers.deleteGardenMedia.execute(
      gardenId,
      mediaId,
      ownerId,
      current?.revision ?? 0,
      randomUUID(),
    );

    expect(first.uploadState).toBe('deletion_scheduled');
    expect(second.uploadState).toBe('deletion_scheduled');
    expect(await deletionEventsFor(mediaId)).toHaveLength(1);

    // Two independent deletion jobs deliver (at-least-once): both succeed,
    // one transition, one completion audit event.
    const firstJob = await seedQueuedJob(mediaId, MEDIA_DELETION_JOB_KIND, []);
    const secondJob = await seedQueuedJob(mediaId, MEDIA_DELETION_JOB_KIND, []);
    await handlers.recordResult.execute(firstJob, deletionResult(firstJob));
    await handlers.recordResult.execute(secondJob, deletionResult(secondJob));

    expect((await mediaRepository.get(mediaId))?.uploadState).toBe('deleted');
    const deletedAudits = await db
      .selectFrom('platform.audit_event')
      .select(['id'])
      .where('subject_id', '=', mediaId)
      .where('event_type', '=', 'media.deleted')
      .execute();
    expect(deletedAudits).toHaveLength(1);
  });

  it('race: a validation result landing after deletion was scheduled cancels its job and never touches the record', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const { mediaId, revision } = await completeAnUpload(gardenId, ownerId);
    const handlers = buildHandlers(fixedClock(NOW));

    // The relay has not created the job yet when the user deletes — the
    // in-flight window the scheduling-time cancellation cannot reach.
    await handlers.deleteGardenMedia.execute(gardenId, mediaId, ownerId, revision, randomUUID());
    const jobId = await seedQueuedJob(mediaId, 'media_validation', []);
    await handlers.recordResult.execute(jobId, {
      jobId,
      processorVersion: 'media-validator-v1',
      inputChecksums: [VALIDATION_CHECKSUM],
      outputObjects: [],
      resultSummary: { accepted: true, detectedContentType: 'image/jpeg', byteSize: 123_456 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 30 },
      outcome: 'succeeded',
    });

    const media = await new KyselyMediaRepository(db).get(mediaId);
    expect(media?.uploadState).toBe('deletion_scheduled');
    expect(media?.processingState).toBeNull();
    expect(await new KyselyProcessingJobRepository(db).get(jobId)).toMatchObject({
      state: 'cancelled',
      outcomeCode: 'media_not_available',
    });
    // No derivative-generation chain started for a dying record.
    const derivativeEvents = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', 'media.derivative_generation_requested')
      .execute();
    expect(derivativeEvents).toHaveLength(0);
  });

  it('race: a derivative result landing after deletion was scheduled registers NO row, cancels its job, and re-emits byte cleanup', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const { mediaId } = await completeAnUpload(gardenId, ownerId);
    await validateSuccessfully(mediaId);
    const handlers = buildHandlers(fixedClock(NOW));
    const mediaRepository = new KyselyMediaRepository(db);
    const derivativeJobId = await seedQueuedJob(mediaId, MEDIA_DERIVATIVE_GENERATION_JOB_KIND, [
      VALIDATION_CHECKSUM,
    ]);

    const current = await mediaRepository.get(mediaId);
    await handlers.deleteGardenMedia.execute(
      gardenId,
      mediaId,
      ownerId,
      current?.revision ?? 0,
      randomUUID(),
    );
    // The scheduling transaction cancelled the queued job, but its Cloud
    // Tasks dispatch cannot be recalled: the worker still runs, writes real
    // derivative bytes, and posts this result.
    await handlers.recordResult.execute(
      derivativeJobId,
      derivativeResult(derivativeJobId, [thumbnailOutput(mediaId)]),
    );

    const derivativeRows = await db
      .selectFrom('media.media_record')
      .selectAll()
      .where('derived_from_media_id', '=', mediaId)
      .execute();
    expect(derivativeRows).toHaveLength(0);
    expect(await new KyselyProcessingJobRepository(db).get(derivativeJobId)).toMatchObject({
      state: 'cancelled',
    });
    // The initial deletion event plus the late-bytes cleanup re-emit, both
    // covering the same prefixes — idempotent by construction.
    expect(await deletionEventsFor(mediaId)).toHaveLength(2);
  });
});
