/**
 * P9-QA-01 (Batch A), matrix 1 — THE OPERATIONAL-TEAM CHAIN.
 *
 * This is deliberately NOT a re-test of any single P9A work package's own
 * claim in isolation — `collaboration-invitations.test.ts`,
 * `collaboration-ownership.test.ts`, `tasks-recommendations-collaboration
 * .test.ts`, and `synchronization-membership-lifecycle.test.ts` already each
 * prove their own slice against real Postgres. This file's value is
 * CHAINING every one of those subphases together as ONE continuous
 * scenario an owner and a household member actually live through: invite ->
 * accept -> promote to co-owner -> assign a task to them -> remove them as a
 * member — and then proving, in that exact chained state (a profile who was
 * briefly a CO-OWNER with a real assignment, not merely an editor who was
 * never promoted), that P9A-SYNC-01's own fix still holds: their next
 * authenticated call is denied, AND their next sync pull emits the
 * `garden`/`delete` tombstone `RemoveMember` is responsible for producing.
 *
 * `synchronization-membership-lifecycle.test.ts`'s own "REVOCATION" test
 * already proves the tombstone for a plain editor removed directly, never
 * chained through a promotion or an assignment first — this file's own
 * reason to exist is proving the fix survives the FULLER, more realistic
 * chain, not a second proof of the same isolated fact.
 *
 * Source: implementation-plan.md work packages P9A-API-01, P9A-OWNER-01,
 * P9A-TASK-01, P9A-SYNC-01; architecture/collaboration-and-client-sharing.md,
 * sections "5. Operational Invitation and Co-Ownership", "15. Synchronization
 * and Revocation"; architecture/offline-synchronization.md, section
 * "11. Authorization Changes".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness, syncActor } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'p9-qa: operational-team chain (invite -> co-owner -> assignment -> removal)';
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

  it('invite -> accept -> promote to co-owner -> assign a task -> remove: the removed co-owner is denied every subsequent REST call and their sync pull emits the RemoveMember tombstone', async () => {
    const now = new Date('2026-07-22T10:00:00Z');
    const ownerId = generateUuidV7();
    const memberId = generateUuidV7();
    await insertProfile(db, ownerId);
    await insertProfile(db, memberId);
    const harness = buildSyncTestHarness(db, fixedClock(now));

    // --- Step 1: invite -----------------------------------------------
    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());
    const invitation = await harness.createInvitation.execute(
      garden.id,
      ownerId,
      { intendedRole: 'editor' },
      generateUuidV7(),
    );

    // --- Step 2: accept -------------------------------------------------
    await harness.acceptInvitation.execute(
      { profileId: memberId, email: undefined, emailVerified: false },
      invitation.token,
      generateUuidV7(),
    );
    // Sanity: the member's own access is genuinely real before the chain
    // continues — an editor holds ordinary content capability, not yet
    // `manageGarden`.
    await expect(harness.getGarden.execute(garden.id, memberId)).resolves.toBeDefined();
    await expect(
      harness.gardenAuthorization.requireCapability(garden.id, memberId, 'manageGarden'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // --- Step 3: promote to co-owner ------------------------------------
    await harness.promoteToOwner.execute(garden.id, memberId, syncActor(ownerId), generateUuidV7());
    // Sanity: the promotion is genuinely real — the member now holds an
    // owner-only capability, not merely still an editor.
    const coOwnerGrant = await harness.gardenAuthorization.requireCapability(
      garden.id,
      memberId,
      'manageGarden',
    );
    expect(coOwnerGrant.role).toBe('owner');

    // --- Step 4: assign a task to them -----------------------------------
    const task = await harness.createManualTask.execute(
      garden.id,
      ownerId,
      {
        target: { kind: 'garden' },
        title: 'Turn the compost',
        notes: null,
        dueDate: null,
        originObservationId: null,
      },
      generateUuidV7(),
    );
    const assigned = await harness.assignTask.execute(
      task.id,
      ownerId,
      task.revision,
      memberId,
      generateUuidV7(),
    );
    expect(assigned.assignedProfileId).toBe(memberId);

    // The member's own baseline sync pull, taken AFTER every grant above —
    // so the next pull below carries only what the removal itself produces,
    // isolating the tombstone from the invite/promotion/assignment noise
    // that (correctly) already reached them.
    const baseline = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(baseline.items.length).toBeGreaterThan(0);

    // --- Step 5: remove them as a member ----------------------------------
    // The member is now a CO-OWNER (not a plain editor) — `RemoveMember`
    // must still permit this because a second active owner (the original
    // `ownerId`) remains; a last-owner removal would be a domain-rule
    // violation, a different case this test does not exercise.
    await harness.removeMember.execute(garden.id, memberId, ownerId, generateUuidV7());

    // --- Proof A: their next authenticated call is denied -----------------
    await expect(harness.getGarden.execute(garden.id, memberId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      harness.createManualTask.execute(
        garden.id,
        memberId,
        {
          target: { kind: 'garden' },
          title: 'Should never be created',
          notes: null,
          dueDate: null,
          originObservationId: null,
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // --- Proof B: their sync pull emits the RemoveMember tombstone --------
    const afterRemoval = await harness.getSyncChanges.execute(memberId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterRemoval.items).toHaveLength(1);
    expect(afterRemoval.items[0]).toMatchObject({
      recordType: 'garden',
      operation: 'delete',
      gardenId: garden.id,
      recordId: garden.id,
    });
    expect(afterRemoval.items[0]).not.toHaveProperty('record');

    // A fresh, first-ever pull (cursor omitted) for the now-removed co-owner
    // sees ONLY the tombstone for this garden — never the task, the
    // assignment, or anything upstream of it, the same "no further row ever
    // reaches the removed profile" guarantee proven for a plain editor in
    // `synchronization-membership-lifecycle.test.ts`, now proven for a
    // profile who was briefly a genuine co-owner.
    const freshPull = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });
    expect(freshPull.items.filter((item) => item.gardenId === garden.id)).toEqual([
      expect.objectContaining({ recordType: 'garden', operation: 'delete' }),
    ]);

    // --- Proof C: the denial is scoped to the removed co-owner alone ------
    // The original owner, still active, is entirely unaffected: their own
    // access, the garden, and the assigned task all remain exactly as the
    // chain left them.
    await expect(harness.getGarden.execute(garden.id, ownerId)).resolves.toBeDefined();
    const stillAssignedTask = await harness.taskRepository.findById(task.id);
    expect(stillAssignedTask?.assignedProfileId).toBe(memberId);
  });
});
