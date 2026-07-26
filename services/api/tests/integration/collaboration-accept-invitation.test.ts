/**
 * Full-stack integration tests for `AcceptInvitation` (P9A-API-01) — every
 * case in identity-and-authorization.md section 10's acceptance idempotency
 * list that this schema can actually produce, each as its own test. See
 * `accept-invitation.ts`'s own header for which two list items are not
 * applicable yet (invitation type/access-plane, client engagement — neither
 * concept exists before P9C) and why account deletion/suspension is proven
 * at the authentication-plugin layer rather than here.
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * architecture/identity-and-authorization.md, section "10. Invitations".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { AcceptInvitation } from '../../src/modules/gardens-mapping/application/accept-invitation.js';
import type { AcceptInvitationActor } from '../../src/modules/gardens-mapping/application/accept-invitation.js';
import {
  generateInvitationToken,
  hashInvitationToken,
} from '../../src/modules/gardens-mapping/application/invitation-token.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  auditEventFor,
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/collaboration-integration-harness.js';

const SUITE_NAME = 'collaboration accept-invitation integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

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

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function acceptInvitationCommand(now: Date) {
    return new AcceptInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
  }

  function actor(profileId: string, email?: string, emailVerified = true): AcceptInvitationActor {
    return { profileId, email, emailVerified };
  }

  async function insertInvitation(overrides: {
    gardenId: string;
    inviterProfileId: string;
    intendedRole?: 'editor' | 'viewer';
    intendedEmail?: string | null;
    state?: 'pending' | 'accepted' | 'revoked' | 'expired';
    expiresAt?: Date;
    acceptedByProfileId?: string | null;
  }): Promise<{ id: string; token: string }> {
    const token = generateInvitationToken();
    const id = randomUUID();
    const state = overrides.state ?? 'pending';
    await db
      .insertInto('collaboration.invitation')
      .values({
        id,
        garden_id: overrides.gardenId,
        inviter_profile_id: overrides.inviterProfileId,
        intended_role: overrides.intendedRole ?? 'editor',
        intended_email: overrides.intendedEmail ?? null,
        token_hash: hashInvitationToken(token),
        state,
        // The linkage CHECKs require the matching instant (and, for
        // `accepted`, an acceptor) whenever the state itself implies one.
        accepted_by_profile_id:
          overrides.acceptedByProfileId ??
          (state === 'accepted' ? overrides.inviterProfileId : null),
        accepted_at: state === 'accepted' ? JANUARY : null,
        revoked_at: state === 'revoked' ? JANUARY : null,
        created_at: JANUARY,
        expires_at: overrides.expiresAt ?? MARCH,
      })
      .execute();
    return { id, token };
  }

  it('accepts a pending unbound invitation: grants membership, opens a period, and writes both audit rows', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedRole: 'viewer',
    });

    const member = await acceptInvitationCommand(JANUARY).execute(
      actor(inviteeId),
      invitation.token,
      randomUUID(),
    );

    expect(member).toMatchObject({
      gardenId,
      profileId: inviteeId,
      role: 'viewer',
      state: 'active',
    });

    const period = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', member.id)
      .executeTakeFirstOrThrow();
    expect(period).toMatchObject({ role: 'viewer', valid_until: null });

    const invitationRow = await db
      .selectFrom('collaboration.invitation')
      .selectAll()
      .where('id', '=', invitation.id)
      .executeTakeFirstOrThrow();
    expect(invitationRow).toMatchObject({
      state: 'accepted',
      accepted_by_profile_id: inviteeId,
      resulting_membership_id: member.id,
    });

    expect(await auditEventFor(db, invitation.id, 'invitation.accepted')).toBeDefined();
    expect(await auditEventFor(db, member.id, 'membership.granted')).toBeDefined();
  });

  it('"Existing membership": a caller who already has active membership accepts idempotently, and consumes a still-pending invitation', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    // The owner already has membership through garden creation, not this invitation.
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedRole: 'editor',
    });

    const member = await acceptInvitationCommand(JANUARY).execute(
      actor(ownerId),
      invitation.token,
      randomUUID(),
    );

    // Returns the EXISTING membership (still owner), not a new editor grant.
    expect(member).toMatchObject({ gardenId, profileId: ownerId, role: 'owner' });

    const invitationRow = await db
      .selectFrom('collaboration.invitation')
      .select(['state', 'resulting_membership_id'])
      .where('id', '=', invitation.id)
      .executeTakeFirstOrThrow();
    expect(invitationRow.state).toBe('accepted');
    expect(invitationRow.resulting_membership_id).toBe(member.id);
  });

  it('"Expired or revoked invitation" — revoked is rejected', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      state: 'revoked',
    });

    await expect(
      acceptInvitationCommand(JANUARY).execute(actor(inviteeId), invitation.token, randomUUID()),
    ).rejects.toMatchObject({ category: 'conflict', code: 'collaboration.invitation.revoked' });
  });

  it('"Expired or revoked invitation" — already expired (swept) is rejected', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      state: 'expired',
    });

    await expect(
      acceptInvitationCommand(JANUARY).execute(actor(inviteeId), invitation.token, randomUUID()),
    ).rejects.toMatchObject({ category: 'conflict', code: 'collaboration.invitation.expired' });
  });

  it('lazy expiry: a PENDING row past its own expiresAt self-heals to expired and is rejected — the sweep-race case', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    // Still 'pending' in storage — the sweep has not reached it yet.
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      state: 'pending',
      expiresAt: JANUARY,
    });

    const afterExpiry = new Date(JANUARY.getTime() + 1);
    await expect(
      acceptInvitationCommand(afterExpiry).execute(
        actor(inviteeId),
        invitation.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'conflict', code: 'collaboration.invitation.expired' });

    const row = await db
      .selectFrom('collaboration.invitation')
      .select('state')
      .where('id', '=', invitation.id)
      .executeTakeFirstOrThrow();
    // Self-healed even though the sweep never ran.
    expect(row.state).toBe('expired');
  });

  it('an invitation already accepted (by someone else) is rejected', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const firstAcceptor = await insertProfile(db);
    const secondCaller = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      state: 'accepted',
      acceptedByProfileId: firstAcceptor,
    });

    await expect(
      acceptInvitationCommand(JANUARY).execute(actor(secondCaller), invitation.token, randomUUID()),
    ).rejects.toMatchObject({
      category: 'conflict',
      code: 'collaboration.invitation.already_accepted',
    });
  });

  it('"Authenticated email mismatch": a verified caller email that differs from the bound email is rejected with 403, existence not concealed', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedEmail: 'partner@example.test',
    });

    await expect(
      acceptInvitationCommand(JANUARY).execute(
        actor(inviteeId, 'someone-else@example.test', true),
        invitation.token,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('an unverified caller email never satisfies a binding, even if the address string matches', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedEmail: 'partner@example.test',
    });

    await expect(
      acceptInvitationCommand(JANUARY).execute(
        actor(inviteeId, 'partner@example.test', false),
        invitation.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'collaboration.invitation.email_mismatch' });
  });

  it('an absent caller email never satisfies a binding', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedEmail: 'partner@example.test',
    });

    await expect(
      acceptInvitationCommand(JANUARY).execute(actor(inviteeId), invitation.token, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a matching, VERIFIED caller email is accepted normalized case-insensitively', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedEmail: 'partner@example.test',
    });

    const member = await acceptInvitationCommand(JANUARY).execute(
      actor(inviteeId, 'Partner@Example.test', true),
      invitation.token,
      randomUUID(),
    );

    expect(member.profileId).toBe(inviteeId);
  });

  it('an unbound invitation (no intended email) is acceptable by any authenticated caller', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({
      gardenId,
      inviterProfileId: ownerId,
      intendedEmail: null,
    });

    const member = await acceptInvitationCommand(JANUARY).execute(
      actor(inviteeId),
      invitation.token,
      randomUUID(),
    );

    expect(member.profileId).toBe(inviteeId);
  });

  it('conceals a nonexistent or garbage token as not-found', async () => {
    const inviteeId = await insertProfile(db);

    await expect(
      acceptInvitationCommand(JANUARY).execute(actor(inviteeId), 'not-a-real-token', randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('replays the identical result for the same Idempotency-Key rather than re-running the command', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const inviteeId = await insertProfile(db);
    const invitation = await insertInvitation({ gardenId, inviterProfileId: ownerId });
    const idempotencyKey = randomUUID();

    const first = await acceptInvitationCommand(JANUARY).execute(
      actor(inviteeId),
      invitation.token,
      idempotencyKey,
    );
    const second = await acceptInvitationCommand(JANUARY).execute(
      actor(inviteeId),
      invitation.token,
      idempotencyKey,
    );

    expect(second).toEqual(first);

    const memberships = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('profile_id', '=', inviteeId)
      .execute();
    expect(memberships).toHaveLength(1);
  });

  // "Ownership restrictions" from section 10's list is structurally
  // enforced (InvitationRole excludes 'owner' at the type level, backed by
  // `invitation_intended_role_check`) and already proven by
  // `collaboration-operations-and-attribution.test.ts`; no separate test is
  // needed here.
});
