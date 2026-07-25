/**
 * Recovery-window verification for garden deletion (P8-DELETE-01): the gates
 * that must hold before anything is destroyed, and the guarantee that a
 * withdrawal inside the window puts everything back.
 *
 * - Recent authentication is required to REQUEST and to RESTORE. The restore
 *   direction matters as much as the request: an attacker on a stale session
 *   who could withdraw the victim's protective deletion has defeated the same
 *   protection from the other side.
 * - Requesting revokes every collaborator and addresses each of them a garden
 *   tombstone, while the OWNER's own pull still shows the garden as an
 *   ordinary upsert — the case an unaddressed tombstone would get wrong.
 * - Restoring reverses the lifecycle, the deadline, and every membership the
 *   request revoked, and the restored collaborator's pull shows the garden
 *   back.
 * - Once the sweep has claimed the garden, restore is refused — the claim
 *   revoked every membership, so the owner's own attempt is concealed as
 *   not-found — and the garden stays `purging`.
 */

import { randomUUID } from 'node:crypto';
import { DeletionErrorCode, GardenErrorCode } from '@verdery/api-contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { buildDeletionTestHarness, MovableClock } from '../support/deletion-test-harness.js';
import type { DeletionTestHarness } from '../support/deletion-test-harness.js';
import { seedGardenContent } from '../support/deletion-fixtures.js';
import { buildSyncTestHarness } from '../support/sync-test-harness.js';

