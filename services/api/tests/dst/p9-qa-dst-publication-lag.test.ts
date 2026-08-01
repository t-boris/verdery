/**
 * P9-QA-01, Batch B, Matrix 8 (DST) — publication-timestamp sub-case
 * (P9C-PUBLISH-01, `client_update`/`publication_version`).
 *
 * `PublishClientUpdate` stamps `publishedAt: now` and `WithdrawClientUpdate`
 * stamps `withdrawnAt: now` (`publish-client-update.ts`,
 * `withdraw-client-update.ts`) — both the injected clock's own `Date`, never
 * anything zone-aware. `client-update-routes.ts`'s own
 * `computeWorkToPublicationLagMs` computes `new
 * Date(version.publishedAt).getTime() - latestWorkCompletedAt` — plain
 * millisecond subtraction after `new Date(isoString)` parsing (which reads
 * the ISO string's own UTC offset, never the host's local zone).
 *
 * WHY THIS SUITE CALLS THE COMMANDS DIRECTLY RATHER THAN THROUGH HTTP:
 * `tests/support/application.ts`'s `buildTestApplication` hard-wires
 * `clock: new SystemClock()` with no override — by design, no test can pin
 * the REAL wall-clock instant an HTTP-routed publish stamps. This suite
 * needs to choose that instant precisely (to straddle a real DST
 * transition), so it constructs `PublishClientUpdate`/`WithdrawClientUpdate`
 * directly with a `fixedClock`, the identical "call the real production
 * command with a controlled clock" pattern
 * `client-update-and-invitation-telemetry.test.ts`'s own
 * `seedReadyForClientUpdate` helper already establishes for the setup
 * commands in that same suite. `computeWorkToPublicationLagMs` itself is a
 * private, unexported one-line formula in the routes file with nothing to
 * import; this suite reproduces that EXACT formula (cited above, verbatim)
 * against the REAL `PublicationVersion` the real command returns and
 * persists — the same behavioral claim the routes file's own log line
 * reports, proven against real Postgres-round-tripped timestamps.
 *
 * Transition dates match this codebase's own established convention
 * (`quiet-hours.test.ts`'s header): America/New_York springs forward
 * 2026-03-08 02:00->03:00 EST->EDT and falls back 2026-11-01 02:00->01:00
 * EDT->EST — both purely as calendar landmarks the chosen UTC instants
 * straddle; nothing in this codebase reads a time zone for these fields.
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  AddClientUpdateItem,
  CreateClientUpdate,
  KyselyClientEngagementRepository,
  KyselyClientUpdateRepository,
  KyselyCollaborationUnitOfWork,
  KyselyPublisherGrantRepository,
  KyselyWorkLogRepository,
  PublishClientUpdate,
  PublisherAuthorization,
  SubmitClientUpdate,
  UpdateClientUpdateContent,
  WithdrawClientUpdate,
} from '../../src/modules/collaboration/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import { KyselyMediaRepository } from '../../src/modules/media/public.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
  insertPublisherGrant,
  insertWorkLog,
} from '../support/publication-integration-harness.js';
import type { PublicationVersion } from '@verdery/api-contracts';

const SUITE_NAME = 'p9-qa-01 DST sweep: publication timestamps (real pipeline)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const JANUARY = new Date('2026-01-10T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

// The work was logged three days before the 2026-03-08 America/New_York
// spring-forward transition; the publish happens four days AFTER it — a
// real DST transition falls squarely inside the measured gap.
const WORK_LOG_OCCURRED_AT = new Date('2026-03-05T09:00:00Z');
const PUBLISHED_AT = new Date('2026-03-12T09:00:00Z');
const EXPECTED_LAG_MS = PUBLISHED_AT.getTime() - WORK_LOG_OCCURRED_AT.getTime();

// The withdrawal happens well after the 2026-11-01 fall-back transition,
// straddling that one against the (already DST-crossing) publish instant.
const WITHDRAWN_AT = new Date('2026-11-05T09:00:00Z');

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
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

    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function seedEngagementWithPublisher() {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = generateUuidV7();
    await db
      .insertInto('collaboration.client_engagement')
      .values({
        id: engagementId,
        garden_id: gardenId,
        service_organization_id: null,
        state: 'draft',
        stewardship_policy: 'residential',
        client_notifications_enabled: true,
        created_by_profile_id: ownerId,
        activated_at: null,
        ended_at: null,
        revoked_at: null,
        revoked_reason: null,
        created_at: JANUARY,
        updated_at: JANUARY,
      })
      .execute();
    await activateEngagement(db, engagementId, JANUARY);
    await insertPublisherGrant(db, engagementId, ownerId, ownerId, JANUARY);
    return { ownerId, gardenId, engagementId };
  }

  /** Stages a `ready_for_client` update with exactly one `work_log` item at `workLogOccurredAt`, then publishes it at `publishedAt` — every step through the real production command, each bound to its own `fixedClock`. */
  async function createSubmitAndPublish(
    engagementId: string,
    gardenId: string,
    ownerId: string,
    workLogOccurredAt: Date,
    publishedAt: Date,
  ): Promise<PublicationVersion> {
    const publisherAuthorization = new PublisherAuthorization(
      new KyselyPublisherGrantRepository(db),
    );
    const engagements = new KyselyClientEngagementRepository(db);
    const clientUpdates = new KyselyClientUpdateRepository(db);

    const createCommand = new CreateClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(workLogOccurredAt)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(workLogOccurredAt)),
      publisherAuthorization,
      engagements,
      fixedClock(workLogOccurredAt),
    );
    const draft = await createCommand.execute(
      engagementId,
      'DST-straddling visit summary',
      ownerId,
      generateUuidV7(),
    );

    const workLogId = await insertWorkLog(
      db,
      gardenId,
      ownerId,
      'Pruned before the transition',
      workLogOccurredAt,
    );
    const addItemCommand = new AddClientUpdateItem(
      new KyselyIdempotencyStore(db, fixedClock(workLogOccurredAt)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(workLogOccurredAt)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      new KyselyWorkLogRepository(db),
      new KyselyMediaRepository(db),
      new KyselyObservationRepository(db),
      fixedClock(workLogOccurredAt),
    );
    await addItemCommand.execute(
      engagementId,
      draft.id,
      {
        kind: 'work_log',
        occurredAt: workLogOccurredAt,
        sourceWorkLogId: workLogId,
        description: 'Pruning completed before the DST transition',
      },
      ownerId,
      generateUuidV7(),
    );

    const contentCommand = new UpdateClientUpdateContent(
      new KyselyIdempotencyStore(db, fixedClock(workLogOccurredAt)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(workLogOccurredAt)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      fixedClock(workLogOccurredAt),
    );
    const withSummary = await contentCommand.execute(
      engagementId,
      draft.id,
      { summary: 'Work completed shortly before a DST transition; published after it.' },
      ownerId,
      draft.revision,
      generateUuidV7(),
    );

    const submitCommand = new SubmitClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(workLogOccurredAt)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(workLogOccurredAt)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      fixedClock(workLogOccurredAt),
    );
    const submitted = await submitCommand.execute(
      engagementId,
      draft.id,
      ownerId,
      withSummary.revision,
      generateUuidV7(),
    );

    // Publish bound to a DIFFERENT, later `fixedClock` — the DST-straddling
    // instant this suite controls precisely, unlike an HTTP-routed publish
    // (see this file's own header).
    const publishCommand = new PublishClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(publishedAt)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(publishedAt)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      new KyselyMediaRepository(db),
      new KyselyObservationRepository(db),
      new KyselyProfileRepository(db),
      fixedClock(publishedAt),
    );
    return publishCommand.execute(
      engagementId,
      draft.id,
      { gardenSnapshot: null, timelineEntries: [], staffAttributions: [] },
      ownerId,
      submitted.revision,
      generateUuidV7(),
    );
  }

  it('stamps publishedAt as the exact UTC publish instant and reproduces the correct work-to-publication lag across the DST transition', async () => {
    const { ownerId, gardenId, engagementId } = await seedEngagementWithPublisher();

    const version = await createSubmitAndPublish(
      engagementId,
      gardenId,
      ownerId,
      WORK_LOG_OCCURRED_AT,
      PUBLISHED_AT,
    );

    // publishedAt round-trips exactly through Postgres as the injected
    // clock's own instant — never shifted by the DST transition that
    // happened between the two measured events.
    expect(new Date(version.publishedAt)).toEqual(PUBLISHED_AT);

    // `computeWorkToPublicationLagMs`'s own formula, reproduced verbatim
    // (see this file's own header) against the real returned version.
    const workLogOccurredAtValues = version.items
      .filter((item) => item.kind === 'work_log')
      .map((item) => new Date(item.occurredAt).getTime());
    expect(workLogOccurredAtValues).toHaveLength(1);
    const latestWorkCompletedAt = Math.max(...workLogOccurredAtValues);
    const workToPublicationLagMs = new Date(version.publishedAt).getTime() - latestWorkCompletedAt;

    // Exactly 7 days (604,800,000 ms) — NOT 7 days plus or minus one hour,
    // which a wall-clock-aware ("calendar days in some local zone")
    // implementation could produce across this exact spring-forward night.
    expect(workToPublicationLagMs).toBe(7 * DAY_MS);
    expect(workToPublicationLagMs).toBe(EXPECTED_LAG_MS);
  });

  it('stamps withdrawnAt as the exact UTC withdraw instant, with the publish-to-withdraw gap exact across the fall-back transition too', async () => {
    const { ownerId, gardenId, engagementId } = await seedEngagementWithPublisher();

    const version = await createSubmitAndPublish(
      engagementId,
      gardenId,
      ownerId,
      WORK_LOG_OCCURRED_AT,
      PUBLISHED_AT,
    );

    const publisherAuthorization = new PublisherAuthorization(
      new KyselyPublisherGrantRepository(db),
    );
    const engagements = new KyselyClientEngagementRepository(db);
    const clientUpdates = new KyselyClientUpdateRepository(db);
    const withdrawCommand = new WithdrawClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(WITHDRAWN_AT)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(WITHDRAWN_AT)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      fixedClock(WITHDRAWN_AT),
    );
    const withdrawn = await withdrawCommand.execute(
      engagementId,
      version.clientUpdateId,
      'Correcting a detail',
      ownerId,
      version.clientUpdateRevisionAtPublish + 1,
      generateUuidV7(),
    );

    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(new Date(withdrawn.withdrawnAt as string)).toEqual(WITHDRAWN_AT);

    const publishToWithdrawMs =
      new Date(withdrawn.withdrawnAt as string).getTime() - new Date(version.publishedAt).getTime();
    expect(publishToWithdrawMs).toBe(WITHDRAWN_AT.getTime() - PUBLISHED_AT.getTime());
  });
});
