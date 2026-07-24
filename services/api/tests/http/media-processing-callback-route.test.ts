/**
 * Full HTTP-level contract tests for the media-processing callback route
 * (P6-ASYNC-01): the real Fastify application, a real migrated PostgreSQL
 * database, and a fake `CloudTasksInvocationVerifier` (Cloud Tasks OIDC
 * verification itself needs a real Google-signed token to exercise
 * meaningfully — see `platform/tasks/google-oidc-invocation-verifier.ts`'s
 * own header comment for why that adapter has no unit test of its own,
 * mirroring `FirebaseTokenVerifier`/`FirebaseAppCheckVerifier`'s existing
 * precedent). Business logic is already covered by
 * `tests/integration/media-processing.test.ts`; this suite proves request
 * parsing, authentication gating, and status/response shape only, mirroring
 * `media-routes.test.ts`'s own stated split.
 *
 * Source: implementation-plan.md work package P6-ASYNC-01.
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, MediaProcessingManifest } from '@verdery/api-contracts';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { registerMediaRecord } from '../../src/modules/media/domain/media-record.js';
import {
  authorizeMediaUpload,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
} from '../../src/modules/media/domain/media-lifecycle.js';
import {
  createProcessingJob,
  markProcessingJobQueued,
} from '../../src/modules/media/domain/processing-job.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyProcessingJobRepository } from '../../src/modules/media/persistence/kysely-processing-job-repository.js';
import type { CloudTasksInvocationVerifier } from '../../src/platform/tasks/cloud-tasks-invocation-verifier.js';
import { UnauthenticatedError } from '../../src/platform/errors/application-error.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'media processing callback route (HTTP)';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const VALID_TOKEN = 'valid-oidc-token';

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Accepts exactly one fixed bearer value; rejects everything else, including a missing header. */
class FakeCloudTasksInvocationVerifier implements CloudTasksInvocationVerifier {
  verify(authorizationHeader: string | undefined): Promise<void> {
    if (authorizationHeader === `Bearer ${VALID_TOKEN}`) {
      return Promise.resolve();
    }
    return Promise.reject(new UnauthenticatedError('auth.unauthenticated', 'invalid token'));
  }
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let app: FastifyInstance;

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

    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    app = await buildTestApplication({
      database,
      cloudTasksInvocationVerifier: new FakeCloudTasksInvocationVerifier(),
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  /** Inserts a `media_record` already `available` and a `processing_job` already `queued` for it, returning both ids. */
  async function seedQueuedJob(): Promise<{ mediaId: string; jobId: string }> {
    const profileId = randomUUID();
    await db
      .insertInto('identity_access.profile')
      .values({ id: profileId, firebase_uid: `firebase-${profileId}`, account_state: 'active' })
      .execute();

    const now = new Date('2026-07-21T09:00:00Z');
    const mediaId = generateUuidV7();
    const registered = registerMediaRecord(
      mediaId,
      null,
      profileId,
      'garden_photo',
      'photo.jpg',
      'image/jpeg',
      123_456,
      null,
      null,
      null,
      null,
      now,
    );
    const authorized = authorizeMediaUpload(registered, 'bucket', 'object-key', now);
    const uploading = beginMediaUpload(authorized, now);
    const verifying = beginMediaVerification(uploading, now);
    const available = markMediaAvailable(verifying, 'image/jpeg', 123_456, null, now);
    await new KyselyMediaRepository(db).insert(available);

    const jobId = generateUuidV7();
    const processingJobRepository = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      { id: jobId, mediaId, processorConfigVersion: 'v1', inputChecksums: [] },
      now,
    );
    await processingJobRepository.insert(requested);
    await processingJobRepository.updateState(
      markProcessingJobQueued(requested, now),
      requested.revision,
    );

    return { mediaId, jobId };
  }

  function manifestFor(jobId: string, mediaId: string): MediaProcessingManifest {
    return {
      jobId,
      mediaId,
      processorConfigVersion: 'v1',
      inputObjects: [{ bucketName: 'bucket', objectKey: 'object-key' }],
      expectedChecksums: [],
    };
  }

  it('returns 204 and resolves the job when the OIDC token is valid and the manifest matches the URL', async () => {
    const { mediaId, jobId } = await seedQueuedJob();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/media-processing-jobs/${jobId}/callback`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: manifestFor(jobId, mediaId),
    });

    expect(response.statusCode).toBe(204);

    const media = await new KyselyMediaRepository(db).get(mediaId);
    expect(media?.processingState).toBe('processed');
  });

  it('rejects a missing Authorization header with 401, before ever touching the database', async () => {
    const jobId = generateUuidV7();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/media-processing-jobs/${jobId}/callback`,
      payload: manifestFor(jobId, generateUuidV7()),
    });

    expect(response.statusCode).toBe(401);
    expect(asError(response).error.code).toBe('auth.unauthenticated');
  });

  it('rejects an invalid OIDC token with 401', async () => {
    const jobId = generateUuidV7();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/media-processing-jobs/${jobId}/callback`,
      headers: { authorization: 'Bearer wrong-token' },
      payload: manifestFor(jobId, generateUuidV7()),
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-UUID jobId with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/media-processing-jobs/not-a-uuid/callback',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: manifestFor(generateUuidV7(), generateUuidV7()),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a manifest whose jobId disagrees with the URL with 400', async () => {
    const jobId = generateUuidV7();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/media-processing-jobs/${jobId}/callback`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: manifestFor(generateUuidV7(), generateUuidV7()),
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for a job ID with no matching row', async () => {
    const jobId = generateUuidV7();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/internal/media-processing-jobs/${jobId}/callback`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: manifestFor(jobId, generateUuidV7()),
    });

    expect(response.statusCode).toBe(404);
  });
});
