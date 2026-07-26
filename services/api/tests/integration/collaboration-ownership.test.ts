/**
 * Full-stack integration tests for owner-set administration (P9A-OWNER-01):
 * `PromoteToOwner`, `DemoteOwner` — including the last-owner lock proven
 * under genuine PostgreSQL concurrency, and a concurrent role-transition
 * proof that a promotion racing a self-removal can never leave a `removed`
 * membership with an open period. `TransferOwnership`/`CancelOwnershipTransfer`
 * are covered by `collaboration-ownership-transfer.test.ts`, split out purely
 * to keep this file under the repository's 600-line source-file limit.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * docs/development/garden-capability-matrix.md, rows H8, H9, H10.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { DemoteOwner } from '../../src/modules/gardens-mapping/application/demote-owner.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { PromoteToOwner } from '../../src/modules/gardens-mapping/application/promote-to-owner.js';
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

const SUITE_NAME = 'collaboration owner-set administration integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');
const RECENT_AUTH = new Date(MARCH.getTime() - 5 * 60 * 1000);
const STALE_AUTH = new Date(MARCH.getTime() - 40 * 60 * 1000);

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

    // Headroom for the concurrent-demotion and concurrent-role-transition
    // tests' overlapping in-flight transactions plus ordinary fixtures.
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function promoteCommand(now: Date) {
    return new PromoteToOwner(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function demoteCommand(now: Date) {
    return new DemoteOwner(
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

  // --- PromoteToOwner ---------------------------------------------------

  it('promotes an active editor to co-owner: closes the open period, opens a new one at owner, and audits it', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const memberId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, memberId, 'editor', JANUARY);

    const result = await promoteCommand(MARCH).execute(
      gardenId,
      memberId,
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    expect(result.role).toBe('owner');
    expect(await activeOwnerCount(db, gardenId)).toBe(2);

    const periods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', membershipId)
      .orderBy('valid_from', 'asc')
      .execute();
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ role: 'editor', ended_reason: 'role_changed' });
    expect(periods[1]).toMatchObject({ role: 'owner', valid_until: null });

    expect(await auditEventFor(db, membershipId, 'membership.owner_promoted')).toBeDefined();
  });

  it('is a no-op when the target is already owner: no period churn', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const coOwnerId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, coOwnerId, 'owner', JANUARY);

    await promoteCommand(MARCH).execute(
      gardenId,
      coOwnerId,
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    const periods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', membershipId)
      .execute();
    expect(periods).toHaveLength(1);
  });

  it('rejects a non-owner actor (matrix H8, owner-only)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);

    await expect(
      promoteCommand(MARCH).execute(
        gardenId,
        viewerId,
        { profileId: editorId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a stale session: recent auth is required (matrix H8, "recent auth ≤ 30 m")', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const memberId = await insertProfile(db);
    await insertMembership(db, gardenId, memberId, 'editor', JANUARY);

    await expect(
      promoteCommand(MARCH).execute(
        gardenId,
        memberId,
        { profileId: ownerId, authenticatedAt: STALE_AUTH },
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      code: 'collaboration.membership.recent_authentication_required',
    });
  });

  it('conceals a target with no active membership as not-found', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      promoteCommand(MARCH).execute(
        gardenId,
        randomUUID(),
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('replays cleanly after completion, since the actor keeps administerOwnership throughout', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const memberId = await insertProfile(db);
    await insertMembership(db, gardenId, memberId, 'editor', JANUARY);
    const idempotencyKey = randomUUID();
    const actor = { profileId: ownerId, authenticatedAt: RECENT_AUTH };

    const first = await promoteCommand(MARCH).execute(gardenId, memberId, actor, idempotencyKey);
    const second = await promoteCommand(MARCH).execute(gardenId, memberId, actor, idempotencyKey);

    expect(second).toEqual(first);
    expect(await activeOwnerCount(db, gardenId)).toBe(2);
  });

  // --- DemoteOwner --------------------------------------------------------

  it('demotes a co-owner to editor while another active owner remains, and audits it', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    const result = await demoteCommand(MARCH).execute(
      gardenId,
      ownerBId,
      { profileId: ownerAId, authenticatedAt: RECENT_AUTH },
      'editor',
      randomUUID(),
    );

    expect(result.role).toBe('editor');
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
    expect(await auditEventFor(db, membershipId, 'membership.owner_demoted')).toBeDefined();
  });

  it('permits self-demotion while a co-owner remains', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    const result = await demoteCommand(MARCH).execute(
      gardenId,
      ownerAId,
      { profileId: ownerAId, authenticatedAt: RECENT_AUTH },
      'viewer',
      randomUUID(),
    );

    expect(result.role).toBe('viewer');
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('refuses to demote a target who is not an owner', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);

    await expect(
      demoteCommand(MARCH).execute(
        gardenId,
        editorId,
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        'viewer',
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'collaboration.membership.target_not_owner' });
  });

  it('the last-owner lock: a sole owner cannot be demoted', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      demoteCommand(MARCH).execute(
        gardenId,
        ownerId,
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        'editor',
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'collaboration.membership.last_owner_required' });
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('rejects a stale session', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    await expect(
      demoteCommand(MARCH).execute(
        gardenId,
        ownerBId,
        { profileId: ownerAId, authenticatedAt: STALE_AUTH },
        'editor',
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      code: 'collaboration.membership.recent_authentication_required',
    });
  });

  it('the last-owner lock under GENUINE concurrency: two co-owners racing to demote THEMSELVES — exactly one succeeds, the garden is never left ownerless', async () => {
    // Self-targeting on BOTH sides, deliberately — mirrors the exact shape
    // `RemoveMember`'s own concurrent self-removal test uses. Racing each
    // owner demoting the OTHER instead would confound this proof: whichever
    // side commits first also revokes the SECOND side's `administerOwnership`
    // (their own capability, spent demoting someone else), so a `403` from
    // `requireCapability` and a `422` from the last-owner lock would both be
    // valid, non-deterministic outcomes — see `demote-owner.ts`'s own header
    // for why self-targeting has no such confound: each side's authorization
    // depends only on a row the OTHER side never touches.
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    const results = await Promise.allSettled([
      demoteCommand(MARCH).execute(
        gardenId,
        ownerAId,
        { profileId: ownerAId, authenticatedAt: RECENT_AUTH },
        'editor',
        randomUUID(),
      ),
      demoteCommand(MARCH).execute(
        gardenId,
        ownerBId,
        { profileId: ownerBId, authenticatedAt: RECENT_AUTH },
        'editor',
        randomUUID(),
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'collaboration.membership.last_owner_required',
    });

    // THE POINT: never zero — exactly one owner survives, whichever
    // transaction lost the race.
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  }, 60_000);

  // --- Concurrent role transition across DIFFERENT commands --------------

  it('a promotion racing a self-removal can never leave a removed membership with an open period', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const memberId = await insertProfile(db);
    const membershipId = await insertMembership(db, gardenId, memberId, 'editor', JANUARY);

    await Promise.allSettled([
      promoteCommand(MARCH).execute(
        gardenId,
        memberId,
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
      removeMemberCommand(MARCH).execute(gardenId, memberId, memberId, randomUUID()),
    ]);

    const membership = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', membershipId)
      .executeTakeFirstOrThrow();
    const openPeriod = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', membershipId)
      .where('valid_until', 'is', null)
      .executeTakeFirst();

    if (membership.state === 'removed') {
      // THE POINT: `lockMembership`'s re-read stops a promotion in flight
      // from resurrecting a membership a concurrent removal already closed.
      expect(openPeriod).toBeUndefined();
    } else {
      expect(membership.state).toBe('active');
      expect(openPeriod).toBeDefined();
    }
  }, 60_000);
});
