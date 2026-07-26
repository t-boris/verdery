/**
 * Full-stack integration tests for membership administration (P9A-API-01):
 * `ListGardenMembers`, `ChangeMemberRole`, `RemoveMember` — including the
 * last-owner lock proven under genuine PostgreSQL concurrency, the same
 * proof discipline `collaboration-assignment-and-last-owner.test.ts` already
 * applies to the raw SQL recipe this command implements.
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * docs/development/garden-capability-matrix.md, section "4.8 Membership".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { ChangeMemberRole } from '../../src/modules/gardens-mapping/application/change-member-role.js';
import { ListGardenMembers } from '../../src/modules/gardens-mapping/application/list-garden-members.js';
import { RemoveMember } from '../../src/modules/gardens-mapping/application/remove-member.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activeOwnerCount,
  auditEventFor,
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/collaboration-integration-harness.js';

const SUITE_NAME = 'collaboration membership administration integration';
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

    // A pool with headroom for the concurrent-removal test's two in-flight
    // transactions plus ordinary fixture traffic.
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function listMembersQuery() {
    return new ListGardenMembers(
      new KyselyMembershipRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
    );
  }

  function changeRoleCommand(now: Date) {
    return new ChangeMemberRole(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function removeMemberCommand(now: Date) {
    return new RemoveMember(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  // --- ListGardenMembers --------------------------------------------

  it('lists active members for owner, editor, AND viewer alike (matrix H2/S1), excluding a removed member', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);
    const removedId = await insertProfile(db);
    const removedMembershipId = await insertMembership(db, gardenId, removedId, 'editor', JANUARY);
    await db
      .updateTable('collaboration.membership')
      .set({ state: 'removed' })
      .where('id', '=', removedMembershipId)
      .execute();

    for (const caller of [ownerId, editorId, viewerId]) {
      const result = await listMembersQuery().execute(gardenId, caller);
      const profileIds = result.items.map((item) => item.profileId).sort();
      expect(profileIds).toEqual([ownerId, editorId, viewerId].sort());
      expect(result.items.every((item) => item.state === 'active')).toBe(true);
    }
  });

  it('conceals a garden the caller is not a member of as not-found', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const outsiderId = await insertProfile(db);

    await expect(listMembersQuery().execute(gardenId, outsiderId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  // --- ChangeMemberRole -----------------------------------------------

  it('moves an editor to viewer: closes the open period, opens a new one, and audits the change', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const memberId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, memberId, 'editor', JANUARY);

    const result = await changeRoleCommand(MARCH).execute(
      gardenId,
      memberId,
      ownerId,
      'viewer',
      randomUUID(),
    );

    expect(result.role).toBe('viewer');

    const periods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', membershipId)
      .orderBy('valid_from', 'asc')
      .execute();
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ role: 'editor', ended_reason: 'role_changed' });
    expect(periods[1]).toMatchObject({ role: 'viewer', valid_until: null });

    expect(await auditEventFor(db, membershipId, 'membership.role_changed')).toBeDefined();
  });

  it('is a no-op when the requested role already matches: no period churn', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const memberId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, memberId, 'editor', JANUARY);

    await changeRoleCommand(MARCH).execute(gardenId, memberId, ownerId, 'editor', randomUUID());

    const periods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', membershipId)
      .execute();
    expect(periods).toHaveLength(1);
    expect(periods[0]?.valid_until).toBeNull();
  });

  it('rejects a non-owner attempting to change a role (matrix H7, owner-only)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);

    await expect(
      changeRoleCommand(MARCH).execute(gardenId, viewerId, editorId, 'editor', randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses to change an owner through this endpoint — confirms the endpoint can never orphan a garden, so no lock is needed', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    await expect(
      changeRoleCommand(MARCH).execute(gardenId, ownerBId, ownerAId, 'editor', randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.membership.owner_role_not_allowed' });

    // Untouched: still two active owners.
    expect(await activeOwnerCount(db, gardenId)).toBe(2);
  });

  it('conceals a target with no active membership as not-found', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      changeRoleCommand(MARCH).execute(gardenId, randomUUID(), ownerId, 'editor', randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // --- RemoveMember -----------------------------------------------------

  it('lets any role remove THEMSELVES without the owner-only capability (matrix H12/S3)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const viewerId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);

    const result = await removeMemberCommand(MARCH).execute(
      gardenId,
      viewerId,
      viewerId,
      randomUUID(),
    );

    expect(result.state).toBe('removed');
    const period = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', membershipId)
      .executeTakeFirstOrThrow();
    expect(period).toMatchObject({ ended_reason: 'removed', valid_until: MARCH });
  });

  it('lets an owner remove another member (matrix H11), and denies an editor the same action', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);

    await expect(
      removeMemberCommand(MARCH).execute(gardenId, viewerId, editorId, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const removed = await removeMemberCommand(MARCH).execute(
      gardenId,
      viewerId,
      ownerId,
      randomUUID(),
    );
    expect(removed.state).toBe('removed');
    expect(await auditEventFor(db, removed.id, 'membership.removed')).toBeDefined();
  });

  it('the last-owner lock: a sole owner cannot remove themselves', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      removeMemberCommand(MARCH).execute(gardenId, ownerId, ownerId, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.membership.last_owner_required' });

    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('a co-owner MAY remove themselves while another active owner remains', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    const result = await removeMemberCommand(MARCH).execute(
      gardenId,
      ownerAId,
      ownerAId,
      randomUUID(),
    );

    expect(result.state).toBe('removed');
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('the last-owner lock under GENUINE concurrency: two co-owners racing to remove themselves — exactly one succeeds, the garden is never left ownerless', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    const results = await Promise.allSettled([
      removeMemberCommand(MARCH).execute(gardenId, ownerAId, ownerAId, randomUUID()),
      removeMemberCommand(MARCH).execute(gardenId, ownerBId, ownerBId, randomUUID()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'collaboration.membership.last_owner_required',
    });

    // THE POINT: never zero, never negative — exactly one owner survives.
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('conceals a target with no active membership as not-found', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      removeMemberCommand(MARCH).execute(gardenId, randomUUID(), ownerId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
