/**
 * P11-SHARE-01 integration coverage: the `observation` publication kind and
 * the EXIF/GPS media-safety fix, both added alongside the existing `work_log`/
 * `media`/`garden_snapshot`/`timeline_entry` kinds `collaboration-publications
 * .test.ts` already proves end to end. A sibling file, not more lines in that
 * one, for the same "this file sits at the repository's own size discipline"
 * reasoning several other suites in this directory already give.
 *
 * Four things this file exists to prove, matching the AC's own named
 * deliverable ("Entitlement, withdrawal, export, and cross-client isolation
 * tests"):
 *   1. ENTITLEMENT/SAFETY: `isMediaClientSafe` now rejects an ORIGINAL media
 *      record (no `derived_from_media_id`) at staging time — the fix that
 *      closes the "a publisher could stage/publish a photo whose bytes carry
 *      embedded EXIF/GPS" gap.
 *   2. The full `observation` kind path: stage -> publish -> a real
 *      `publication_observation_detail` snapshot -> a real client read,
 *      through the SAME command chain `collaboration-publications.test.ts`
 *      already proves for the other kinds.
 *   3. WITHDRAWAL: an observation item is hidden from every client-portal
 *      read the identical way every other kind already is (withdrawal is
 *      kind-agnostic — `listVisibleForEngagement`'s own `state = 'published'`
 *      filter — but this is the first proof written against the new kind).
 *   4. CROSS-CLIENT ISOLATION: a client with no grant on this engagement
 *      cannot read the observation item at all — the SAME concealed
 *      `clientGardenNotFoundError()` `p9-qa-cross-client-concealment-sweep
 *      .test.ts` already proves for the other four kinds.
 *   5. GARDEN PURGE SURVIVES A STAGED/PUBLISHED OBSERVATION REFERENCE.
 *      `source_observation_id` is the first FK either `client_update_item` or
 *      `publication_observation_detail` has ever carried that resolves to a
 *      table (`observations_history.observation`) the garden purge actually
 *      deletes (`purge-plan.ts`'s own `GARDEN_PURGE_STEPS`), while both
 *      referencing tables are themselves retained past the purge
 *      (`deletion-garden-purge.test.ts`'s own `DOCUMENTED_PLAN_EXCEPTIONS`).
 *      Without `ON DELETE SET NULL`, deleting the observation would raise a
 *      foreign-key violation and fail the ENTIRE garden purge for any garden
 *      with a staged or published observation-kind item — this test proves
 *      the fix directly, by running the exact `DELETE ... WHERE garden_id =
 *      $1` the purge step itself issues.
 *
 * Source: implementation-plan.md work package P11-SHARE-01;
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
  ClientPortalAuthorization,
  CreateClientUpdate,
  GetClientTimeline,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
  KyselyClientUpdateRepository,
  KyselyCollaborationUnitOfWork,
  KyselyPublisherGrantRepository,
  KyselyWorkLogRepository,
  ListClientPublications,
  PublishClientUpdate,
  PublisherAuthorization,
  SubmitClientUpdate,
  UpdateClientUpdateContent,
  WithdrawClientUpdate,
} from '../../src/modules/collaboration/public.js';
import { DomainRuleViolatedError } from '../../src/platform/errors/application-error.js';
import { KyselyMediaRepository } from '../../src/modules/media/public.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  fixedClock,
  insertActiveClientAccessGrant,
  insertClientEngagement,
  insertGarden,
  insertMembership,
  insertMediaRecord,
  insertObservation,
  insertOriginalMediaRecord,
  insertProfile,
  insertPublisherGrant,
} from '../support/publication-integration-harness.js';

const SUITE_NAME = 'collaboration publications: observation kind and media safety';
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

  function portalAuthorization(): ClientPortalAuthorization {
    return new ClientPortalAuthorization(
      new KyselyClientAccessGrantRepository(db),
      new KyselyClientEngagementRepository(db),
    );
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

  it('rejects staging an ORIGINAL (non-derivative) media record — the EXIF/GPS safety fix', async () => {
    const { ownerId, gardenId, engagementId } = await seedActiveEngagementWithPublisher();
    const originalMediaId = await insertOriginalMediaRecord(db, gardenId, ownerId);
    const draft = await createCommand(MARCH).execute(
      engagementId,
      'March visit summary',
      ownerId,
      generateUuidV7(),
    );

    await expect(
      addItemCommand(MARCH).execute(
        engagementId,
        draft.id,
        {
          kind: 'media',
          occurredAt: MARCH,
          mediaRecordId: originalMediaId,
          mediaRole: 'after',
          caption: 'Roses, after pruning',
        },
        ownerId,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    // A DERIVATIVE of the very same photo — real, `available`, same garden —
    // is accepted, proving the rejection above is about derivative-ness
    // specifically, not a broken fixture or an unrelated validation gap.
    const derivativeMediaId = await insertMediaRecord(db, gardenId, ownerId);
    const staged = await addItemCommand(MARCH).execute(
      engagementId,
      draft.id,
      {
        kind: 'media',
        occurredAt: MARCH,
        mediaRecordId: derivativeMediaId,
        mediaRole: 'after',
        caption: 'Roses, after pruning',
      },
      ownerId,
      generateUuidV7(),
    );
    expect(staged.mediaRecordId).toBe(derivativeMediaId);
  });

  it('stages and publishes an observation item: a real publication_observation_detail snapshot, readable by the client, hidden after withdrawal, and invisible to an unrelated client', async () => {
    const { ownerId, gardenId, engagementId } = await seedActiveEngagementWithPublisher();
    const observationId = await insertObservation(
      db,
      gardenId,
      ownerId,
      'New growth spotted on the fig tree',
      MARCH,
    );

    const draft = await createCommand(MARCH).execute(
      engagementId,
      'March visit summary',
      ownerId,
      generateUuidV7(),
    );
    const staged = await addItemCommand(MARCH).execute(
      engagementId,
      draft.id,
      {
        kind: 'observation',
        occurredAt: MARCH,
        sourceObservationId: observationId,
        description: 'The fig tree is putting out fresh growth after the spring feed.',
      },
      ownerId,
      generateUuidV7(),
    );
    expect(staged.kind).toBe('observation');
    expect(staged.sourceObservationId).toBe(observationId);

    const withContent = await updateContentCommand(MARCH).execute(
      engagementId,
      draft.id,
      { summary: 'Spring growth check.' },
      ownerId,
      1,
      generateUuidV7(),
    );
    const submitted = await submitCommand(APRIL).execute(
      engagementId,
      draft.id,
      ownerId,
      withContent.revision,
      generateUuidV7(),
    );
    const published = await publishCommand(APRIL).execute(
      engagementId,
      draft.id,
      NO_PUBLISH_CONTENT,
      ownerId,
      submitted.revision,
      generateUuidV7(),
    );

    expect(published.items).toHaveLength(1);
    const publishedItem = published.items[0];
    expect(publishedItem?.kind).toBe('observation');
    expect(publishedItem?.narrativeText).toBe(
      'The fig tree is putting out fresh growth after the spring feed.',
    );
    expect(publishedItem?.sourceObservationId).toBe(observationId);

    // Row-level proof: a real, immutable snapshot row.
    const detailRow = await db
      .selectFrom('collaboration.publication_observation_detail')
      .selectAll()
      .where('item_id', '=', publishedItem?.id as string)
      .executeTakeFirst();
    expect(detailRow?.narrative_text).toBe(
      'The fig tree is putting out fresh growth after the spring feed.',
    );
    expect(detailRow?.source_observation_id).toBe(observationId);

    // --- Client read: the observation item shows a client-safe narrative,
    // never a `sourceObservationId` (provenance stays staff-only) ----------
    const clientProfileId = await insertProfile(db);
    await insertActiveClientAccessGrant(db, engagementId, clientProfileId, APRIL);

    const listPublications = new ListClientPublications(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
    const getTimeline = new GetClientTimeline(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );

    const beforeWithdrawal = await listPublications.execute(clientProfileId, engagementId);
    expect(beforeWithdrawal.items).toHaveLength(1);
    const clientItem = beforeWithdrawal.items[0]?.items[0];
    expect(clientItem?.kind).toBe('observation');
    expect(clientItem?.narrativeText).toBe(
      'The fig tree is putting out fresh growth after the spring feed.',
    );
    expect((clientItem as Record<string, unknown>)['sourceObservationId']).toBeUndefined();

    const timelineBeforeWithdrawal = await getTimeline.execute(clientProfileId, engagementId);
    expect(timelineBeforeWithdrawal.items).toHaveLength(1);
    expect(timelineBeforeWithdrawal.items[0]?.narrativeText).toBe(
      'The fig tree is putting out fresh growth after the spring feed.',
    );

    // --- Cross-client isolation: an unrelated client (no grant on this
    // engagement) cannot read the observation item at all ------------------
    const unrelatedClientProfileId = await insertProfile(db);
    await expect(
      listPublications.execute(unrelatedClientProfileId, engagementId),
    ).rejects.toMatchObject({ code: 'client_portal.not_found' });
    await expect(getTimeline.execute(unrelatedClientProfileId, engagementId)).rejects.toMatchObject(
      { code: 'client_portal.not_found' },
    );

    // --- Withdrawal: the SAME concealment the client sees for an unrelated
    // engagement now applies to their OWN, once withdrawn -------------------
    const clientUpdateAfterPublish = await clientUpdates().findById(draft.id);
    await withdrawCommand(APRIL).execute(
      engagementId,
      draft.id,
      'Superseded by a later visit',
      ownerId,
      clientUpdateAfterPublish?.revision as number,
      generateUuidV7(),
    );

    const afterWithdrawal = await listPublications.execute(clientProfileId, engagementId);
    expect(afterWithdrawal.items).toHaveLength(0);
    const timelineAfterWithdrawal = await getTimeline.execute(clientProfileId, engagementId);
    expect(timelineAfterWithdrawal.items).toHaveLength(0);

    // The snapshot itself is never deleted — withdrawal is a state flip on
    // `client_update`, exactly like every other kind.
    const detailRowStillThere = await db
      .selectFrom('collaboration.publication_observation_detail')
      .selectAll()
      .where('item_id', '=', publishedItem?.id as string)
      .executeTakeFirst();
    expect(detailRowStillThere).toBeDefined();
  });

  it('lets the garden purge delete a referenced observation without failing, leaving the retained snapshot text intact and provenance nulled', async () => {
    const { ownerId, gardenId, engagementId } = await seedActiveEngagementWithPublisher();
    const stagedOnlyObservationId = await insertObservation(
      db,
      gardenId,
      ownerId,
      'Staged but never published — should still block the naive DELETE.',
      MARCH,
    );

    const draft = await createCommand(MARCH).execute(
      engagementId,
      'March visit summary',
      ownerId,
      generateUuidV7(),
    );
    const staged = await addItemCommand(MARCH).execute(
      engagementId,
      draft.id,
      {
        kind: 'observation',
        occurredAt: MARCH,
        sourceObservationId: stagedOnlyObservationId,
        description: 'Staged content, never published.',
      },
      ownerId,
      generateUuidV7(),
    );

    // The exact statement `GARDEN_PURGE_STEPS`'s own
    // 'observations_history.observation' step issues.
    await db
      .deleteFrom('observations_history.observation')
      .where('garden_id', '=', gardenId)
      .execute();

    const stagedItemAfterPurge = await db
      .selectFrom('collaboration.client_update_item')
      .selectAll()
      .where('id', '=', staged.id)
      .executeTakeFirstOrThrow();
    expect(stagedItemAfterPurge.source_observation_id).toBeNull();
    expect(stagedItemAfterPurge.description).toBe('Staged content, never published.');
    expect(stagedItemAfterPurge.kind).toBe('observation');
  });
});
