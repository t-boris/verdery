/**
 * Full-stack integration tests for P9A-SYNC-01's own central gap and
 * completion evidence — real `RemoveMember`/`AcceptInvitation`/
 * `ChangeMemberRole`/`PromoteToOwner`/`DemoteOwner` commands, real
 * `GetSyncChanges`, against real PostgreSQL/PostGIS.
 *
 * Covers exactly the scenarios the work package names:
 *
 * - REVOCATION: `RemoveMember` now emits the same `garden`/`delete`
 *   tombstone `garden-membership-revocation.ts` already establishes for
 *   garden-deletion-driven revocation, addressed to the removed member alone.
 * - CLEANUP (the server side of the contract): after the tombstone, no
 *   further `garden`/`gardenObject`/`plant`/`task` row for that garden is
 *   EVER delivered to the removed profile again — proven even when new
 *   content is added by a remaining member afterward.
 * - GRANT: `AcceptInvitation` now emits a `garden`/`upsert` addressed to the
 *   new member alone, mirroring `restoreGardenMemberships`'s own shape for
 *   regaining access, applied here to gaining it the first time.
 * - Offline membership-change / role change: `ChangeMemberRole`/
 *   `PromoteToOwner`/`DemoteOwner` change a role but never produce a spurious
 *   revocation or grant.
 * - CONVERGENCE: two profiles — one that joined mid-stream and one that was
 *   active throughout a role change — eventually reconstruct the identical
 *   authoritative content set for the garden.
 *
 * Source: docs/implementation-plan.md, work package P9A-SYNC-01;
 *         architecture/offline-synchronization.md, sections "11. Authorization
 *         Changes", "11.1 Implemented revocation profile";
 *         gardens-mapping/application/garden-membership-revocation.ts.
 */

import type { SyncChangesResult } from '@verdery/api-contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness, syncActor } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'synchronization membership lifecycle integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
}

