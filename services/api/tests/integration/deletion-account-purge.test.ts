/**
 * End-to-end account deletion verification (P8-DELETE-01) — architecture/
 * data-export-and-deletion.md section 11, exercised against real PostgreSQL
 * with the real commands and the real sweep.
 *
 * What each test proves:
 *
 * 1. OWNERSHIP RESOLUTION. A sole-owned garden follows the account into
 *    deletion on the same deadline; a co-owned one survives with the
 *    co-owner and only the leaver's membership goes; an editor membership is
 *    revoked and the garden is untouched.
 * 2. RESTORE REVERSES ALL OF IT, memberships and gardens alike.
 * 3. THE PURGE LEAVES ZERO PROFILE-REFERENCING ROWS except the documented
 *    survivors — enumerated from the live catalog, not from a hand-written
 *    list — and the Firebase identity is deleted through the port, before
 *    the profile row is minimized to a tombstone that carries no personal
 *    data at all.
 * 4. THE ORDER IS SAFE UNDER FAILURE: a refusing identity provider leaves the
 *    account `disabled` and the purge retryable, never `purged` with a live
 *    credential outstanding.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { purgedFirebaseUid } from '../../src/modules/identity-access/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  buildDeletionTestHarness,
  countRows,
  MovableClock,
  profileReferencingColumns,
} from '../support/deletion-test-harness.js';
import type { DeletionTestHarness } from '../support/deletion-test-harness.js';
import { seedGardenContent, seedProfile } from '../support/deletion-fixtures.js';

const SUITE_NAME = 'account deletion purge integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const START = new Date('2026-07-25T09:00:00Z');

/**
 * The only places a purged profile id may still appear, each recorded where
 * the decision was made:
 *
 * - `identity_access.profile` — the tombstone itself. It cannot be deleted:
 *   roughly twenty NOT NULL foreign keys point at it from content inside
 *   SHARED gardens that outlive the account (see `markAccountPurged`).
 * - `platform.audit_event.actor_profile_id` — the deletion evidence
 *   (section 10.9). The id now resolves to a tombstone carrying no personal
 *   data, so it identifies nobody.
 * - `collaboration.membership.profile_id` — the revocation tombstones the
 *   offline protocol reads (deletion baseline migration's own header).
 */