const SUITE_NAME = 'garden deletion recovery integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const START = new Date('2026-07-25T09:00:00Z');
/** Older than the 30-minute step-up window — see `deletion-policy.ts`. */
const STALE_SIGN_IN = new Date('2026-07-25T06:00:00Z');

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let db: Kysely<DatabaseSchema>;
  let clock: MovableClock;
  let harness: DeletionTestHarness;

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

    db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
    });
    clock = new MovableClock(START);
    harness = buildDeletionTestHarness(db, clock);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('refuses a deletion request from a session whose sign-in is no longer recent', async () => {
    clock.set(START);
    const fixture = await seedGardenContent(db, clock, 'Stale Session Garden');

    await expect(
      harness.requestGardenDeletion.execute(
        fixture.gardenId,
        { profileId: fixture.ownerId, authenticatedAt: STALE_SIGN_IN },
        fixture.gardenRevision,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: DeletionErrorCode.RecentAuthenticationRequired });

    // Nothing moved.
    expect((await harness.gardens.findById(fixture.gardenId))?.lifecycleState).toBe('active');
    const memberships = await harness.memberships.listForGarden(fixture.gardenId);
    expect(memberships.every((membership) => membership.state === 'active')).toBe(true);
  });

  it('revokes collaborators on request, addresses each of them a tombstone the owner never sees, and puts everything back on restore', async () => {
    clock.set(START);
    const fixture = await seedGardenContent(db, clock, 'Recoverable Garden');
    const sync = buildSyncTestHarness(db, clock);

    await harness.requestGardenDeletion.execute(
      fixture.gardenId,
      { profileId: fixture.ownerId, authenticatedAt: clock.now() },
      fixture.gardenRevision,
      randomUUID(),
    );

    // The collaborator sees the garden as deleted; nothing else about it.
    const editorPull = await sync.getSyncChanges.execute(fixture.editorId, {
      after: null,
      limit: 100,
      protocolVersion: 1,
    });
    expect(editorPull.items.map((item) => [item.recordType, item.operation])).toEqual([
      ['garden', 'delete'],
    ]);

    // The owner — who can still change their mind — sees an ordinary update
    // and NOT the collaborator's tombstone. This is the assertion that would
    // fail if revocation tombstones were unaddressed.
    const ownerPull = await sync.getSyncChanges.execute(fixture.ownerId, {
      after: null,
      limit: 100,
      protocolVersion: 1,
    });
    expect(ownerPull.items.some((item) => item.operation === 'delete')).toBe(false);
    const ownerGardenChange = ownerPull.items.filter((item) => item.recordType === 'garden').at(-1);
    expect(ownerGardenChange?.record).toMatchObject({
      recordType: 'garden',
      data: { lifecycleState: 'deletionRequested' },
    });

    // --- Restore, 10 days in. ---
    clock.advanceDays(10);
    const current = await harness.gardens.findById(fixture.gardenId);
    const restored = await harness.restoreGardenDeletion.execute(
      fixture.gardenId,
      { profileId: fixture.ownerId, authenticatedAt: clock.now() },
      current?.revision ?? 0,
      randomUUID(),
    );

    expect(restored.lifecycleState).toBe('active');
    expect(restored.recoveryDeadlineAt).toBeUndefined();

    const afterRestore = await harness.gardens.findById(fixture.gardenId);
    expect(afterRestore).toMatchObject({
      lifecycleState: 'active',
      deletionRequestedAt: null,
      recoveryDeadlineAt: null,
    });

    const memberships = await harness.memberships.listForGarden(fixture.gardenId);
    expect(memberships.every((membership) => membership.state === 'active')).toBe(true);

    // The restored collaborator learns the garden is back.
    const editorAfterRestore = await sync.getSyncChanges.execute(fixture.editorId, {
      after: null,
      limit: 100,
      protocolVersion: 1,
    });
    expect(editorAfterRestore.items.at(-1)).toMatchObject({
      recordType: 'garden',
      operation: 'upsert',
    });

    // And the sweep, run past what WOULD have been the deadline, finds
    // nothing: a restored garden is genuinely out of the deletion pipeline.
    clock.advanceDays(40);
    expect(await harness.runDeletionSweep.execute()).toMatchObject({
      gardensClaimed: 0,
      purgesCompleted: 0,
    });
    expect((await harness.gardens.findById(fixture.gardenId))?.lifecycleState).toBe('active');
  });

  it('refuses a restore from a stale session, and refuses one entirely once the purge has been claimed', async () => {
    clock.set(START);
    const fixture = await seedGardenContent(db, clock, 'Too Late Garden');

    await harness.requestGardenDeletion.execute(
      fixture.gardenId,
      { profileId: fixture.ownerId, authenticatedAt: clock.now() },
      fixture.gardenRevision,
      randomUUID(),
    );
    const requested = await harness.gardens.findById(fixture.gardenId);

    await expect(
      harness.restoreGardenDeletion.execute(
        fixture.gardenId,
        { profileId: fixture.ownerId, authenticatedAt: STALE_SIGN_IN },
        requested?.revision ?? 0,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: DeletionErrorCode.RecentAuthenticationRequired });

    // The sweep claims it once the window closes; from there recovery is over.
    clock.advanceDays(31);
    // Media has to drain before the purge can finish, so this first pass
    // claims and defers — which is exactly the state a late restore races.
    await harness.runDeletionSweep.execute();

    const claimed = await harness.gardens.findById(fixture.gardenId);
    expect(claimed?.lifecycleState).toBe('purging');

    // The claim revoked every remaining membership in the same transaction,
    // so the owner's own restore attempt is concealed as not-found — the
    // posture every garden route takes toward a caller with no membership.
    // (`deletion.not_recoverable` remains the answer for the narrower race
    // where authorization passed before the claim committed; the domain
    // transition's own unit test covers that edge.)
    await expect(
      harness.restoreGardenDeletion.execute(
        fixture.gardenId,
        { profileId: fixture.ownerId, authenticatedAt: clock.now() },
        claimed?.revision ?? 0,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: GardenErrorCode.NotFound });

    expect((await harness.gardens.findById(fixture.gardenId))?.lifecycleState).toBe('purging');

    // The deletion record exists and is honest about being unfinished.
    const record = await sql<{ state: string; deferred_reason: string | null }>`
      SELECT state, deferred_reason FROM deletion.deletion_record
       WHERE subject_type = 'garden' AND subject_id = ${fixture.gardenId}
    `.execute(db);
    expect(record.rows[0]).toMatchObject({
      state: 'purging',
      deferred_reason: 'media_deletion_pending',
    });
  });
});
