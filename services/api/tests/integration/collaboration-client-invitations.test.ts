/**
 * Full-stack integration tests for the PROFESSIONAL-side half of the
 * email-bound, expiring client-invitation mechanism (P9C-INVITE-01):
 * `CreateClientInvitation`, `RevokeClientInvitation`,
 * `ListClientInvitationsForEngagement` — real PostgreSQL, real Kysely
 * repositories, the real transactional unit of work, never fakes except the
 * transactional-email adapter itself (no real vendor exists in any test
 * environment; see `FakeTransactionalEmailAdapter`'s own header).
 *
 * The CLIENT-side half — `AcceptClientInvitation`, including the invite-
 * mismatch, replay, expiry, and session completion-evidence tests — lives in
 * `collaboration-accept-client-invitation.test.ts`, the identical file split
 * `collaboration-invitations.test.ts`/`collaboration-accept-invitation.test.ts`
 * already establish for the operational case.
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
  CreateClientInvitation,
  hashClientInvitationToken,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  ListClientInvitationsForEngagement,
  OrganizationAuthorization,
  RevokeClientInvitation,
} from '../../src/modules/collaboration/public.js';
import {
  GardenAuthorization,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import { FakeTransactionalEmailAdapter } from '../../src/modules/integrations/application/integrations-test-doubles.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/publication-integration-harness.js';

const SUITE_NAME = 'collaboration client-invitations integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const CLIENT_PORTAL_BASE_URL = 'https://portal.verdery-test.example';

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

  function organizationAuthorization(): OrganizationAuthorization {
    return new OrganizationAuthorization(new KyselyOrganizationMembershipRepository(db));
  }

  function gardenAuthorization(): GardenAuthorization {
    return new GardenAuthorization(new KyselyMembershipRepository(db));
  }

  function clientAccessGrantRepository(): KyselyClientAccessGrantRepository {
    return new KyselyClientAccessGrantRepository(db);
  }

  function clientEngagementRepository(): KyselyClientEngagementRepository {
    return new KyselyClientEngagementRepository(db);
  }

  function createCommand(now: Date, emailAdapter: FakeTransactionalEmailAdapter | null) {
    return new CreateClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      clientEngagementRepository(),
      clientAccessGrantRepository(),
      {
        adapter: emailAdapter,
        clientPortalBaseUrl: emailAdapter === null ? null : CLIENT_PORTAL_BASE_URL,
        callTimeoutMs: 1_000,
      },
      fixedClock(now),
    );
  }

  function acceptCommand(now: Date): AcceptClientInvitation {
    return new AcceptClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
  }

  function revokeCommand(now: Date): RevokeClientInvitation {
    return new RevokeClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      clientEngagementRepository(),
      fixedClock(now),
    );
  }

  function listCommand(): ListClientInvitationsForEngagement {
    return new ListClientInvitationsForEngagement(
      clientAccessGrantRepository(),
      organizationAuthorization(),
      gardenAuthorization(),
      clientEngagementRepository(),
    );
  }

  /** A garden with an active owner, plus a draft (or, on request, activated) no-organization engagement it owns — every test's own starting point. */
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
   * — the same "seed the precondition a command needs without exercising the
   * command itself" posture `insertPublisherGrant` already takes, needed
   * here because tests that exercise ACCEPT/REVOKE need a KNOWN raw token,
   * and `CreateClientInvitation` deliberately never returns or stores one.
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

  // --- CreateClientInvitation ---------------------------------------------

  it('creates a pending grant, sends exactly one email with an opaque accept link and no sensitive garden content, and never returns a token field', async () => {
    const { ownerId, gardenId, engagementId } = await seedOwnerAndEngagement('active');
    const emailAdapter = new FakeTransactionalEmailAdapter();

    const grant = await createCommand(JANUARY, emailAdapter).execute(
      engagementId,
      'Client@Example.test',
      ownerId,
      randomUUID(),
    );

    expect(grant).toMatchObject({
      engagementId,
      invitedEmail: 'client@example.test',
      state: 'pending',
    });
    expect(grant).not.toHaveProperty('token');
    expect(grant).not.toHaveProperty('tokenHash');

    expect(emailAdapter.callCount).toBe(1);
    const [message] = emailAdapter.sentMessages;
    expect(message?.to).toBe('client@example.test');
    expect(message?.html).toContain(CLIENT_PORTAL_BASE_URL);
    // No SENSITIVE garden content (section 9 step 2) — no garden name,
    // address, or identifier, even though the product's own generic name
    // for the destination ("client garden portal") legitimately says
    // "garden". `insertGarden`'s own default name is the concrete fact this
    // email must never leak.
    expect(message?.html).not.toContain('Collaboration Garden');
    expect(message?.text).not.toContain('Collaboration Garden');
    expect(message?.html).not.toContain(gardenId);
    expect(message?.html).not.toContain(engagementId);
  });

  it('permits inviting while the engagement is still draft (a pending invitation satisfies the client-identity activation precondition)', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('draft');
    const emailAdapter = new FakeTransactionalEmailAdapter();

    const grant = await createCommand(JANUARY, emailAdapter).execute(
      engagementId,
      'draft-client@example.test',
      ownerId,
      randomUUID(),
    );

    expect(grant.state).toBe('pending');
  });

  it('refuses to invite on an ended or revoked engagement', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');
    await db
      .updateTable('collaboration.client_engagement')
      .set({ state: 'ended', ended_at: JANUARY })
      .where('id', '=', engagementId)
      .execute();

    await expect(
      createCommand(JANUARY, new FakeTransactionalEmailAdapter()).execute(
        engagementId,
        'client@example.test',
        ownerId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'client_access_grant.engagement_not_invitable' });
  });

  it('refuses a non-owner, non-organization-admin caller', async () => {
    const { engagementId } = await seedOwnerAndEngagement('active');
    const stranger = await insertProfile(db);

    await expect(
      createCommand(JANUARY, new FakeTransactionalEmailAdapter()).execute(
        engagementId,
        'client@example.test',
        stranger,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses with a clean 503 when no transactional email provider is configured, and creates nothing', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');

    await expect(
      createCommand(JANUARY, null).execute(
        engagementId,
        'client@example.test',
        ownerId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'dependencyUnavailable' });

    const grants = await clientAccessGrantRepository().listForEngagement(engagementId);
    expect(grants).toHaveLength(0);
  });

  it('refuses a second invitation while one is outstanding for the same email, and creates only one email send', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');
    const emailAdapter = new FakeTransactionalEmailAdapter();

    await createCommand(JANUARY, emailAdapter).execute(
      engagementId,
      'client@example.test',
      ownerId,
      randomUUID(),
    );

    await expect(
      createCommand(JANUARY, emailAdapter).execute(
        engagementId,
        'client@example.test',
        ownerId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'client_access_grant.already_outstanding' });

    expect(emailAdapter.callCount).toBe(1);
  });

  it('lists every grant an engagement has issued, newest first', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');
    const later = new Date(JANUARY.getTime() + 60_000);
    await createCommand(JANUARY, new FakeTransactionalEmailAdapter()).execute(
      engagementId,
      'first@example.test',
      ownerId,
      randomUUID(),
    );
    await createCommand(later, new FakeTransactionalEmailAdapter()).execute(
      engagementId,
      'second@example.test',
      ownerId,
      randomUUID(),
    );

    const result = await listCommand().execute(engagementId, ownerId);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.invitedEmail)).toEqual([
      'second@example.test',
      'first@example.test',
    ]);
  });

  // --- RevokeClientInvitation: revocation ----------------------------------

  it('revokes a still-PENDING invitation', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'client@example.test' });

    const revoked = await revokeCommand(JANUARY).execute(
      engagementId,
      grant.id,
      ownerId,
      randomUUID(),
    );

    expect(revoked.state).toBe('revoked');
  });

  it('revokes an ACTIVE (already-accepted) grant, ending the client’s ongoing portal access', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');
    const grant = await seedGrant(engagementId, { invitedEmail: 'client@example.test' });
    const clientId = await insertProfile(db);
    await acceptCommand(JANUARY).execute(
      actor(clientId, 'client@example.test', true),
      grant.token,
      randomUUID(),
    );

    const revoked = await revokeCommand(JANUARY).execute(
      engagementId,
      grant.id,
      ownerId,
      randomUUID(),
    );

    expect(revoked).toMatchObject({ state: 'revoked', clientProfileId: clientId });
  });

  it('is idempotent when the grant is already revoked, and refuses (422) to revoke an expired grant', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');
    const alreadyRevoked = await seedGrant(engagementId, { state: 'revoked', revokedAt: JANUARY });
    const expired = await seedGrant(engagementId, { state: 'expired', expiresAt: JANUARY });

    const replay = await revokeCommand(JANUARY).execute(
      engagementId,
      alreadyRevoked.id,
      ownerId,
      randomUUID(),
    );
    expect(replay.state).toBe('revoked');

    await expect(
      revokeCommand(JANUARY).execute(engagementId, expired.id, ownerId, randomUUID()),
    ).rejects.toMatchObject({ code: 'client_access_grant.invalid_transition' });
  });

  it('404s revoking a grant that never existed on this engagement', async () => {
    const { ownerId, engagementId } = await seedOwnerAndEngagement('active');

    await expect(
      revokeCommand(JANUARY).execute(engagementId, randomUUID(), ownerId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
