/**
 * Full-stack integration tests for the CLIENT-side half of the email-bound,
 * expiring client-invitation mechanism (P9C-INVITE-01): `AcceptClientInvitation`
 * — real PostgreSQL, real Kysely repositories, the real transactional unit of
 * work, never fakes.
 *
 * The PROFESSIONAL-side half — `CreateClientInvitation`,
 * `RevokeClientInvitation`, `ListClientInvitationsForEngagement` — lives in
 * `collaboration-client-invitations.test.ts`, the identical file split
 * `collaboration-invitations.test.ts`/`collaboration-accept-invitation.test.ts`
 * already establish for the operational case.
 *
 * Completion evidence this suite exists to provide, matching the work
 * package's own naming: invite mismatch, replay, expiry, and session tests
 * (revocation's own acceptance-side case — "a revoked grant cannot be
 * accepted" — lives here too; revoking itself is proven in this file's
 * professional-side sibling).
 *
 * Source: implementation-plan.md work package P9C-INVITE-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "9. Client Invitation and Session".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  AcceptClientInvitation,
  hashClientInvitationToken,
  KyselyCollaborationUnitOfWork,
} from '../../src/modules/collaboration/public.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  auditEventFor,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/publication-integration-harness.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'collaboration accept-client-invitation integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const JUNE = new Date('2026-06-01T09:00:00Z');

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

  function acceptCommand(now: Date): AcceptClientInvitation {
    return new AcceptClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
  }

  /** A garden with an active owner, plus an activated no-organization engagement it owns — every test's own starting point. */
  async function seedOwnerAndEngagement(engagementState: 'draft' | 'active' = 'active') {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null, JANUARY);
    if (engagementState === 'active') {
      await activateEngagement(db, engagementId, JANUARY);
    }
    return { ownerId, gardenId, engagementId };
  }

  /**
   * Seeds a `client_access_grant` directly, bypassing `CreateClientInvitation`
   * — needed here because every ACCEPT test needs a KNOWN raw token, and
   * `CreateClientInvitation` deliberately never returns or stores one.
   */
  async function seedGrant(
    engagementId: string,
    overrides: {
      readonly invitedEmail?: string;
      readonly state?: 'pending' | 'active' | 'revoked' | 'expired';
      readonly clientProfileId?: string | null;
      readonly grantedAt?: Date | null;
      readonly revokedAt?: Date | null;
      readonly expiresAt?: Date | null;
      readonly createdAt?: Date;
    } = {},
  ): Promise<{ id: string; token: string }> {
    const token = randomUUID();
    const id = randomUUID();
    await db
      .insertInto('collaboration.client_access_grant')
      .values({
        id,
        engagement_id: engagementId,
        client_profile_id: overrides.clientProfileId ?? null,
        invited_email: overrides.invitedEmail ?? 'client@example.test',
        token_hash: hashClientInvitationToken(token),
        state: overrides.state ?? 'pending',
        granted_at: overrides.grantedAt ?? null,
        revoked_at: overrides.revokedAt ?? null,
        expires_at: overrides.expiresAt ?? new Date('2026-03-10T09:00:00Z'),
        created_at: overrides.createdAt ?? JANUARY,
      })
      .execute();
    return { id, token };
  }

  function actor(profileId: string, email?: string, emailVerified = true) {
    return { profileId, email, emailVerified };
  }

  // --- invite mismatch ------------------------------------------------------

  it('invite mismatch: a verified caller email that differs from the bound email is rejected with 403, without revealing the correct email', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'partner@example.test' });
    const clientId = await insertProfile(db);

    const error = await acceptCommand(JANUARY)
      .execute(actor(clientId, 'someone-else@example.test', true), grant.token, randomUUID())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).not.toContain('partner@example.test');
    expect((error as { code?: string }).code).toBe('client_access_grant.email_mismatch');
  });

  it('an unverified caller email never satisfies a binding, even if the address string matches', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'partner@example.test' });
    const clientId = await insertProfile(db);

    await expect(
      acceptCommand(JANUARY).execute(
        actor(clientId, 'partner@example.test', false),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // --- replay -----------------------------------------------------------------

  it('replay: accepting an already-accepted token as the SAME caller is idempotent and never re-applies', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'client@example.test' });
    const clientId = await insertProfile(db);

    const first = await acceptCommand(JANUARY).execute(
      actor(clientId, 'client@example.test', true),
      grant.token,
      randomUUID(),
    );
    const second = await acceptCommand(JANUARY).execute(
      actor(clientId, 'client@example.test', true),
      grant.token,
      randomUUID(),
    );

    expect(second).toEqual(first);
    const rows = await db
      .selectFrom('collaboration.client_access_grant')
      .selectAll()
      .where('engagement_id', '=', engagementId)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('replay: accepting an already-accepted token as a DIFFERENT caller fails cleanly, never corrupting the existing grant', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'client@example.test' });
    const firstClient = await insertProfile(db);
    const secondClient = await insertProfile(db);

    await acceptCommand(JANUARY).execute(
      actor(firstClient, 'client@example.test', true),
      grant.token,
      randomUUID(),
    );

    await expect(
      acceptCommand(JANUARY).execute(
        actor(secondClient, 'client@example.test', true),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'conflict', code: 'client_access_grant.already_accepted' });

    const row = await db
      .selectFrom('collaboration.client_access_grant')
      .select(['client_profile_id', 'state'])
      .where('id', '=', grant.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ client_profile_id: firstClient, state: 'active' });
  });

  it('replays the identical result for the same Idempotency-Key rather than re-running the command', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'client@example.test' });
    const clientId = await insertProfile(db);
    const idempotencyKey = randomUUID();

    const first = await acceptCommand(JANUARY).execute(
      actor(clientId, 'client@example.test', true),
      grant.token,
      idempotencyKey,
    );
    const second = await acceptCommand(JANUARY).execute(
      actor(clientId, 'client@example.test', true),
      grant.token,
      idempotencyKey,
    );

    expect(second).toEqual(first);
  });

  // --- expiry -------------------------------------------------------------

  it('expiry: an expired token is refused even though never explicitly revoked, self-healing to expired', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, {
      invitedEmail: 'client@example.test',
      expiresAt: JANUARY,
    });
    const clientId = await insertProfile(db);
    const afterExpiry = new Date(JANUARY.getTime() + 1);

    await expect(
      acceptCommand(afterExpiry).execute(
        actor(clientId, 'client@example.test', true),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'conflict', code: 'client_access_grant.expired' });

    const row = await db
      .selectFrom('collaboration.client_access_grant')
      .select('state')
      .where('id', '=', grant.id)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('expired');
  });

  it('conceals a nonexistent or garbage token as not-found', async () => {
    const clientId = await insertProfile(db);

    await expect(
      acceptCommand(JANUARY).execute(actor(clientId), 'not-a-real-token', randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses acceptance while the grant’s own engagement is not active (never activated)', async () => {
    const { engagementId } = await seedOwnerAndEngagement('draft');
    const grant = await seedGrant(engagementId, { invitedEmail: 'client@example.test' });
    const clientId = await insertProfile(db);

    await expect(
      acceptCommand(JANUARY).execute(
        actor(clientId, 'client@example.test', true),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      category: 'conflict',
      code: 'client_access_grant.engagement_not_active',
    });
  });

  // --- revocation (acceptance side) ---------------------------------------

  it('revocation: a revoked grant cannot be accepted', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, {
      invitedEmail: 'client@example.test',
      state: 'revoked',
      revokedAt: JANUARY,
    });
    const clientId = await insertProfile(db);

    await expect(
      acceptCommand(JANUARY).execute(
        actor(clientId, 'client@example.test', true),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'conflict', code: 'client_access_grant.revoked' });
  });

  // --- session: the accepted grant is genuinely usable afterward -----------

  it('session: a client denied media access before acceptance can read it immediately after AcceptClientInvitation activates their grant', async () => {
    const staffId = await insertProfile(db);
    const gardenId = await insertGarden(db, staffId);
    await insertMembership(db, gardenId, staffId, 'owner', JUNE);
    const engagementId = await insertClientEngagement(db, gardenId, staffId, null, JUNE);
    await activateEngagement(db, engagementId, JUNE);

    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      staffId,
      staffId,
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
      bucket_name: 'test-user-media',
      object_key: `ab/client-media/${randomUUID()}`,
      processing_state: 'processed',
    });
    await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaId);

    const grant = await seedGrant(engagementId, {
      invitedEmail: 'client@example.test',
      expiresAt: new Date('2026-12-01T09:00:00Z'),
    });
    const clientId = await insertProfile(db);

    const storage = new FakeMediaStorageGateway();
    const getClientMediaAccess = new GetClientMediaAccess(
      new KyselyMediaRepository(db),
      new KyselyClientMediaEntitlementSource(db),
      storage,
      fixedClock(JUNE),
    );

    // Before acceptance: no ACTIVE grant exists for this profile yet, so
    // media access is denied exactly like every other unauthorized case in
    // `client-media-access-denial-matrix.test.ts`.
    await expect(getClientMediaAccess.execute(clientId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);

    const accepted = await acceptCommand(JUNE).execute(
      actor(clientId, 'client@example.test', true),
      grant.token,
      randomUUID(),
    );
    expect(accepted).toMatchObject({ state: 'active', clientProfileId: clientId });

    // After acceptance: the SAME read succeeds, with no change to the
    // publication/entitlement/media rows at all — only the grant activated.
    const access = await getClientMediaAccess.execute(clientId, mediaId);
    expect(access.url).toEqual(expect.any(String));
    expect(storage.createSignedUrlCalls).toHaveLength(1);

    expect(await auditEventFor(db, grant.id, 'client_access_grant.accepted')).toBeDefined();
  });
});
