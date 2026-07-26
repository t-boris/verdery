/**
 * Full-stack integration tests for `AcceptOwnershipTransfer` (P9A-OWNER-01)
 * — the command that actually moves ownership — including the
 * acceptance-time re-validation this rework specifically requires (the
 * transfer's source owner or its own recipient may have changed while the
 * transfer sat pending) and the idempotent-safety proofs against an
 * already-completed or already-cancelled transfer.
 * `DeclineOwnershipTransfer` and the cross-command concurrency proof live in
 * `collaboration-ownership-transfer-decline.test.ts`; `TransferOwnership`/
 * `CancelOwnershipTransfer` (the REQUEST side) live in
 * `collaboration-ownership-transfer.test.ts` — split three ways purely to
 * keep every file under the repository's 600-line source-file limit.
 *
 * CONFIRMATION POLICY: the owner reviewed and overrode this codebase's
 * first, no-acceptance reading of section 11 — see `domain/ownership-
 * transfer.ts`'s header for the full argument. Every transfer now stays
 * `pending` until its named recipient calls `AcceptOwnershipTransfer` (this
 * file) or `DeclineOwnershipTransfer`, or its initiator calls
 * `CancelOwnershipTransfer`.
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
import { DemoteOwner } from '../../src/modules/gardens-mapping/application/demote-owner.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { PromoteToOwner } from '../../src/modules/gardens-mapping/application/promote-to-owner.js';
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

const SUITE_NAME = 'collaboration ownership transfer acceptance integration';
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

  function cancelCommand(now: Date) {
    return new CancelOwnershipTransfer(
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

  function promoteCommand(now: Date) {
    return new PromoteToOwner(
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

  // --- AcceptOwnershipTransfer ---------------------------------------------

  it('accepts a pending transfer: both roles change atomically, both periods close/open correctly, and completion is audited', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const ownerMembershipId = await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    const accepted = await acceptCommand(APRIL).execute(
      gardenId,
      { profileId: targetId },
      randomUUID(),
    );

    expect(accepted.id).toBe(requested.id);
    expect(accepted.state).toBe('completed');
    expect(accepted.completedAt).toBeDefined();

    const ownerRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', ownerMembershipId)
      .executeTakeFirstOrThrow();
    expect(ownerRow.role).toBe('viewer');
    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('owner');
    expect(await activeOwnerCount(db, gardenId)).toBe(1);

    const ownerPeriods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', ownerMembershipId)
      .orderBy('valid_from', 'asc')
      .execute();
    expect(ownerPeriods).toHaveLength(2);
    expect(ownerPeriods[0]).toMatchObject({ role: 'owner', ended_reason: 'role_changed' });
    expect(ownerPeriods[1]).toMatchObject({ role: 'viewer', valid_until: null });

    const targetPeriods = await db
      .selectFrom('collaboration.membership_period')
      .selectAll()
      .where('membership_id', '=', targetMembershipId)
      .orderBy('valid_from', 'asc')
      .execute();
    expect(targetPeriods).toHaveLength(2);
    expect(targetPeriods[0]).toMatchObject({ role: 'editor', ended_reason: 'role_changed' });
    expect(targetPeriods[1]).toMatchObject({ role: 'owner', valid_until: null });

    expect(await auditEventFor(db, accepted.id, 'ownership_transfer.completed')).toBeDefined();
    const outboxEvent = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', accepted.id)
      .where('event_type', '=', 'ownership_transfer.completed')
      .executeTakeFirst();
    expect(outboxEvent).toBeDefined();
  });

  it('is idempotent: a retry with the SAME idempotency key after completion replays the identical result', async () => {
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
    const idempotencyKey = randomUUID();

    const first = await acceptCommand(APRIL).execute(
      gardenId,
      { profileId: targetId },
      idempotencyKey,
    );
    const second = await acceptCommand(APRIL).execute(
      gardenId,
      { profileId: targetId },
      idempotencyKey,
    );

    expect(second).toEqual(first);
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('is idempotent-safe against an already-completed transfer: a DIFFERENT idempotency key fails cleanly rather than re-applying', async () => {
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
      acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });

    // Not a crash, and not re-applied: still exactly one owner.
    expect(await activeOwnerCount(db, gardenId)).toBe(1);
  });

  it('is idempotent-safe against an already-cancelled transfer', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );
    await cancelCommand(MARCH).execute(gardenId, ownerId, randomUUID());

    await expect(
      acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });

    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('editor');
  });

  it('re-validation: fails cleanly, without corrupting anything, when the source owner was DEMOTED after the request but before acceptance', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    const targetMembershipId = await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerAId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );
    await demoteCommand(MARCH).execute(
      gardenId,
      ownerAId,
      { profileId: ownerBId, authenticatedAt: RECENT_AUTH },
      'editor',
      randomUUID(),
    );

    await expect(
      acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.membership.target_not_owner' });

    const targetRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('id', '=', targetMembershipId)
      .executeTakeFirstOrThrow();
    expect(targetRow.role).toBe('editor');
    const transferRow = await db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('id', '=', requested.id)
      .executeTakeFirstOrThrow();
    expect(transferRow.state).toBe('pending');
  });

  it('re-validation: fails cleanly when the source owner was REMOVED after the request but before acceptance', async () => {
    const ownerAId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenId, ownerAId, 'owner', JANUARY);
    const ownerBId = await insertProfile(db);
    await insertMembership(db, gardenId, ownerBId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerAId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );
    await removeMemberCommand(MARCH).execute(gardenId, ownerAId, ownerBId, randomUUID());

    await expect(
      acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.membership.target_not_owner' });

    const transferRow = await db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('id', '=', requested.id)
      .executeTakeFirstOrThrow();
    expect(transferRow.state).toBe('pending');
  });

  it('re-validation: fails cleanly when the target lost membership entirely after the request but before acceptance', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );
    // Self-removal, fully committed before the accept attempt below — the
    // target has no active membership left at all, so `requireCapability`'s
    // own concealment (not this command's inner re-validation) is what
    // rejects the attempt, the same posture every other command in this
    // module already takes toward a caller with no access to speak of.
    await removeMemberCommand(MARCH).execute(gardenId, targetId, targetId, randomUUID());

    await expect(
      acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'garden.not_found' });

    const transferRow = await db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('id', '=', requested.id)
      .executeTakeFirstOrThrow();
    expect(transferRow.state).toBe('pending');
    const ownerRow = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('profile_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(ownerRow.role).toBe('owner');
  });

  it('re-validation: fails cleanly when the target is already an owner (promoted elsewhere while the transfer stayed pending)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);

    const requested = await transferCommand(MARCH).execute(
      gardenId,
      targetId,
      'viewer',
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );
    await promoteCommand(MARCH).execute(
      gardenId,
      targetId,
      { profileId: ownerId, authenticatedAt: RECENT_AUTH },
      randomUUID(),
    );

    await expect(
      acceptCommand(APRIL).execute(gardenId, { profileId: targetId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.membership.target_already_owner' });

    const transferRow = await db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('id', '=', requested.id)
      .executeTakeFirstOrThrow();
    expect(transferRow.state).toBe('pending');
    expect(await activeOwnerCount(db, gardenId)).toBe(2);
  });

  it('conceals a transfer addressed to someone else: a different active member cannot accept it', async () => {
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
      acceptCommand(APRIL).execute(gardenId, { profileId: bystanderId }, randomUUID()),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });
  });
});
