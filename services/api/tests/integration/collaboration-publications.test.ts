/**
 * Full-stack integration tests for the client-update publication workflow
 * (P9C-PUBLISH-01): `CreateClientUpdate`, `AddClientUpdateItem`,
 * `SubmitClientUpdate`, `PublishClientUpdate`, `WithdrawClientUpdate` — real
 * PostgreSQL, real repositories, the real transactional unit of work, never
 * fakes.
 *
 * Completion evidence this suite exists to provide: the "state-machine" and
 * "audit" halves of "State-machine, authorization, concurrency, and audit
 * tests" — the full `internal_draft -> ready_for_client -> published ->
 * withdrawn` path, the six-step publish transaction's real effects
 * (immutable version, item snapshots, media entitlements, audit records),
 * publisher-capability negative cases (an engagement administrator with no
 * publisher grant; an operationally-assigned professional with no publisher
 * grant), and idempotent replay. Concurrency has its own sibling suite,
 * `collaboration-publications-concurrency.test.ts`.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "10. Publication Workflow", "11. Publication Contents".
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
import { KyselyMediaRepository } from '../../src/modules/media/public.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  DomainRuleViolatedError,
  ForbiddenError,
} from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  auditEventFor,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertGardenAssignment,
  insertMediaRecord,
  insertMembership,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
  insertPublisherGrant,
  insertWorkLog,
} from '../support/publication-integration-harness.js';

const SUITE_NAME = 'collaboration client-update publication workflow integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');
const APRIL = new Date('2026-04-10T09:00:00Z');

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

  function publisherAuthorization(): PublisherAuthorization {
    return new PublisherAuthorization(new KyselyPublisherGrantRepository(db));
  }

  function engagements(): KyselyClientEngagementRepository {
    return new KyselyClientEngagementRepository(db);
  }

  function clientUpdates(): KyselyClientUpdateRepository {
    return new KyselyClientUpdateRepository(db);
  }

  function createCommand(now: Date): CreateClientUpdate {
    return new CreateClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      publisherAuthorization(),
      engagements(),
      fixedClock(now),
    );
  }

  function addItemCommand(now: Date): AddClientUpdateItem {
    return new AddClientUpdateItem(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      new KyselyWorkLogRepository(db),
      new KyselyMediaRepository(db),
      new KyselyObservationRepository(db),
      fixedClock(now),
    );
  }

  function updateContentCommand(now: Date): UpdateClientUpdateContent {
    return new UpdateClientUpdateContent(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(now),
    );
  }

  function submitCommand(now: Date): SubmitClientUpdate {
    return new SubmitClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(now),
    );
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

  function withdrawCommand(now: Date): WithdrawClientUpdate {
    return new WithdrawClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(now),
    );
  }

  const NO_PUBLISH_CONTENT = { gardenSnapshot: null, timelineEntries: [], staffAttributions: [] };

  async function seedActiveEngagementWithPublisher() {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null, JANUARY);
    await activateEngagement(db, engagementId, JANUARY);
    await insertPublisherGrant(db, engagementId, ownerId, ownerId, JANUARY);
    return { ownerId, gardenId, engagementId };
  }

  // --- Full state-machine path --------------------------------------------

  it('walks the full internal_draft -> ready_for_client -> published -> withdrawn path, with the six-step publish transaction’s real effects', async () => {
    const { ownerId, gardenId, engagementId } = await seedActiveEngagementWithPublisher();
    const workLogId = await insertWorkLog(db, gardenId, ownerId, 'Pruned the roses', MARCH);
    const mediaId = await insertMediaRecord(db, gardenId, ownerId);

    const draft = await createCommand(MARCH).execute(
      engagementId,
      'March visit summary',
      ownerId,
      generateUuidV7(),
    );
    expect(draft.state).toBe('internal_draft');
    expect(draft.items).toHaveLength(0);

    const auditCreated = await auditEventFor(db, draft.id, 'client_update.created');
    expect(auditCreated).toBeDefined();
    // Prohibited-content telemetry (P9C-OBS-01): the title is publication
    // text (section 19's own exclusion list) and must never reach the
    // audit row, even though the command itself received it.
    expect(auditCreated?.details).toEqual({ engagementId });
    expect(JSON.stringify(auditCreated?.details)).not.toContain('March visit summary');

    await addItemCommand(MARCH).execute(
      engagementId,
      draft.id,
      {
        kind: 'work_log',
        occurredAt: MARCH,
        sourceWorkLogId: workLogId,
        description: 'Roses pruned back for spring',
      },
      ownerId,
      generateUuidV7(),
    );
    await addItemCommand(MARCH).execute(
      engagementId,
      draft.id,
      {
        kind: 'media',
        occurredAt: MARCH,
        mediaRecordId: mediaId,
        mediaRole: 'after',
        caption: 'Roses, after pruning',
      },
      ownerId,
      generateUuidV7(),
    );

    // Content edit (title/summary) while still internal_draft, revision-guarded.
    const withContent = await updateContentCommand(MARCH).execute(
      engagementId,
      draft.id,
      { summary: 'Spring pruning completed across the rose beds.' },
      ownerId,
      1,
      generateUuidV7(),
    );
    expect(withContent.summary).toBe('Spring pruning completed across the rose beds.');
    expect(withContent.items).toHaveLength(2);

    const submitted = await submitCommand(APRIL).execute(
      engagementId,
      draft.id,
      ownerId,
      withContent.revision,
      generateUuidV7(),
    );
    expect(submitted.state).toBe('ready_for_client');
    expect(submitted.submittedAt).toBeDefined();

    const published = await publishCommand(APRIL).execute(
      engagementId,
      draft.id,
      {
        gardenSnapshot: { overviewText: 'Rose beds refreshed for the season.', snapshotData: null },
        timelineEntries: [{ entryText: 'Spring pruning cycle completed.', occurredAt: APRIL }],
        staffAttributions: [
          { staffProfileId: ownerId, displayName: 'Jordan Rivera', roleLabel: 'Lead gardener' },
        ],
      },
      ownerId,
      submitted.revision,
      generateUuidV7(),
    );

    // Step 3: the immutable version and item snapshots.
    expect(published.clientUpdateId).toBe(draft.id);
    expect(published.items).toHaveLength(4); // work_log, media, garden_snapshot, timeline_entry
    expect(published.staffAttributions).toHaveLength(1);
    const kinds = published.items.map((item) => item.kind).sort();
    expect(kinds).toEqual(['garden_snapshot', 'media', 'timeline_entry', 'work_log']);

    // Step 4: an explicit media-entitlement record for the media item.
    const entitlements = await db
      .selectFrom('collaboration.media_entitlement')
      .selectAll()
      .where('publication_version_id', '=', published.id)
      .execute();
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]?.media_record_id).toBe(mediaId);
    expect(entitlements[0]?.engagement_id).toBe(engagementId);

    // Step 3 (row-level proof): the version and every item row actually
    // exist as immutable, INSERT-only rows in the database.
    const versionRow = await db
      .selectFrom('collaboration.publication_version')
      .selectAll()
      .where('id', '=', published.id)
      .executeTakeFirst();
    expect(versionRow?.client_update_id).toBe(draft.id);
    const itemRows = await db
      .selectFrom('collaboration.publication_item')
      .selectAll()
      .where('publication_version_id', '=', published.id)
      .execute();
    expect(itemRows).toHaveLength(4);

    // Step 5: audit written atomically with the publish.
    const auditPublished = await auditEventFor(db, published.id, 'client_update.published');
    expect(auditPublished).toBeDefined();

    const clientUpdateAfterPublish = await clientUpdates().findById(draft.id);
    expect(clientUpdateAfterPublish?.state).toBe('published');

    // Withdraw: state transition only — the publication and its
    // entitlements are never deleted.
    const withdrawn = await withdrawCommand(APRIL).execute(
      engagementId,
      draft.id,
      'Client requested removal from portal',
      ownerId,
      clientUpdateAfterPublish?.revision as number,
      generateUuidV7(),
    );
    expect(withdrawn.state).toBe('withdrawn');
    expect(withdrawn.withdrawnReason).toBe('Client requested removal from portal');

    const versionStillThere = await db
      .selectFrom('collaboration.publication_version')
      .selectAll()
      .where('id', '=', published.id)
      .executeTakeFirst();
    expect(versionStillThere).toBeDefined();
    const entitlementsStillThere = await db
      .selectFrom('collaboration.media_entitlement')
      .selectAll()
      .where('publication_version_id', '=', published.id)
      .execute();
    expect(entitlementsStillThere).toHaveLength(1);

    const auditWithdrawn = await auditEventFor(db, draft.id, 'client_update.withdrawn');
    expect(auditWithdrawn).toBeDefined();
    // Prohibited-content telemetry (P9C-OBS-01): a withdrawal reason is
    // free text (section 19's own "notes" exclusion) — only presence is
    // recorded, never the value, even though the command itself received it.
    expect(auditWithdrawn?.details).toEqual({ engagementId, hasReason: true });
    expect(JSON.stringify(auditWithdrawn?.details)).not.toContain(
      'Client requested removal from portal',
    );
  });

  // --- Publisher capability is genuinely separate -------------------------

  it('refuses an org admin (manageEngagement, no publisher grant) from creating or publishing a client update', async () => {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagement(
      db,
      gardenId,
      adminId,
      organizationId,
      JANUARY,
    );
    await activateEngagement(db, engagementId, JANUARY);
    // Deliberately NO publisher grant for adminId.

    await expect(
      createCommand(MARCH).execute(engagementId, 'March update', adminId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses an operationally-assigned professional (garden_assignment, no publisher grant) from publishing', async () => {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    // The professional has REAL operational access to the garden via an
    // active assignment — but that is garden access, not publisher access.
    await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
      'editor',
      JANUARY,
    );
    const engagementId = await insertClientEngagement(
      db,
      gardenId,
      adminId,
      organizationId,
      JANUARY,
    );
    await activateEngagement(db, engagementId, JANUARY);
    // Deliberately NO publisher grant for professionalId.

    await expect(
      createCommand(MARCH).execute(engagementId, 'March update', professionalId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses creating a client update on a non-active (draft) engagement', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null, JANUARY);
    await insertPublisherGrant(db, engagementId, ownerId, ownerId, JANUARY);
    // Deliberately never activated.

    await expect(
      createCommand(MARCH).execute(engagementId, 'March update', ownerId, generateUuidV7()),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('refuses submitting a draft with no summary set', async () => {
    const { ownerId, engagementId } = await seedActiveEngagementWithPublisher();
    const draft = await createCommand(MARCH).execute(
      engagementId,
      'March visit',
      ownerId,
      generateUuidV7(),
    );

    await expect(
      submitCommand(MARCH).execute(
        engagementId,
        draft.id,
        ownerId,
        draft.revision,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  // --- Idempotent replay ----------------------------------------------------

  it('replays the SAME publication version for a publish retried under the same Idempotency-Key, never creating a second version', async () => {
    const { ownerId, engagementId } = await seedActiveEngagementWithPublisher();
    const draft = await createCommand(MARCH).execute(
      engagementId,
      'March visit',
      ownerId,
      generateUuidV7(),
    );
    const withSummary = await updateContentCommand(MARCH).execute(
      engagementId,
      draft.id,
      { summary: 'A quiet visit, nothing dramatic.' },
      ownerId,
      draft.revision,
      generateUuidV7(),
    );
    const submitted = await submitCommand(MARCH).execute(
      engagementId,
      draft.id,
      ownerId,
      withSummary.revision,
      generateUuidV7(),
    );

    const replayKey = generateUuidV7();
    const first = await publishCommand(APRIL).execute(
      engagementId,
      draft.id,
      NO_PUBLISH_CONTENT,
      ownerId,
      submitted.revision,
      replayKey,
    );
    const second = await publishCommand(APRIL).execute(
      engagementId,
      draft.id,
      NO_PUBLISH_CONTENT,
      ownerId,
      submitted.revision,
      replayKey,
    );

    expect(second.id).toBe(first.id);

    const versions = await db
      .selectFrom('collaboration.publication_version')
      .selectAll()
      .where('client_update_id', '=', draft.id)
      .execute();
    expect(versions).toHaveLength(1);
  });
});
