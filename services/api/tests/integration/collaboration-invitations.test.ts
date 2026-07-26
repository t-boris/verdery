/**
 * Full-stack integration tests for invitation issue/revoke and the expiry
 * sweep (P9A-API-01) — real PostgreSQL, real repositories, the real
 * transactional unit of work, matching `gardens-mapping.test.ts`'s own
 * posture. `accept-invitation`'s full section-10 idempotency list is its own
 * suite (`collaboration-accept-invitation.test.ts`); membership
 * administration is `collaboration-membership.test.ts`.
 *
 * Source: implementation-plan.md work package P9A-API-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import {
  CreateInvitation,
  INVITATION_TTL_MILLISECONDS,
} from '../../src/modules/gardens-mapping/application/create-invitation.js';
import { ListGardenInvitations } from '../../src/modules/gardens-mapping/application/list-garden-invitations.js';
import { RevokeInvitation } from '../../src/modules/gardens-mapping/application/revoke-invitation.js';
import { RunInvitationExpirySweep } from '../../src/modules/gardens-mapping/application/run-invitation-expiry-sweep.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyInvitationRepository } from '../../src/modules/gardens-mapping/persistence/kysely-invitation-repository.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
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

const SUITE_NAME = 'collaboration invitations integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');

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

  function createInvitationCommand(now: Date) {
    return new CreateInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function revokeInvitationCommand(now: Date) {
    return new RevokeInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function listGardenInvitationsQuery() {
    return new ListGardenInvitations(
      new KyselyInvitationRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
    );
  }

  it('creates an editor invitation, its outbox event, and its audit event, with a one-time raw token', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    const result = await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor', intendedEmail: 'Partner@Example.test' },
      randomUUID(),
    );

    expect(result).toMatchObject({
      gardenId,
      intendedRole: 'editor',
      intendedEmail: 'partner@example.test',
      state: 'pending',
    });
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(result.expiresAt).toBe(
      new Date(JANUARY.getTime() + INVITATION_TTL_MILLISECONDS).toISOString(),
    );

    const row = await db
      .selectFrom('collaboration.invitation')
      .selectAll()
      .where('id', '=', result.id)
      .executeTakeFirstOrThrow();
    // The stored hash is never the raw token — the whole point of the design.
    expect(row.token_hash).not.toBe(result.token);

    const outboxEvent = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', result.id)
      .where('event_type', '=', 'invitation.issued')
      .executeTakeFirst();
    expect(outboxEvent).toBeDefined();

    const auditEvent = await auditEventFor(db, result.id, 'invitation.issued');
    expect(auditEvent).toBeDefined();
    expect(auditEvent?.garden_id).toBe(gardenId);
  });

  it('rejects a viewer or editor attempting to invite (owner-only, matrix row H3)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);

    await expect(
      createInvitationCommand(JANUARY).execute(
        gardenId,
        editorId,
        { intendedRole: 'viewer' },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a second pending invitation to the same (garden, email) with a clean conflict, not a raw constraint error', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor', intendedEmail: 'partner@example.test' },
      randomUUID(),
    );

    await expect(
      createInvitationCommand(JANUARY).execute(
        gardenId,
        ownerId,
        { intendedRole: 'viewer', intendedEmail: 'partner@example.test' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      category: 'conflict',
      code: 'collaboration.invitation.already_pending',
    });
  });

  it('revokes a pending invitation, closing it with an audit and outbox event', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const created = await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor' },
      randomUUID(),
    );

    const revoked = await revokeInvitationCommand(JANUARY).execute(
      gardenId,
      created.id,
      ownerId,
      randomUUID(),
    );

    expect(revoked.state).toBe('revoked');
    expect(revoked.revokedAt).toBe(JANUARY.toISOString());

    const auditEvent = await auditEventFor(db, created.id, 'invitation.revoked');
    expect(auditEvent).toBeDefined();
  });

  it('is idempotent revoking an already-revoked invitation: no error, unchanged state', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const created = await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor' },
      randomUUID(),
    );
    const firstRevoke = await revokeInvitationCommand(JANUARY).execute(
      gardenId,
      created.id,
      ownerId,
      randomUUID(),
    );

    // A DIFFERENT idempotency key, simulating a second owner (or a retry
    // that lost its original key) revoking the same already-revoked
    // invitation — must not 500, must not error at all.
    const secondRevoke = await revokeInvitationCommand(JANUARY).execute(
      gardenId,
      created.id,
      ownerId,
      randomUUID(),
    );

    expect(secondRevoke).toEqual(firstRevoke);
  });

  it('does not error revoking an already-accepted invitation, and never overwrites its accepted state', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const created = await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor' },
      randomUUID(),
    );
    await db
      .updateTable('collaboration.invitation')
      .set({ state: 'accepted', accepted_at: JANUARY, accepted_by_profile_id: ownerId })
      .where('id', '=', created.id)
      .execute();

    const result = await revokeInvitationCommand(JANUARY).execute(
      gardenId,
      created.id,
      ownerId,
      randomUUID(),
    );

    expect(result.state).toBe('accepted');
  });

  it('conceals a nonexistent invitation id as not-found', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      revokeInvitationCommand(JANUARY).execute(gardenId, randomUUID(), ownerId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the expiry sweep bulk-transitions past-expiry pending invitations to expired, and leaves live ones alone', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    const lapsed = await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor' },
      randomUUID(),
    );

    const afterExpiry = new Date(JANUARY.getTime() + INVITATION_TTL_MILLISECONDS + 1);
    // Issued fresh AT `afterExpiry` — expires `afterExpiry + TTL`, safely
    // beyond the sweep's own "now" below. Issuing it at JANUARY like
    // `lapsed` would give it the identical `expiresAt`, defeating the point
    // of this half of the test.
    const stillLive = await createInvitationCommand(afterExpiry).execute(
      gardenId,
      ownerId,
      { intendedRole: 'viewer', intendedEmail: 'other@example.test' },
      randomUUID(),
    );

    const sweep = new RunInvitationExpirySweep(
      new KyselyInvitationRepository(db),
      fixedClock(afterExpiry),
    );
    const result = await sweep.execute();

    // At least this test's own lapsed invitation — not an exact count, since
    // this suite shares one database across tests and earlier tests' own
    // pending invitations (created at the same JANUARY clock, same default
    // TTL) are equally past-expiry by `afterExpiry`.
    expect(result.invitationsExpired).toBeGreaterThanOrEqual(1);

    const lapsedRow = await db
      .selectFrom('collaboration.invitation')
      .select('state')
      .where('id', '=', lapsed.id)
      .executeTakeFirstOrThrow();
    expect(lapsedRow.state).toBe('expired');

    const liveRow = await db
      .selectFrom('collaboration.invitation')
      .select('state')
      .where('id', '=', stillLive.id)
      .executeTakeFirstOrThrow();
    expect(liveRow.state).toBe('pending');
  });

  it('lists a garden invitations newest first, across every state, scoped to that garden alone (matrix row H5)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    const otherOwnerId = await insertProfile(db);
    const otherGardenId = await insertGarden(db, otherOwnerId);
    await insertMembership(db, otherGardenId, otherOwnerId, 'owner', JANUARY);
    await createInvitationCommand(JANUARY).execute(
      otherGardenId,
      otherOwnerId,
      { intendedRole: 'viewer' },
      randomUUID(),
    );

    const oldest = await createInvitationCommand(JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'viewer', intendedEmail: 'first@example.test' },
      randomUUID(),
    );
    const AFTER_JANUARY = new Date(JANUARY.getTime() + 60_000);
    const newest = await createInvitationCommand(AFTER_JANUARY).execute(
      gardenId,
      ownerId,
      { intendedRole: 'editor', intendedEmail: 'second@example.test' },
      randomUUID(),
    );
    const revoked = await revokeInvitationCommand(AFTER_JANUARY).execute(
      gardenId,
      oldest.id,
      ownerId,
      randomUUID(),
    );

    const result = await listGardenInvitationsQuery().execute(gardenId, ownerId);

    expect(result.items.map((item) => item.id)).toEqual([newest.id, revoked.id]);
    expect(result.items[0]).toMatchObject({
      state: 'pending',
      intendedEmail: 'second@example.test',
    });
    expect(result.items[1]).toMatchObject({
      state: 'revoked',
      intendedEmail: 'first@example.test',
    });
  });

  it('returns an empty list for a garden with no invitations ever issued', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    const result = await listGardenInvitationsQuery().execute(gardenId, ownerId);

    expect(result.items).toEqual([]);
  });

  it('rejects a viewer or editor listing invitations — owner-only, unlike the member roster', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);

    await expect(listGardenInvitationsQuery().execute(gardenId, viewerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('conceals a garden a non-member has no access to as not-found', async () => {
    const strangerId = await insertProfile(db);
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(listGardenInvitationsQuery().execute(gardenId, strangerId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
