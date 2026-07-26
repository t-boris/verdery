/**
 * Full-stack integration tests for ownership transfer's REQUEST side
 * (P9A-OWNER-01): `TransferOwnership`, `CancelOwnershipTransfer` — including
 * the one-pending-transfer-per-garden conflict proven under genuine
 * concurrency. `AcceptOwnershipTransfer`/`DeclineOwnershipTransfer` — the
 * ACCEPTANCE side, including the acceptance-time re-validation proofs and
 * the cross-command concurrency proof — live in
 * `collaboration-ownership-transfer-acceptance.test.ts`, split out purely to
 * keep both files under the repository's 600-line source-file limit, the
 * same reason `collaboration-ownership.test.ts` was already split from this
 * one.
 *
 * CONFIRMATION POLICY, reflected throughout this file: the owner reviewed
 * and overrode this codebase's first, no-acceptance reading of section 11 —
 * see `domain/ownership-transfer.ts`'s header for the full argument.
 * `TransferOwnership` now only REQUESTS a transfer; it never changes any
 * membership's role. The tests below assert exactly that.
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
import { CancelOwnershipTransfer } from '../../src/modules/gardens-mapping/application/cancel-ownership-transfer.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { TransferOwnership } from '../../src/modules/gardens-mapping/application/transfer-ownership.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activeOwnerCount,
  auditEventFor,
  fixedClock,
  insertGarden,
  insertMembership,
  insertPendingOwnershipTransfer,
  insertProfile,
} from '../support/collaboration-integration-harness.js';

const SUITE_NAME = 'collaboration ownership transfer integration';
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

    // Headroom for the concurrent-transfer-request test's overlapping
    // in-flight transactions plus ordinary fixtures.
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

  function cancelCommand(now: Date) {
    return new CancelOwnershipTransfer(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(now),
    );
  }

  // --- TransferOwnership ---------------------------------------------------

  it('requests a transfer: it stays PENDING, changes neither role, and audits the request (not a completion)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const ownerMembershipId = await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    const transfer = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    // THE POINT: still pending, nobody's role moved.
    expect(transfer.state).toBe('pending');
    expect(transfer.fromProfileId).toBe(ownerId);
    expect(transfer.toProfileId).toBe(targetId);
    expect(transfer.fromResultingRole).toBe('viewer');
    expect(transfer.completedAt).toBeUndefined();

    const ownerRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', ownerMembershipId)
      .executeTakeFirstOrThrow();
    expect(ownerRow.role).toBe('owner');
    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('editor');
    expect(await activeOwnerCount(db, gardenId)).toBe(1);

    // No period churn on either side: requesting is not yet a role change.
    const ownerPeriods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', ownerMembershipId)
      .execute();
    expect(ownerPeriods).toHaveLength(1);
    const targetPeriods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', targetMembershipId)
      .execute();
    expect(targetPeriods).toHaveLength(1);

    expect(await auditEventFor(db, transfer.id, 'ownership_transfer.requested')).toBeDefined();
    expect(await auditEventFor(db, transfer.id, 'ownership_transfer.completed')).toBeUndefined();
    const outboxEvent = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', transfer.id)
      .where('event_type', '=', 'ownership_transfer.requested')
      .executeTakeFirst();
    expect(outboxEvent).toBeDefined();
  });

  it('the caller remains owner throughout the pending window: a retry with the SAME idempotency key replays cleanly rather than losing capability', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const idempotencyKey = randomUUID();
    const actor = { profileId: ownerId, authenticatedAt: RECENT_AUTH };

    const first = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      actor,
      idempotencyKey,
    );
    const second = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      actor,
      idempotencyKey,
    );

    expect(second).toEqual(first);
    expect(second.state).toBe('pending');
  });

  it('rejects transferring to a target who is not an active member', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      transferCommand(MARCH).execute(
        gardenId,
        randomUUID(),
        'editor',
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects transferring to a target who is already an owner', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);

    await expect(
      transferCommand(MARCH).execute(
        gardenId,
        ownerBId,
        'editor',
        { profileId: ownerAId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'collaboration.membership.target_already_owner' });
  });

  it('rejects transferring to oneself', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      transferCommand(MARCH).execute(
        gardenId,
        ownerId,
        'editor',
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a stale session', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    await expect(
      transferCommand(MARCH).execute(
        gardenId,
        targetId,
        'editor',
        { profileId: ownerId, authenticatedAt: STALE_AUTH },
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      code: 'collaboration.membership.recent_authentication_required',
    });
  });

  it('handles the one-pending-transfer-per-garden constraint with a clean conflict error, not a raw constraint violation', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const otherTargetId = await insertProfile(db);
    await insertMembership(db, gardenId, otherTargetId, 'viewer', JANUARY);
    await insertPendingOwnershipTransfer(db, gardenId, ownerId, otherTargetId);

    await expect(
      transferCommand(MARCH).execute(
        gardenId,
        targetId,
        'editor',
        { profileId: ownerId, authenticatedAt: RECENT_AUTH },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('concurrent transfer REQUESTS: the same owner racing two DIFFERENT targets — exactly one request is accepted as pending, the other is rejected as a conflict, and NEITHER touches a membership role', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetAId = await insertProfile(db);
    await insertMembership(db, gardenId, targetAId, 'editor', JANUARY);
    const targetBId = await insertProfile(db);
    await insertMembership(db, gardenId, targetBId, 'viewer', JANUARY);
    const actor = { profileId: ownerId, authenticatedAt: RECENT_AUTH };

    // THE POINT: both calls share `fromMembership` (the SAME owner's own
    // row) — `lockMembership(fromMembership.id)` serializes them on that one
    // row, so whichever wins commits its INSERT first, and the other's own
    // INSERT then loses to `ownership_transfer_pending_key` rather than
    // racing to a contradictory outcome. Since this command no longer writes
    // any membership role, "contradictory outcome" here means two pending
    // rows for one garden — not two owners.
    const results = await Promise.allSettled([
      transferCommand(MARCH).execute(gardenId, targetAId, 'editor', actor, randomUUID()),
      transferCommand(MARCH).execute(gardenId, targetBId, 'editor', actor, randomUUID()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'collaboration.ownership_transfer.already_pending',
    });

    // Neither request completes anything by itself: the original owner is
    // still THE owner, and neither target has become one.
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
    const ownerRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('profile_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(ownerRow.role).toBe('owner');
  }, 60_000);

  // --- CancelOwnershipTransfer ---------------------------------------------

  it('cancels a pending transfer and audits it', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const transferId = await insertPendingOwnershipTransfer(db, gardenId, ownerId, targetId);

    const cancelled = await cancelCommand(MARCH).execute(gardenId, ownerId, randomUUID());

    expect(cancelled.id).toBe(transferId);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.cancelledAt).toBeDefined();
    expect(await auditEventFor(db, transferId, 'ownership_transfer.cancelled')).toBeDefined();

    // Untouched: cancelling does not move any role.
    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('profile_id', '=', targetId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('editor');
  });

  it('reports not-found when nothing is pending', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      cancelCommand(MARCH).execute(gardenId, ownerId, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });
  });

  it('rejects a non-owner actor', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);

    await expect(
      cancelCommand(MARCH).execute(gardenId, editorId, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
