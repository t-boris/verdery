/**
 * Full-stack integration tests for the P9C-API-01 client-portal reads —
 * `ListClientGardens`, `GetClientGardenOverview`, `ListClientPublications`,
 * `GetClientTimeline` — real PostgreSQL, real Kysely repositories, no fakes.
 *
 * This suite is this work package's own named completion evidence: "Client
 * cannot enumerate operational records or other engagements." Every
 * negative test below asserts the caught error's FULL `{ category, code,
 * message }` — not merely its HTTP-mappable category — against the
 * IDENTICAL object every other negative scenario produces, proving there is
 * no field anywhere a caller could use to distinguish "this id never
 * existed" from "this id belongs to someone else" from "this grant was
 * revoked" from "this engagement itself ended".
 *
 * `GetClientMediaAccess` (P9C-MEDIA-01) already has its own exhaustive
 * denial matrix (`client-media-access-denial-matrix.test.ts`); this suite
 * does not re-test it, per this package's own instructions.
 *
 * Source: implementation-plan.md work package P9C-API-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "11. Publication Contents", "12. Garden Timeline and Time Machine",
 * "13. API Surfaces".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  ClientPortalAuthorization,
  GetClientGardenOverview,
  GetClientTimeline,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
  ListClientGardens,
  ListClientPublications,
} from '../../src/modules/collaboration/public.js';
import { KyselyGardenRepository } from '../../src/modules/gardens-mapping/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile, insertRow } from '../support/collaboration-fixtures.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationGardenSnapshotDetail,
  insertPublicationItem,
  insertPublicationMediaDetail,
  insertPublicationStaffAttribution,
  insertPublicationTimelineEntryDetail,
  insertPublicationVersion,
  insertPublicationWorkLogDetail,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client portal integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JUNE = new Date('2026-06-01T09:00:00Z');
const CONCEALED_NOT_FOUND = {
  category: 'notFound',
  code: 'client_portal.not_found',
  message: 'No client garden exists at this id.',
};

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let pgClient: pg.Client;

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

    pgClient = new pg.Client({ connectionString: databaseUrl });
    await pgClient.connect();
  }, 120_000);

  afterAll(async () => {
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  function listGardensCommand(): ListClientGardens {
    return new ListClientGardens(
      new KyselyClientAccessGrantRepository(db),
      new KyselyClientEngagementRepository(db),
      new KyselyGardenRepository(db),
    );
  }

  function authorization(): ClientPortalAuthorization {
    return new ClientPortalAuthorization(
      new KyselyClientAccessGrantRepository(db),
      new KyselyClientEngagementRepository(db),
    );
  }

  function overviewCommand(): GetClientGardenOverview {
    return new GetClientGardenOverview(
      authorization(),
      new KyselyClientPublicationReadRepository(db),
    );
  }

  function publicationsCommand(): ListClientPublications {
    return new ListClientPublications(
      authorization(),
      new KyselyClientPublicationReadRepository(db),
    );
  }

  function timelineCommand(): GetClientTimeline {
    return new GetClientTimeline(authorization(), new KyselyClientPublicationReadRepository(db));
  }

  /** A real, active engagement with a real, active grant for a fresh client profile — every test's own starting point. */
  async function seedActiveClientGarden(gardenName?: string) {
    const staffId = await insertProfile(pgClient);
    const clientProfileId = await insertProfile(pgClient);
    const gardenId =
      gardenName === undefined
        ? await insertGarden(pgClient, staffId)
        : await insertRow(pgClient, 'gardens_mapping.garden', {
            id: randomUUID(),
            name: gardenName,
            created_by_profile_id: staffId,
          });
    const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
      state: 'active',
      activated_at: JUNE,
    });
    await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: clientProfileId,
      state: 'active',
      granted_at: JUNE,
    });

    return { staffId, clientProfileId, gardenId, engagementId };
  }

  /** Publishes one update carrying all four `publication_item` kinds plus a staff attribution and a real media entitlement. `occurredAt` overrides let tests control cross-update chronological ordering. */
  async function publishFullUpdate(
    engagementId: string,
    gardenId: string,
    staffId: string,
    occurredAt: { workLog: Date; media: Date; snapshot: Date; timelineEntry: Date },
    publishedAt: Date,
  ) {
    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      staffId,
      staffId,
      { published_at: publishedAt },
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      engagementId,
      gardenId,
      staffId,
      { published_at: publishedAt },
    );

    const workLogItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'work_log',
      {
        occurred_at: occurredAt.workLog,
      },
    );
    await insertPublicationWorkLogDetail(pgClient, workLogItemId, { source_work_log_id: null });

    const mediaRecordId = await insertMediaRecord(pgClient, staffId, {
      garden_id: gardenId,
      bucket_name: 'test-user-media',
      object_key: `ab/client-portal/${randomUUID()}`,
    });
    const mediaItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'media',
      {
        occurred_at: occurredAt.media,
      },
    );
    await insertPublicationMediaDetail(pgClient, mediaItemId, mediaRecordId);
    await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaRecordId);

    const snapshotItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'garden_snapshot',
      { occurred_at: occurredAt.snapshot },
    );
    await insertPublicationGardenSnapshotDetail(pgClient, snapshotItemId, {
      overview_text: `Overview as of ${occurredAt.snapshot.toISOString()}`,
    });

    const timelineItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'timeline_entry',
      { occurred_at: occurredAt.timelineEntry },
    );
    await insertPublicationTimelineEntryDetail(pgClient, timelineItemId);

    await insertPublicationStaffAttribution(pgClient, publicationVersionId, staffId);

    return {
      clientUpdateId,
      publicationVersionId,
      workLogItemId,
      mediaItemId,
      mediaRecordId,
      snapshotItemId,
      timelineItemId,
    };
  }

  describe('ListClientGardens', () => {
    it("returns exactly the caller's own active gardens, never another client's", async () => {
      const clientA = await seedActiveClientGarden('North Meadow');
      const clientB = await seedActiveClientGarden('South Orchard');

      await expect(listGardensCommand().execute(clientA.clientProfileId)).resolves.toEqual({
        items: [{ id: clientA.engagementId, name: 'North Meadow' }],
      });
      await expect(listGardensCommand().execute(clientB.clientProfileId)).resolves.toEqual({
        items: [{ id: clientB.engagementId, name: 'South Orchard' }],
      });
    });

    it('omits a garden whose grant is active but whose OWN engagement has ended', async () => {
      const client = await seedActiveClientGarden();
      await db
        .updateTable('collaboration.client_engagement')
        .set({ state: 'ended', ended_at: new Date('2026-06-15T00:00:00Z') })
        .where('id', '=', client.engagementId)
        .execute();

      await expect(listGardensCommand().execute(client.clientProfileId)).resolves.toEqual({
        items: [],
      });
    });

    it('returns an empty list for a profile with no grant at all', async () => {
      const strangerId = await insertProfile(pgClient);

      await expect(listGardensCommand().execute(strangerId)).resolves.toEqual({ items: [] });
    });
  });

  describe('GetClientGardenOverview', () => {
    it('is an honest absence — 200 with no snapshot fields — when nothing has ever been published', async () => {
      const client = await seedActiveClientGarden();

      await expect(
        overviewCommand().execute(client.clientProfileId, client.engagementId),
      ).resolves.toEqual({ clientGardenId: client.engagementId });
    });

    it('returns the LATEST published garden_snapshot across multiple publications', async () => {
      const client = await seedActiveClientGarden();
      await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-06-01T09:00:00Z'),
          media: new Date('2026-06-01T10:00:00Z'),
          snapshot: new Date('2026-06-01T11:00:00Z'),
          timelineEntry: new Date('2026-05-01T09:00:00Z'),
        },
        new Date('2026-06-01T12:00:00Z'),
      );
      const second = await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-07-01T09:00:00Z'),
          media: new Date('2026-07-01T10:00:00Z'),
          snapshot: new Date('2026-07-01T11:00:00Z'),
          timelineEntry: new Date('2026-06-15T09:00:00Z'),
        },
        new Date('2026-07-01T12:00:00Z'),
      );

      const overview = await overviewCommand().execute(client.clientProfileId, client.engagementId);

      expect(overview.publicationId).toBe(second.publicationVersionId);
      expect(overview.overviewText).toBe('Overview as of 2026-07-01T11:00:00.000Z');
      expect(overview.occurredAt).toBe('2026-07-01T11:00:00.000Z');
      expect(overview.publishedAt).toBe('2026-07-01T12:00:00.000Z');
    });
  });

  describe('ListClientPublications', () => {
    it('lists visible publications newest-first, excluding a withdrawn one, with a client-safe item shape', async () => {
      const client = await seedActiveClientGarden();
      const older = await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-06-01T09:00:00Z'),
          media: new Date('2026-06-01T10:00:00Z'),
          snapshot: new Date('2026-06-01T11:00:00Z'),
          timelineEntry: new Date('2026-05-01T09:00:00Z'),
        },
        new Date('2026-06-01T12:00:00Z'),
      );
      const newer = await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-07-01T09:00:00Z'),
          media: new Date('2026-07-01T10:00:00Z'),
          snapshot: new Date('2026-07-01T11:00:00Z'),
          timelineEntry: new Date('2026-06-15T09:00:00Z'),
        },
        new Date('2026-07-01T12:00:00Z'),
      );

      // A third update, published then withdrawn — must never appear.
      const withdrawn = await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-08-01T09:00:00Z'),
          media: new Date('2026-08-01T10:00:00Z'),
          snapshot: new Date('2026-08-01T11:00:00Z'),
          timelineEntry: new Date('2026-08-01T09:00:00Z'),
        },
        new Date('2026-08-01T12:00:00Z'),
      );
      await db
        .updateTable('collaboration.client_update')
        .set({
          state: 'withdrawn',
          withdrawn_at: new Date('2026-08-02T00:00:00Z'),
          withdrawn_by_profile_id: client.staffId,
        })
        .where('id', '=', withdrawn.clientUpdateId)
        .execute();

      const result = await publicationsCommand().execute(
        client.clientProfileId,
        client.engagementId,
      );

      expect(result.items.map((item) => item.id)).toEqual([
        newer.publicationVersionId,
        older.publicationVersionId,
      ]);

      const newerItem = result.items[0]!;
      expect(newerItem.items).toHaveLength(4);
      const mediaItem = newerItem.items.find((item) => item.kind === 'media')!;
      expect(mediaItem.mediaId).toBe(newer.mediaRecordId);
      const workLogItem = newerItem.items.find((item) => item.kind === 'work_log')!;
      // Never leaks the operational work-log id or a staff profile id.
      expect(workLogItem).not.toHaveProperty('sourceWorkLogId');
      expect(newerItem.staffAttributions[0]).not.toHaveProperty('staffProfileId');
      expect(newerItem.staffAttributions[0]?.displayName).toBe('Jordan Rivera');
    });
  });

  describe('GetClientTimeline', () => {
    it('flattens every item of every visible publication into one oldest-first sequence, distinct from the version-grouped publications list', async () => {
      const client = await seedActiveClientGarden();
      const first = await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-06-10T09:00:00Z'),
          media: new Date('2026-06-20T09:00:00Z'),
          snapshot: new Date('2026-06-05T09:00:00Z'),
          timelineEntry: new Date('2026-05-01T09:00:00Z'),
        },
        new Date('2026-06-25T12:00:00Z'),
      );
      const second = await publishFullUpdate(
        client.engagementId,
        client.gardenId,
        client.staffId,
        {
          workLog: new Date('2026-06-12T09:00:00Z'),
          media: new Date('2026-07-01T09:00:00Z'),
          snapshot: new Date('2026-06-18T09:00:00Z'),
          timelineEntry: new Date('2026-05-15T09:00:00Z'),
        },
        new Date('2026-07-05T12:00:00Z'),
      );

      const timeline = await timelineCommand().execute(client.clientProfileId, client.engagementId);

      // 4 kinds x 2 publications = 8 facts, INTERLEAVED by occurredAt across
      // the two publication versions (not grouped by version) — the
      // genuine structural difference from `ListClientPublications`.
      expect(timeline.items).toHaveLength(8);
      const occurredAtValues = timeline.items.map((item) => Date.parse(item.occurredAt));
      expect(occurredAtValues).toEqual([...occurredAtValues].sort((a, b) => a - b));
      expect(timeline.items[0]?.publicationId).toBe(first.publicationVersionId);
      expect(timeline.items[1]?.publicationId).toBe(second.publicationVersionId);

      // No version wrapper: a timeline entry carries `publicationId`, kind,
      // occurredAt, and per-kind content — never a title/summary.
      for (const item of timeline.items) {
        expect(item).not.toHaveProperty('title');
        expect(item).not.toHaveProperty('summary');
      }
    });
  });

  describe('cross-engagement / enumeration concealment', () => {
    it('denies a GARBAGE clientGardenId identically for overview, publications, and timeline', async () => {
      const client = await seedActiveClientGarden();
      const garbageId = randomUUID();

      await expect(
        overviewCommand().execute(client.clientProfileId, garbageId),
      ).rejects.toMatchObject(CONCEALED_NOT_FOUND);
      await expect(
        publicationsCommand().execute(client.clientProfileId, garbageId),
      ).rejects.toMatchObject(CONCEALED_NOT_FOUND);
      await expect(
        timelineCommand().execute(client.clientProfileId, garbageId),
      ).rejects.toMatchObject(CONCEALED_NOT_FOUND);
    });

    it("denies client B requesting client A's REAL, active engagement — the SAME concealed response a garbage id gets, proving no enumeration signal", async () => {
      const clientA = await seedActiveClientGarden();
      const clientB = await seedActiveClientGarden();
      const garbageId = randomUUID();

      const [errorForOtherEngagement, errorForGarbageId] = await Promise.all([
        overviewCommand()
          .execute(clientB.clientProfileId, clientA.engagementId)
          .then(
            () => null,
            (error: unknown) => error,
          ),
        overviewCommand()
          .execute(clientB.clientProfileId, garbageId)
          .then(
            () => null,
            (error: unknown) => error,
          ),
      ]);

      expect(errorForOtherEngagement).toMatchObject(CONCEALED_NOT_FOUND);
      expect(errorForGarbageId).toMatchObject(CONCEALED_NOT_FOUND);
      // Byte-identical: no field distinguishes "belongs to someone else"
      // from "never existed".
      expect({
        category: (errorForOtherEngagement as { category: string }).category,
        code: (errorForOtherEngagement as { code: string }).code,
        message: (errorForOtherEngagement as { message: string }).message,
      }).toEqual({
        category: (errorForGarbageId as { category: string }).category,
        code: (errorForGarbageId as { code: string }).code,
        message: (errorForGarbageId as { message: string }).message,
      });

      // Client A's own request for the SAME engagement genuinely succeeds —
      // proving the denial above is about identity, not a broken fixture.
      await expect(
        overviewCommand().execute(clientA.clientProfileId, clientA.engagementId),
      ).resolves.toBeDefined();
    });

    it('denies a client whose grant is still PENDING (invited but not yet accepted)', async () => {
      const staffId = await insertProfile(pgClient);
      const clientProfileId = await insertProfile(pgClient);
      const gardenId = await insertGarden(pgClient, staffId);
      const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
        state: 'active',
        activated_at: JUNE,
      });
      await insertClientAccessGrant(pgClient, engagementId, {
        client_profile_id: clientProfileId,
        state: 'pending',
        granted_at: null,
      });

      await expect(overviewCommand().execute(clientProfileId, engagementId)).rejects.toMatchObject(
        CONCEALED_NOT_FOUND,
      );
    });

    it('denies a REVOKED client access grant', async () => {
      const client = await seedActiveClientGarden();
      await db
        .updateTable('collaboration.client_access_grant')
        .set({ state: 'revoked', revoked_at: new Date('2026-06-15T00:00:00Z') })
        .where('engagement_id', '=', client.engagementId)
        .execute();

      await expect(
        publicationsCommand().execute(client.clientProfileId, client.engagementId),
      ).rejects.toMatchObject(CONCEALED_NOT_FOUND);
    });

    it('denies an ENDED engagement even though the grant itself is still active (neither EndClientEngagement nor RevokeClientEngagement touches client_access_grant)', async () => {
      const client = await seedActiveClientGarden();
      await db
        .updateTable('collaboration.client_engagement')
        .set({ state: 'ended', ended_at: new Date('2026-06-20T00:00:00Z') })
        .where('id', '=', client.engagementId)
        .execute();

      await expect(
        timelineCommand().execute(client.clientProfileId, client.engagementId),
      ).rejects.toMatchObject(CONCEALED_NOT_FOUND);
    });

    it('denies a REVOKED engagement even though the grant itself is still active', async () => {
      const client = await seedActiveClientGarden();
      await db
        .updateTable('collaboration.client_engagement')
        .set({ state: 'revoked', revoked_at: new Date('2026-06-20T00:00:00Z') })
        .where('id', '=', client.engagementId)
        .execute();

      await expect(
        overviewCommand().execute(client.clientProfileId, client.engagementId),
      ).rejects.toMatchObject(CONCEALED_NOT_FOUND);
    });
  });
});
