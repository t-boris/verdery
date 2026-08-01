/**
 * Concurrency proof for `PublishClientUpdate` (P9C-PUBLISH-01): two
 * publishers racing to publish the SAME `client_update` at the SAME
 * starting revision resolve through the revision guard — one wins cleanly,
 * the loser gets `StaleRevisionError`, never a corrupted state or a second
 * publication version. Genuine concurrent Postgres transactions via two
 * independent command instances launched together, the same
 * `Promise.allSettled` proof `tasks-recommendations-collaboration.test.ts`
 * already establishes for `AssignTask`'s own revision guard.
 *
 * Completion evidence this suite exists to provide: the "concurrency" half
 * of "State-machine, authorization, concurrency, and audit tests".
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "10. Publication Workflow" ("Publishing is a revision-guarded, idempotent
 * transaction").
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  CreateClientUpdate,
  KyselyClientEngagementRepository,
  KyselyClientUpdateRepository,
  KyselyCollaborationUnitOfWork,
  KyselyPublisherGrantRepository,
  PublishClientUpdate,
  PublisherAuthorization,
  SubmitClientUpdate,
  UpdateClientUpdateContent,
} from '../../src/modules/collaboration/public.js';
import { KyselyMediaRepository } from '../../src/modules/media/public.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { StaleRevisionError } from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertMembership,
  insertProfile,
  insertPublisherGrant,
} from '../support/publication-integration-harness.js';

const SUITE_NAME = 'collaboration publish-client-update concurrency integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const APRIL = new Date('2026-04-10T09:00:00Z');
const NO_PUBLISH_CONTENT = { gardenSnapshot: null, timelineEntries: [], staffAttributions: [] };

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

    // Headroom for two in-flight publish transactions plus fixture traffic
    // — the same reasoning `tasks-recommendations-collaboration.test.ts`
    // gives its own concurrency test's pool sizing.
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function publisherAuthorization(): PublisherAuthorization {
    return new PublisherAuthorization(new KyselyPublisherGrantRepository(db));
  }

  function engagements(): KyselyClientEngagementRepository {
    return new KyselyClientEngagementRepository(db);
  }

  function clientUpdates(): KyselyClientUpdateRepository {
    return new KyselyClientUpdateRepository(db);
  }

  function publishCommand(now: Date): PublishClientUpdate {
    return new PublishClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      new KyselyMediaRepository(db),
      new KyselyObservationRepository(db),
      new KyselyProfileRepository(db),
      fixedClock(now),
    );
  }

  it('resolves CONCURRENT PUBLISH of the SAME client update by two different publishers through the revision guard: one wins, the loser gets a clean StaleRevisionError, and exactly one publication_version is ever created', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const secondPublisherId = await insertProfile(db);
    await insertMembership(db, gardenId, secondPublisherId, 'editor', JANUARY);

    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null, JANUARY);
    await activateEngagement(db, engagementId, JANUARY);
    await insertPublisherGrant(db, engagementId, ownerId, ownerId, JANUARY);
    await insertPublisherGrant(db, engagementId, secondPublisherId, ownerId, JANUARY);

    const createCommand = new CreateClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      fixedClock(APRIL),
    );
    const draft = await createCommand.execute(
      engagementId,
      'April visit summary',
      ownerId,
      generateUuidV7(),
    );

    const updateContentCommand = new UpdateClientUpdateContent(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(APRIL),
    );
    const withSummary = await updateContentCommand.execute(
      engagementId,
      draft.id,
      { summary: 'A routine visit, nothing unusual to report.' },
      ownerId,
      draft.revision,
      generateUuidV7(),
    );

    const submitCommand = new SubmitClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(APRIL),
    );
    const submitted = await submitCommand.execute(
      engagementId,
      draft.id,
      ownerId,
      withSummary.revision,
      generateUuidV7(),
    );

    // Two different publishers (the owner and a second granted publisher),
    // racing to publish the SAME update, at the SAME starting revision —
    // genuine concurrent Postgres transactions via two independent command
    // instances launched together.
    const results = await Promise.allSettled([
      publishCommand(APRIL).execute(
        engagementId,
        draft.id,
        NO_PUBLISH_CONTENT,
        ownerId,
        submitted.revision,
        generateUuidV7(),
      ),
      publishCommand(APRIL).execute(
        engagementId,
        draft.id,
        NO_PUBLISH_CONTENT,
        secondPublisherId,
        submitted.revision,
        generateUuidV7(),
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleRevisionError);

    // THE POINT: exactly one publication_version survives, and the
    // client_update itself lands in a single, consistent published state —
    // never torn, never doubled.
    const versions = await db
      .selectFrom('collaboration.publication_version')
      .selectAll()
      .where('client_update_id', '=', draft.id)
      .execute();
    expect(versions).toHaveLength(1);

    const finalUpdate = await clientUpdates().findById(draft.id);
    expect(finalUpdate?.state).toBe('published');
    expect(finalUpdate?.revision).toBe(submitted.revision + 1);

    const winningPublishedBy = (
      fulfilled[0] as PromiseFulfilledResult<{ publishedByProfileId: string }>
    ).value.publishedByProfileId;
    expect(finalUpdate?.publishedByProfileId).toBe(winningPublishedBy);
    expect([ownerId, secondPublisherId]).toContain(finalUpdate?.publishedByProfileId);
  });
});