function gardenIds(result: SyncChangesResult): readonly string[] {
  return result.items.map((item) => `${item.recordType}:${item.recordId}:${item.operation}`);
}

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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function createGardenAndInviteMember(now: Date, role: 'editor' | 'viewer' = 'editor') {
    const ownerId = generateUuidV7();
    const memberId = generateUuidV7();
    await insertProfile(db, ownerId);
    await insertProfile(db, memberId);

    const harness = buildSyncTestHarness(db, fixedClock(now));
    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());
    const invitation = await harness.createInvitation.execute(
      garden.id,
      ownerId,
      { intendedRole: role },
      generateUuidV7(),
    );
    await harness.acceptInvitation.execute(
      { profileId: memberId, email: undefined, emailVerified: false },
      invitation.token,
      generateUuidV7(),
    );

    return { ownerId, memberId, gardenId: garden.id };
  }

  it('REVOCATION: RemoveMember emits a garden/delete tombstone addressed to the removed member alone', async () => {
    const now = new Date('2026-07-22T10:00:00Z');
    const { ownerId, memberId, gardenId } = await createGardenAndInviteMember(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    // The member's own baseline pull, so the next one only carries what
    // happens from here on.
    const baseline = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    await harness.removeMember.execute(gardenId, memberId, ownerId, generateUuidV7());

    const afterRemoval = await harness.getSyncChanges.execute(memberId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });

    expect(afterRemoval.items).toHaveLength(1);
    expect(afterRemoval.items[0]).toMatchObject({
      recordType: 'garden',
      operation: 'delete',
      gardenId,
      recordId: gardenId,
    });
    expect(afterRemoval.items[0]).not.toHaveProperty('record');

    // The still-active owner's own pull is unaffected: the tombstone is
    // addressed to the removed member alone.
    const ownerBaseline = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(ownerBaseline.items.some((item) => item.operation === 'delete')).toBe(false);
  });

  it("REVOCATION: self-removal (H12) also produces the tombstone, addressed to the caller's own next pull", async () => {
    const now = new Date('2026-07-22T10:05:00Z');
    const { memberId, gardenId } = await createGardenAndInviteMember(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const baseline = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    // Self-removal: actor and target are the same profile.
    await harness.removeMember.execute(gardenId, memberId, memberId, generateUuidV7());

    const afterRemoval = await harness.getSyncChanges.execute(memberId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });

    expect(afterRemoval.items).toHaveLength(1);
    expect(afterRemoval.items[0]).toMatchObject({ recordType: 'garden', operation: 'delete' });
  });

  it('CLEANUP: no further garden/plant/task row ever reaches the removed profile, even for content added afterward', async () => {
    const now = new Date('2026-07-22T10:10:00Z');
    const { ownerId, memberId, gardenId } = await createGardenAndInviteMember(now);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    // Content that exists BEFORE revocation — the member has already seen it.
    await harness.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Basil', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );
    const beforeRemoval = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(beforeRemoval.items.length).toBeGreaterThan(0);

    await harness.removeMember.execute(gardenId, memberId, ownerId, generateUuidV7());

    const tombstonePage = await harness.getSyncChanges.execute(memberId, {
      after: beforeRemoval.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(tombstonePage.items).toHaveLength(1);
    expect(tombstonePage.items[0]).toMatchObject({ recordType: 'garden', operation: 'delete' });

    // New content added by the remaining owner AFTER revocation.
    await harness.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Mint', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );
    await harness.createManualTask.execute(
      gardenId,
      ownerId,
      {
        taskId: generateUuidV7(),
        target: { kind: 'garden' },
        title: 'Weed the beds',
        notes: null,
        dueDate: null,
        originObservationId: null,
      },
      generateUuidV7(),
    );

    const afterNewContent = await harness.getSyncChanges.execute(memberId, {
      after: tombstonePage.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterNewContent.items).toHaveLength(0);

    // Even a fresh, first-ever pull (cursor omitted) for this now-removed
    // profile sees only its own tombstone — never the plant or task content,
    // old or new.
    const freshPull = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(freshPull.items.filter((item) => item.gardenId === gardenId)).toEqual([
      expect.objectContaining({ recordType: 'garden', operation: 'delete' }),
    ]);
  });

  it('GRANT: AcceptInvitation emits a garden/upsert addressed to the new member alone', async () => {
    const now = new Date('2026-07-22T10:15:00Z');
    const ownerId = generateUuidV7();
    const memberId = generateUuidV7();
    await insertProfile(db, ownerId);
    await insertProfile(db, memberId);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    // The owner's own baseline pull, so a later pull only carries what
    // happens from here on — proving the grant is invisible to them.
    const ownerBaseline = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    const invitation = await harness.createInvitation.execute(
      garden.id,
      ownerId,
      { intendedRole: 'editor' },
      generateUuidV7(),
    );
    await harness.acceptInvitation.execute(
      { profileId: memberId, email: undefined, emailVerified: false },
      invitation.token,
      generateUuidV7(),
    );

    // Proof of the actual mechanism: a `garden`/`upsert` row addressed
    // specifically to the new member exists in `platform.sync_change`.
    const grantRow = await db
      .selectFrom('platform.sync_change')
      .selectAll()
      .where('garden_id', '=', garden.id)
      .where('operation', '=', 'upsert')
      .where('record_type', '=', 'garden')
      .where('target_profile_id', '=', memberId)
      .executeTakeFirst();
    expect(grantRow).toBeDefined();

    // The new member's own first-ever pull includes the garden.
    const memberPull = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(
      memberPull.items.some((item) => item.gardenId === garden.id && item.recordType === 'garden'),
    ).toBe(true);

    // The owner's own next pull carries nothing from this grant — it was
    // addressed to the new member alone.
    const ownerAfterGrant = await harness.getSyncChanges.execute(ownerId, {
      after: ownerBaseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(ownerAfterGrant.items).toHaveLength(0);
  });

  it('ROLE CHANGE: ChangeMemberRole (editor <-> viewer) produces no spurious revocation or grant', async () => {
    const now = new Date('2026-07-22T10:20:00Z');
    const { ownerId, memberId, gardenId } = await createGardenAndInviteMember(now, 'editor');
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const baseline = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    const syncChangeCountBefore = await db
      .selectFrom('platform.sync_change')
      .select(db.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();

    await harness.changeMemberRole.execute(gardenId, memberId, ownerId, 'viewer', generateUuidV7());

    const syncChangeCountAfter = await db
      .selectFrom('platform.sync_change')
      .select(db.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(syncChangeCountAfter.count)).toBe(Number(syncChangeCountBefore.count));

    // The member's own local role was stale (editor); the next sync pull
    // must not corrupt or interrupt their local state — no revocation, no
    // grant, nothing at all for this garden.
    const afterRoleChange = await harness.getSyncChanges.execute(memberId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterRoleChange.items).toHaveLength(0);

    // The garden partition still works normally afterward: new content is
    // delivered exactly as it would have been before the role change.
    await harness.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Chives', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );
    const afterNewContent = await harness.getSyncChanges.execute(memberId, {
      after: afterRoleChange.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterNewContent.items).toHaveLength(1);
    expect(afterNewContent.items[0]).toMatchObject({ recordType: 'plant', operation: 'upsert' });
  });

  it('ROLE CHANGE: PromoteToOwner/DemoteOwner produce no spurious revocation or grant', async () => {
    const now = new Date('2026-07-22T10:25:00Z');
    const { ownerId, memberId, gardenId } = await createGardenAndInviteMember(now, 'editor');
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const baseline = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    await harness.promoteToOwner.execute(gardenId, memberId, syncActor(ownerId), generateUuidV7());
    await harness.demoteOwner.execute(
      gardenId,
      memberId,
      syncActor(ownerId),
      'editor',
      generateUuidV7(),
    );

    const afterOwnershipChanges = await harness.getSyncChanges.execute(memberId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterOwnershipChanges.items).toHaveLength(0);
  });

  it('CONVERGENCE: a profile that joined mid-stream and one active throughout a role change reconstruct the identical content set', async () => {
    const now = new Date('2026-07-22T10:30:00Z');
    const ownerId = generateUuidV7();
    const memberId = generateUuidV7();
    await insertProfile(db, ownerId);
    await insertProfile(db, memberId);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());
    const sharedGardenId = garden.id;
    await harness.addPlant.execute(
      sharedGardenId,
      ownerId,
      { displayName: 'Rosemary', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );

    // The owner has been "online" throughout and already has a cursor.
    const ownerBaseline = await harness.getSyncChanges.execute(ownerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    // The member joins mid-stream (was "offline" until now) and is promoted
    // shortly after joining — a role change in the middle of catching up.
    const invitation = await harness.createInvitation.execute(
      sharedGardenId,
      ownerId,
      { intendedRole: 'editor' },
      generateUuidV7(),
    );
    await harness.acceptInvitation.execute(
      { profileId: memberId, email: undefined, emailVerified: false },
      invitation.token,
      generateUuidV7(),
    );
    await harness.changeMemberRole.execute(
      sharedGardenId,
      memberId,
      ownerId,
      'viewer',
      generateUuidV7(),
    );

    // More content added after the join and the role change.
    await harness.addPlant.execute(
      sharedGardenId,
      ownerId,
      { displayName: 'Sage', groupingKind: 'individual', plantId: generateUuidV7() },
      generateUuidV7(),
    );

    // Both profiles now pull everything available to them.
    const memberFull = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    const ownerIncremental = await harness.getSyncChanges.execute(ownerId, {
      after: ownerBaseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });

    // Reconstruct each profile's own authoritative content set for this
    // garden: (recordType, recordId) pairs from every upsert either has ever
    // seen for it. Both must converge on the same plants, regardless of how
    // many rows or which addressing delivered them.
    const memberPlantIds = new Set(
      memberFull.items
        .filter((item) => item.gardenId === sharedGardenId && item.recordType === 'plant')
        .map((item) => item.recordId),
    );
    const ownerPlantIds = new Set(
      [...ownerBaseline.items, ...ownerIncremental.items]
        .filter((item) => item.gardenId === sharedGardenId && item.recordType === 'plant')
        .map((item) => item.recordId),
    );

    expect(memberPlantIds.size).toBe(2);
    expect(ownerPlantIds).toEqual(memberPlantIds);

    // And the role change itself produced no extra, spurious rows for the
    // garden partition beyond ordinary content and the one grant.
    expect(gardenIds(ownerIncremental).every((key) => key.startsWith('plant:'))).toBe(true);
  });
});
