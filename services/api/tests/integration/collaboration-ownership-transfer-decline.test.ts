/**
 * Full-stack integration tests for `DeclineOwnershipTransfer` (P9A-OWNER-01)
 * — the recipient's own refusal of a pending transfer, distinct from the
 * initiator's `CancelOwnershipTransfer` (see that file's header for why the
 * two are not merged into one command) — plus a genuine concurrency proof
 * that `AcceptOwnershipTransfer` racing a concurrent change to the SAME
 * membership row never leaves the garden with zero or two active owners.
 * Split out from `collaboration-ownership-transfer-acceptance.test.ts`
 * (`AcceptOwnershipTransfer`'s own tests) purely to keep both files under the
 * repository's 600-line source-file limit.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * docs/development/garden-capability-matrix.md, row H13;
 * migrations/1786500000000_collaboration-operations-and-attribution.sql.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { AcceptOwnershipTransfer } from '../../src/modules/gardens-mapping/application/accept-ownership-transfer.js';
import { CancelOwnershipTransfer } from '../../src/modules/gardens-mapping/application/cancel-ownership-transfer.js';
import { DeclineOwnershipTransfer } from '../../src/modules/gardens-mapping/application/decline-ownership-transfer.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { RemoveMember } from '../../src/modules/gardens-mapping/application/remove-member.js';
import { TransferOwnership } from '../../src/modules/gardens-mapping/application/transfer-ownership.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
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

const SUITE_NAME = 'collaboration ownership transfer decline integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');
const APRIL = new Date('2026-04-10T09:00:00Z');
const RECENT_AUTH = new Date(MARCH.getTime() - 5 * 60 * 1000);

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

    // Headroom for the concurrency proof's overlapping in-flight
    // transactions plus ordinary fixtures.
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function transferCommand(now: Date) {
    return new TransferOwnership(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function acceptCommand(now: Date) {
    return new AcceptOwnershipTransfer(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function declineCommand(now: Date) {
    return new DeclineOwnershipTransfer(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  function cancelCommand(now: Date) {
    return new CancelOwnershipTransfer(
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

  // --- DeclineOwnershipTransfer ---------------------------------------------

  it('declines a pending transfer: marks it cancelled with a recipient-attributed reason, and changes no role', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    const declined = await declineCommand(APRIL).execute(
      gardenId,
      { profileId: targetId },
      randomUUID(),
    );

    expect(declined.id).toBe(requested.id);
    expect(declined.state).toBe('cancelled');
    expect(declined.cancellationReason).toBe('declined_by_recipient');
    expect(declined.cancelledAt).toBeDefined();

    const ownerRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('profile_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(ownerRow.role).toBe('owner');
    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('editor');

    expect(await auditEventFor(db, declined.id, 'ownership_transfer.declined')).toBeDefined();
  });

  it('conceals a transfer addressed to someone else: a different active member cannot decline it', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const bystanderId = await insertProfile(db);
    await insertMembership(db, gardenId, bystanderId, 'viewer', JANUARY);
    await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    await expect(
      declineCommand(APRIL).execute(gardenId, { profileId: bystanderId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });
  });

  it('reports not-found when nothing is pending', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    await expect(
      declineCommand(MARCH).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });
  });

  it('is idempotent-safe: declining an already-accepted transfer fails cleanly rather than corrupting the completed state', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );
    await acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID());

    await expect(
      declineCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });

    // The completed transfer is not clobbered back to cancelled — exactly
    // the corrupted-outcome `lockPendingForGarden` exists to prevent (see
    // `ownership-transfer-repository.ts`'s header).
    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('profile_id', '=', targetId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('owner');
  });

  // --- Concurrency across commands -----------------------------------------

  it('a genuine concurrency proof: acceptance racing the recipient’s own self-removal never leaves the garden with zero or two active owners', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'editor',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    // THE RACE: the recipient accepting, racing the recipient removing
    // themselves — both statements contend for the SAME membership row
    // (`AcceptOwnershipTransfer` via `lockMembership`; `RemoveMember` via
    // whichever write reaches the row first, since a non-owner self-removal
    // takes no lock of its own — see `remove-member.ts`'s header). Mirrors
    // `collaboration-ownership.test.ts`'s "a promotion racing a
    // self-removal" proof exactly, substituting acceptance for promotion.
    const results = await Promise.allSettled([
      acceptCommand(MARCH).execute(gardenId, { profileId: targetId }, randomUUID()),
      removeMemberCommand(MARCH).execute(gardenId, targetId, targetId, randomUUID()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    const transferRow = await db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();

    if (targetRow.state === 'removed') {
      // RemoveMember won: acceptance must have failed cleanly against the
      // now-inactive row, leaving the transfer pending and the original
      // owner untouched.
      expect(transferRow.state).toBe('pending');
      const ownerRow = await db
        .selectFrom('collaboration.membership')
        .selectAll()
        .where('profile_id', '=', ownerId)
        .executeTakeFirstOrThrow();
      expect(ownerRow.role).toBe('owner');
    } else {
      // Acceptance won: the target is now the sole active owner, and their
      // own self-removal was correctly refused by the last-owner rule.
      expect(targetRow.role).toBe('owner');
      expect(targetRow.state).toBe('active');
      expect(transferRow.state).toBe('completed');
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'collaboration.membership.last_owner_required',
      });
    }

    // THE INVARIANT THAT MUST HOLD REGARDLESS OF WHICH ORDER WON: never
    // zero, never two.
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  }, 60_000);

  it('a genuine concurrency proof: acceptance racing the initiator’s own cancellation of the SAME pending transfer never leaves the transfer row contradicting the membership rows', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    // THE RACE: the recipient accepting, racing the initiator cancelling the
    // SAME pending transfer ROW (not a membership row this time).
    // `lockPendingForGarden`, not the unlocked `findPendingForGarden`, is
    // what serializes these two — see `ownership-transfer-repository.ts`'s
    // header for the corrupted outcome this specifically exists to prevent:
    // without it, whichever of these two committed LAST could silently
    // overwrite the other's `state`, leaving the transfer row contradicting
    // whatever it did or did not just write to the membership rows.
    const results = await Promise.allSettled([
      acceptCommand(MARCH).execute(gardenId, { profileId: targetId }, randomUUID()),
      cancelCommand(MARCH).execute(gardenId, ownerId, randomUUID()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'collaboration.ownership_transfer.not_found',
    });

    const transferRow = await db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('id', '=', requested.id)
      .executeTakeFirstOrThrow();
    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    const ownerRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('profile_id', '=', ownerId)
      .executeTakeFirstOrThrow();

    // THE POINT: the transfer row's own state and the membership rows never
    // disagree, whichever side won.
    if (transferRow.state === 'completed') {
      expect(targetRow.role).toBe('owner');
      expect(ownerRow.role).toBe('viewer');
    } else {
      expect(transferRow.state).toBe('cancelled');
      expect(targetRow.role).toBe('editor');
      expect(ownerRow.role).toBe('owner');
    }
  }, 60_000);
});
