/**
 * THE REVOKED/WITHDRAWN/CROSS-CLIENT MEDIA-DENIAL MATRIX — P9C-MEDIA-01's
 * own completion evidence, named explicitly by the work package.
 *
 * collaboration-and-client-sharing.md section 16's own words: "Media
 * association with a garden is insufficient for client access. Client media
 * authorization requires ALL of: authenticated client profile; active
 * account and engagement; active client access grant; visible publication
 * version; explicit publication-media entitlement; requested safe
 * derivative or specifically entitled original." Every test below proves
 * ONE of those conditions failing denies access, against REAL PostgreSQL and
 * the REAL `KyselyClientMediaEntitlementSource`/`KyselyMediaRepository`
 * adapters — not fakes, and not through `GetMediaAccess`'s own operational
 * (garden-role) authorization path, which this suite never touches.
 *
 * No P9C-PUBLISH-01 command exists yet to CREATE `client_update`/
 * `publication_version`/`media_entitlement` rows (a concurrent work package,
 * per this package's own instructions) — every fixture below inserts rows
 * directly, the same posture
 * `collaboration-organization-garden-denial-matrix.test.ts` already
 * established for `garden_assignment` before P9B-API-01's own commands
 * existed.
 *
 * Source: implementation-plan.md work package P9C-MEDIA-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "16. Media Access".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  FakeMediaStorageGateway,
  fixedClock,
} from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile } from '../support/collaboration-fixtures.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client media access denial matrix';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JUNE = new Date('2026-06-01T09:00:00Z');
const NOW = new Date('2026-07-21T09:00:00Z');
const BUCKET = 'test-user-media';

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
  });

  afterAll(async () => {
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  function buildUseCase(storage = new FakeMediaStorageGateway()) {
    return {
      useCase: new GetClientMediaAccess(
        new KyselyMediaRepository(db),
        new KyselyClientMediaEntitlementSource(db),
        storage,
        fixedClock(NOW),
      ),
      storage,
    };
  }

  /**
   * A COMPLETE, genuinely valid scenario: an active engagement, an active
   * grant for `clientProfileId`, a media_update that reached `published`,
   * and an explicit entitlement naming this exact media object — every
   * caller below starts here and then breaks exactly ONE condition, proving
   * the positive case is real before each negative one is trusted.
   */
  async function seedValidScenario(overrides?: {
    engagementState?: string;
    engagementExtra?: Record<string, unknown>;
    grantState?: string;
    grantExtra?: Record<string, unknown>;
    publicationState?: string;
    publicationExtra?: Record<string, unknown>;
    skipEntitlement?: boolean;
  }) {
    const staffId = await insertProfile(pgClient);
    const clientProfileId = await insertProfile(pgClient);
    const gardenId = await insertGarden(pgClient, staffId);
    const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
      state: overrides?.engagementState ?? 'active',
      activated_at: JUNE,
      ...overrides?.engagementExtra,
    });
    await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: clientProfileId,
      state: overrides?.grantState ?? 'active',
      granted_at: JUNE,
      ...overrides?.grantExtra,
    });

    const publicationExtra = overrides?.publicationExtra ?? {};
    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      staffId,
      staffId,
      {
        state: overrides?.publicationState ?? 'published',
        // `client_update_withdrawn_by_linkage_check` requires
        // `withdrawn_by_profile_id` to be set exactly when `withdrawn_at`
        // is — defaulted here (not in the test bodies) since `staffId` is
        // only known once this function has generated it.
        ...('withdrawn_at' in publicationExtra ? { withdrawn_by_profile_id: staffId } : {}),
        ...publicationExtra,
      },
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      engagementId,
      gardenId,
      staffId,
    );

    const mediaId = await insertMediaRecord(pgClient, staffId, {
      garden_id: gardenId,
      bucket_name: BUCKET,
      // Unique per call — `(bucket_name, object_key)` carries a real unique
      // constraint, and every scenario in this suite creates its own media
      // record.
      object_key: `ab/client-media/${randomUUID()}`,
      processing_state: 'processed',
    });

    if (overrides?.skipEntitlement !== true) {
      await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaId);
    }

    return { clientProfileId, engagementId, publicationVersionId, mediaId, gardenId, staffId };
  }

  it('succeeds and returns a short-lived signed URL when every condition genuinely holds', async () => {
    const { clientProfileId, mediaId } = await seedValidScenario();
    const { useCase, storage } = buildUseCase();

    const access = await useCase.execute(clientProfileId, mediaId);

    expect(access.url).toContain(BUCKET);
    expect(access.expiresAt).toBe(new Date(NOW.getTime() + 900_000).toISOString());
    expect(storage.createSignedUrlCalls).toHaveLength(1);
  });

  it('denies a REVOKED client access grant', async () => {
    const { clientProfileId, mediaId } = await seedValidScenario({
      grantState: 'revoked',
      grantExtra: { revoked_at: new Date('2026-06-15T09:00:00Z') },
    });
    const { useCase, storage } = buildUseCase();

    await expect(useCase.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a WITHDRAWN publication — constructed by publishing THEN withdrawing, proving withdrawal itself (not merely never having published) is what revokes access', async () => {
    const { clientProfileId, mediaId } = await seedValidScenario({
      publicationExtra: {
        state: 'withdrawn',
        withdrawn_at: new Date('2026-06-20T09:00:00Z'),
      },
    });
    const { useCase, storage } = buildUseCase();

    await expect(useCase.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it("denies a CROSS-CLIENT request — client B, entitled on a DIFFERENT engagement, requesting client A's media", async () => {
    const clientA = await seedValidScenario();
    const clientB = await seedValidScenario();

    const { useCase, storage } = buildUseCase();

    // Client B's own media is reachable to them...
    await expect(useCase.execute(clientB.clientProfileId, clientB.mediaId)).resolves.toBeDefined();
    // ...but client A's media is not, even though client B is a genuine,
    // active client of a genuine, active engagement elsewhere.
    await expect(useCase.execute(clientB.clientProfileId, clientA.mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(1);
  });

  it('denies an ENDED engagement', async () => {
    const { clientProfileId, mediaId } = await seedValidScenario({
      engagementState: 'ended',
      engagementExtra: { ended_at: new Date('2026-06-25T09:00:00Z') },
    });
    const { useCase, storage } = buildUseCase();

    await expect(useCase.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a REVOKED engagement', async () => {
    const { clientProfileId, mediaId } = await seedValidScenario({
      engagementState: 'revoked',
      engagementExtra: { revoked_at: new Date('2026-06-25T09:00:00Z') },
    });
    const { useCase } = buildUseCase();

    await expect(useCase.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
  });

  it("denies when NO media_entitlement row exists at all — media genuinely belongs to the engagement's own garden, but was never selected for publication", async () => {
    const { clientProfileId, mediaId } = await seedValidScenario({ skipEntitlement: true });
    const { useCase, storage } = buildUseCase();

    await expect(useCase.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a client whose access grant is still PENDING (invited but not yet accepted)', async () => {
    const { clientProfileId, mediaId } = await seedValidScenario({
      grantState: 'pending',
      grantExtra: { granted_at: null },
    });
    const { useCase } = buildUseCase();

    await expect(useCase.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
  });
});