const DOCUMENTED_SURVIVORS = new Set([
  'identity_access.profile.id',
  'platform.audit_event.actor_profile_id',
  'collaboration.membership.profile_id',
]);

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

  it('resolves sole-owned, co-owned, and member-only gardens differently, and a restore reverses every one of them', async () => {
    clock.set(START);
    const leaver = await seedProfile(db);

    const sole = await seedGardenContent(db, clock, 'Sole Owned', leaver);
    const shared = await seedGardenContent(db, clock, 'Co-owned', leaver);
    const coOwner = await seedProfile(db);
    await sql`
      INSERT INTO collaboration.membership (id, garden_id, profile_id, role, state)
      VALUES (${randomUUID()}, ${shared.gardenId}, ${coOwner}, 'owner', 'active')
    `.execute(db);

    // A garden the leaver had ALREADY asked to delete, on its own, before
    // deciding to close the account. Withdrawing the account deletion must
    // not silently undo that earlier, separate decision.
    const alreadyDeleting = await seedGardenContent(db, clock, 'Already Deleting', leaver);
    await harness.requestGardenDeletion.execute(
      alreadyDeleting.gardenId,
      { profileId: leaver, authenticatedAt: clock.now() },
      alreadyDeleting.gardenRevision,
      randomUUID(),
    );
    clock.advanceDays(1);

    // A garden the leaver only edits, owned by somebody else entirely.
    const foreign = await seedGardenContent(db, clock, 'Someone Else Garden');
    await sql`
      INSERT INTO collaboration.membership (id, garden_id, profile_id, role, state)
      VALUES (${randomUUID()}, ${foreign.gardenId}, ${leaver}, 'editor', 'active')
    `.execute(db);

    const requestedAt = clock.now();
    const deletion = await harness.requestAccountDeletion.execute(
      { profileId: leaver, authenticatedAt: requestedAt },
      randomUUID(),
    );

    expect(deletion.state).toBe('recoveryWindow');
    expect(deletion.recoveryDeadlineAt).toBe(
      new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect([...deletion.gardens].sort((a, b) => a.gardenId.localeCompare(b.gardenId))).toEqual(
      [
        { gardenId: sole.gardenId, resolution: 'gardenDeletionRequested' },
        { gardenId: alreadyDeleting.gardenId, resolution: 'gardenDeletionRequested' },
        { gardenId: shared.gardenId, resolution: 'ownershipRetainedByCoOwner' },
        { gardenId: foreign.gardenId, resolution: 'membershipRevoked' },
      ].sort((a, b) => a.gardenId.localeCompare(b.gardenId)),
    );

    // The account itself is unusable, which is what disables ordinary access.
    expect((await harness.profiles.findById(leaver))?.accountState).toBe('deletion_requested');
    // Only the sole-owned garden entered deletion; the others are untouched.
    expect((await harness.gardens.findById(sole.gardenId))?.lifecycleState).toBe(
      'deletion_requested',
    );
    expect((await harness.gardens.findById(shared.gardenId))?.lifecycleState).toBe('active');
    expect((await harness.gardens.findById(foreign.gardenId))?.lifecycleState).toBe('active');

    // The status read is reachable and agrees with the command's answer.
    expect(await harness.getAccountDeletion.execute(leaver)).toEqual(deletion);

    // --- Restore. ---
    clock.advanceDays(5);
    await harness.restoreAccountDeletion.execute(
      { profileId: leaver, authenticatedAt: clock.now() },
      randomUUID(),
    );

    expect(await harness.profiles.findById(leaver)).toMatchObject({
      accountState: 'active',
      deletionRequestedAt: null,
      recoveryDeadlineAt: null,
    });
    expect(await harness.gardens.findById(sole.gardenId)).toMatchObject({
      lifecycleState: 'active',
      recoveryDeadlineAt: null,
    });
    const restoredMemberships = await harness.memberships.listDetailsForProfile(leaver);
    expect(restoredMemberships.every((membership) => membership.state === 'active')).toBe(true);
    // The sole-owned garden's own collaborator came back too.
    const soleMemberships = await harness.memberships.listForGarden(sole.gardenId);
    expect(soleMemberships.every((membership) => membership.state === 'active')).toBe(true);

    // But the garden the user had separately asked to delete BEFORE closing
    // the account stays deleting: a restore reverses what its own request
    // did, never an earlier decision it had nothing to do with.
    const stillDeleting = await harness.gardens.findById(alreadyDeleting.gardenId);
    expect(stillDeleting?.lifecycleState).toBe('deletion_requested');

    // Withdrawn directly instead — which also leaves this shared container
    // with no pending deletion for the sweep-driven tests below to trip over.
    await harness.restoreGardenDeletion.execute(
      alreadyDeleting.gardenId,
      { profileId: leaver, authenticatedAt: clock.now() },
      stillDeleting?.revision ?? 0,
      randomUUID(),
    );
    expect((await harness.gardens.findById(alreadyDeleting.gardenId))?.lifecycleState).toBe(
      'active',
    );
  });

  it('purges the account to a tombstone: zero profile-referencing rows outside the documented survivors, the identity deleted through the provider, and evidence that names nothing', async () => {
    clock.set(START);
    const leaver = await seedProfile(db);
    const firebaseUid = (await harness.profiles.findById(leaver))?.firebaseUid as string;
    const garden = await seedGardenContent(db, clock, 'Only Garden', leaver);

    // Personal data the purge must clear, beyond the garden's own content.
    await sql`
      INSERT INTO identity_access.identity_provider_link (id, profile_id, provider, provider_uid)
      VALUES (${randomUUID()}, ${leaver}, 'google.com', ${randomUUID()})
    `.execute(db);
    await sql`
      INSERT INTO identity_access.consent_record (id, profile_id, consent_type, consent_version)
      VALUES (${randomUUID()}, ${leaver}, 'privacy_policy', '1')
    `.execute(db);
    await sql`
      INSERT INTO notifications.notification_device
        (id, profile_id, installation_id, platform, provider, fcm_token, environment,
         last_seen_at)
      VALUES (${randomUUID()}, ${leaver}, ${randomUUID()}, 'ios', 'fcm', 'token-abc',
              'development', ${clock.now()})
    `.execute(db);
    await sql`
      INSERT INTO notifications.notification_preference_document (profile_id)
      VALUES (${leaver})
    `.execute(db);
    await sql`
      INSERT INTO platform.sync_client_installation
        (id, profile_id, platform, app_version, protocol_version)
      VALUES (${randomUUID()}, ${leaver}, 'ios', '1.0.0', 1)
    `.execute(db);
    await sql`
      INSERT INTO platform.idempotency_record
        (actor_profile_id, operation, idempotency_key, request_fingerprint,
         response_status_code, response_body, expires_at)
      VALUES (${leaver}, 'gardens.create', ${randomUUID()}, 'fingerprint', 201,
              ${JSON.stringify({})}::jsonb, ${clock.now()})
    `.execute(db);

    await harness.requestAccountDeletion.execute(
      { profileId: leaver, authenticatedAt: clock.now() },
      randomUUID(),
    );

    // Run the sweep until nothing is left in flight: the garden and the
    // account are two independent purges, and the garden's own media has to
    // drain first, exactly as in production.
    clock.advanceDays(31);
    const firstPass = await harness.runDeletionSweep.execute();
    // Two independent purges from one tick. The ACCOUNT finishes
    // immediately — the only media an account owns outright are its own
    // export packages, and there are none — while the GARDEN defers on its
    // photo's byte deletion. Neither waits for the other, and neither has
    // to: a garden purge touches no profile row, and an account purge
    // touches no garden content.
    expect(firstPass).toMatchObject({
      gardensClaimed: 1,
      accountsClaimed: 1,
      purgesCompleted: 1,
      purgesDeferred: 1,
      purgesFailed: 0,
    });

    await sql`UPDATE media.media_record SET upload_state = 'deleted'`.execute(db);
    await sql`UPDATE platform.outbox_event SET published_at = now() WHERE published_at IS NULL`.execute(
      db,
    );

    const secondPass = await harness.runDeletionSweep.execute();
    expect(secondPass).toMatchObject({ purgesCompleted: 1, purgesFailed: 0 });

    // --- The identity provider really was called, with the real uid. ---
    expect(harness.identityProviderAccounts.deletedUids).toEqual([firebaseUid]);

    // --- The profile is a tombstone carrying nothing personal. ---
    const profile = await harness.profiles.findById(leaver);
    expect(profile).toMatchObject({
      accountState: 'purged',
      firebaseUid: purgedFirebaseUid(leaver),
      locale: 'en',
      timeZone: 'UTC',
      deletionRequestedAt: null,
      recoveryDeadlineAt: null,
    });
    expect(profile?.purgedAt).not.toBeNull();

    // --- Zero rows, from the catalog-derived reference list. ---
    const remaining: Record<string, number> = {};
    for (const reference of await profileReferencingColumns(db)) {
      const key = `${reference.table}.${reference.column}`;
      if (DOCUMENTED_SURVIVORS.has(key)) {
        continue;
      }
      const rows = await countRows(
        db,
        reference.table,
        sql`${sql.ref(reference.column)} = ${leaver}`,
      );
      if (rows > 0) {
        remaining[key] = rows;
      }
    }
    expect(remaining).toEqual({});

    // The membership survivor is a revocation tombstone, nothing more.
    const memberships = await harness.memberships.listDetailsForProfile(leaver);
    expect(memberships.every((membership) => membership.state === 'removed')).toBe(true);

    // --- Evidence. ---
    const record = await sql<{
      state: string;
      identity_provider_deleted_at: Date | null;
      completed_at: Date | null;
    }>`
      SELECT state, identity_provider_deleted_at, completed_at
        FROM deletion.deletion_record
       WHERE subject_type = 'account' AND subject_id = ${leaver}
    `.execute(db);
    expect(record.rows[0]?.state).toBe('purged');
    expect(record.rows[0]?.identity_provider_deleted_at).not.toBeNull();
    expect(record.rows[0]?.completed_at).not.toBeNull();

    const audit = await sql<{ event_type: string }>`
      SELECT event_type FROM platform.audit_event
       WHERE subject_id = ${leaver} AND subject_type = 'profile'
       ORDER BY occurred_at, id
    `.execute(db);
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'account.deletion_requested',
      'account.purge_started',
      'account.purged',
    ]);

    // Nothing that was deleted is quoted back in the evidence.
    const evidenceText = await sql<{ blob: string }>`
      SELECT coalesce(string_agg(t.body, ' '), '') AS blob FROM (
        SELECT r::text AS body FROM deletion.deletion_record r WHERE r.subject_id = ${leaver}
        UNION ALL
        SELECT a::text FROM platform.audit_event a WHERE a.subject_id = ${leaver}
      ) AS t
    `.execute(db);
    expect(evidenceText.rows[0]?.blob).not.toContain(firebaseUid);
    expect(evidenceText.rows[0]?.blob).not.toContain('Only Garden');
    expect(evidenceText.rows[0]?.blob).not.toContain('token-abc');

    // And the garden this account solely owned is genuinely gone.
    expect(await harness.gardens.findById(garden.gardenId)).toBeNull();
  }, 180_000);

  it('leaves the account disabled and the purge retryable when the identity provider refuses', async () => {
    clock.set(START);
    const leaver = await seedProfile(db);
    await harness.requestAccountDeletion.execute(
      { profileId: leaver, authenticatedAt: clock.now() },
      randomUUID(),
    );

    harness.identityProviderAccounts.failWith(new Error('provider unavailable'));
    clock.advanceDays(31);
    const failedPass = await harness.runDeletionSweep.execute();
    expect(failedPass).toMatchObject({ accountsClaimed: 1, purgesFailed: 1, purgesCompleted: 0 });

    // Never `purged` while a signable credential might still exist.
    expect((await harness.profiles.findById(leaver))?.accountState).toBe('disabled');
    const stuck = await sql<{ state: string; deferred_reason: string | null }>`
      SELECT state, deferred_reason FROM deletion.deletion_record
       WHERE subject_type = 'account' AND subject_id = ${leaver}
    `.execute(db);
    expect(stuck.rows[0]).toMatchObject({ state: 'purging', deferred_reason: 'purge_failed' });

    // The next tick resumes and finishes it — resumable, not restarted.
    harness.identityProviderAccounts.succeed();
    const recoveredPass = await harness.runDeletionSweep.execute();
    expect(recoveredPass).toMatchObject({ purgesCompleted: 1, purgesFailed: 0 });
    expect((await harness.profiles.findById(leaver))?.accountState).toBe('purged');
  });
});
