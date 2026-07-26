/**
 * End-to-end garden deletion verification (P8-DELETE-01) — the work
 * package's required acceptance evidence, exercised against real PostgreSQL
 * with the real commands, the real foreign keys, and the real sweep.
 *
 * What each test here actually proves:
 *
 * 1. THE PURGE PLAN IS COMPLETE, not merely plausible. The plan's table set
 *    is checked against the LIVE CATALOG: every table that references
 *    `gardens_mapping.garden` transitively, plus every table carrying a
 *    garden-id column without a foreign key, must be covered by the plan or
 *    by a documented exception. A migration that adds a garden-scoped table
 *    and forgets the plan fails here, which a hand-written list of tables
 *    could never do.
 * 2. A PURGED GARDEN LEAVES ZERO ROWS. A garden populated across every
 *    module — map, plants, observations, tasks, recommendations, weather,
 *    notifications, media, exports, calibration, invitations — is purged, and
 *    every table from (1) is asserted empty for that garden id.
 * 3. MEDIA BYTES ARE DELETED THROUGH THE ESTABLISHED WORKFLOW, and the purge
 *    WAITS for confirmation: the first sweep pass defers while media is still
 *    `deletion_scheduled`, and only the pass after the worker's confirmation
 *    completes.
 * 4. AN OFFLINE CLIENT CONVERGES. A member who still holds the garden pulls
 *    after the purge and receives the garden's own `delete` tombstone — from
 *    a `platform.sync_change` row whose garden no longer exists.
 * 5. THE EVIDENCE SURVIVES AND CARRIES NO DELETED CONTENT.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GARDEN_PURGE_STEPS } from '../../src/modules/deletion/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  buildDeletionTestHarness,
  countRows,
  gardenReferencingTables,
  MovableClock,
} from '../support/deletion-test-harness.js';
import type { DeletionTestHarness } from '../support/deletion-test-harness.js';
import { seedGardenContent } from '../support/deletion-fixtures.js';
import { buildSyncTestHarness } from '../support/sync-test-harness.js';

const SUITE_NAME = 'garden deletion purge integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const START = new Date('2026-07-25T09:00:00Z');

/**
 * Tables the plan deliberately does not name, each for a reason recorded
 * where the decision was made. Anything else the catalog turns up must be a
 * plan step.
 */
const DOCUMENTED_PLAN_EXCEPTIONS = new Set([
  // The garden's own revocation tombstones — they must outlive the garden so
  // `GetSyncChanges` can still deliver its `delete` change to a client that
  // has not reconnected (deletion baseline migration's own header).
  'collaboration.membership',
  // The garden's `delete` tombstone itself. `platform.sync_change` carries a
  // `garden_id` with no foreign key precisely so a tombstone survives the
  // record it describes; purging it would delete the very row an offline
  // client reconnects to find.
  'platform.sync_change',
  // The completion evidence (data-export-and-deletion.md section 10.9), which
  // this suite asserts survives further down. P9A-DATA-01 gave it a
  // `garden_id` so a garden-scoped audit query stops having to search
  // `details` jsonb, which is what brings it into the catalog sweep — the
  // column carries no foreign key, for the same reason `subject_id` next to
  // it never had one.
  'platform.audit_event',
  // P9B-DATA-01's assignment and engagement records — the same tombstone
  // reasoning as `collaboration.membership` above, deliberately applied to
  // two brand-new tables rather than only inherited by an old one:
  // `collaboration.garden_assignment` and `collaboration.client_engagement`
  // carry a `garden_id` with NO foreign key (see that migration's own "NO
  // FOREIGN KEY ON `garden_id`" comment) specifically so an assignment or
  // engagement record survives a garden purge for audit, dispute, legal, and
  // stewardship-retention purposes (collaboration-and-client-sharing.md
  // section 18). Neither is in scope for P9B-DATA-01's purge plan — that is
  // a future package's decision, made explicitly if provider records are
  // ever required to be purged with the garden rather than retained past it.
  'collaboration.garden_assignment',
  'collaboration.client_engagement',
  // Deleted by `ON DELETE CASCADE` from a table the plan DOES name.
  'gardens_mapping.structure_details',
  'gardens_mapping.fence_details',
  'gardens_mapping.gate_details',
  'gardens_mapping.zone_details',
  'gardens_mapping.bed_details',
  'gardens_mapping.tree_details',
  'gardens_mapping.plant_placement_details',
  'gardens_mapping.utility_exclusion_details',
  'gardens_mapping.annotation_details',
  'gardens_mapping.imported_background_details',
  'notifications.notification_delivery_attempt',
  'exports.export_section_checkpoint',
]);

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
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

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
    clock = new MovableClock(START);
    harness = buildDeletionTestHarness(db, clock);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('covers every garden-referencing table the live catalog knows about', async () => {
    const planned = new Set(GARDEN_PURGE_STEPS.map((step) => step.table));
    const uncovered = (await gardenReferencingTables(db)).filter(
      (table) => !planned.has(table) && !DOCUMENTED_PLAN_EXCEPTIONS.has(table),
    );

    expect(uncovered).toEqual([]);
  });

  it('purges a fully populated garden to zero rows, waiting for media bytes and leaving only the documented evidence', async () => {
    clock.set(START);
    const fixture = await seedGardenContent(db, clock, 'Purge Garden');

    // Every populated table really has rows before the purge — otherwise the
    // emptiness assertion below would be vacuous.
    const populated = await Promise.all(
      GARDEN_PURGE_STEPS.filter((step) => step.table !== 'platform.outbox_event').map(
        async (step) => ({
          table: step.table,
          rows: await countRows(db, step.table, step.rows(fixture.gardenId)),
        }),
      ),
    );
    expect(populated.filter((entry) => entry.rows > 0).length).toBeGreaterThanOrEqual(15);

    // --- Request: the recovery window opens, collaborators are revoked. ---
    const requested = await harness.requestGardenDeletion.execute(
      fixture.gardenId,
      { profileId: fixture.ownerId, authenticatedAt: clock.now() },
      fixture.gardenRevision,
      randomUUID(),
    );
    expect(requested.lifecycleState).toBe('deletionRequested');
    expect(requested.recoveryDeadlineAt).toBe(
      new Date(START.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    );

    const memberships = await harness.memberships.listForGarden(fixture.gardenId);
    expect(
      memberships.map((membership) => [membership.profileId, membership.state]).sort(),
    ).toEqual(
      [
        [fixture.ownerId, 'active'],
        [fixture.editorId, 'removed'],
      ].sort(),
    );

    // --- Before the deadline the sweep does nothing. ---
    clock.advanceDays(29);
    expect(await harness.runDeletionSweep.execute()).toMatchObject({
      gardensClaimed: 0,
      purgesCompleted: 0,
    });
    expect((await harness.gardens.findById(fixture.gardenId))?.lifecycleState).toBe(
      'deletion_requested',
    );

    // --- After the deadline: claimed, media scheduled, purge DEFERRED. ---
    clock.advanceDays(2);
    const firstPass = await harness.runDeletionSweep.execute();
    expect(firstPass).toMatchObject({
      gardensClaimed: 1,
      purgesCompleted: 0,
      purgesDeferred: 1,
      purgesFailed: 0,
    });
    expect((await harness.gardens.findById(fixture.gardenId))?.lifecycleState).toBe('purging');

    const mediaState = await sql<{ upload_state: string }>`
      SELECT upload_state FROM media.media_record WHERE id = ${fixture.mediaId}
    `.execute(db);
    expect(mediaState.rows[0]?.upload_state).toBe('deletion_scheduled');
    // The byte-deletion workflow really was invoked: its outbox event exists.
    const deletionEvents = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM platform.outbox_event
       WHERE event_type = 'media.deletion_requested' AND aggregate_id = ${fixture.mediaId}
    `.execute(db);
    expect(Number(deletionEvents.rows[0]?.count)).toBe(1);

    // --- The worker confirms the bytes are gone; the next pass completes. ---
    await sql`
      UPDATE media.media_record SET upload_state = 'deleted', revision = revision + 1
       WHERE garden_id = ${fixture.gardenId}
    `.execute(db);
    await sql`
      UPDATE platform.outbox_event SET published_at = now() WHERE published_at IS NULL
    `.execute(db);

    const secondPass = await harness.runDeletionSweep.execute();
    expect(secondPass).toMatchObject({
      gardensClaimed: 0,
      purgesCompleted: 1,
      purgesDeferred: 0,
      purgesFailed: 0,
    });

    // --- Zero rows, table by table, from the catalog-derived list. ---
    const remaining: Record<string, number> = {};
    for (const step of GARDEN_PURGE_STEPS) {
      const rows = await countRows(db, step.table, step.rows(fixture.gardenId));
      if (rows > 0) {
        remaining[step.table] = rows;
      }
    }
    expect(remaining).toEqual({});

    // Cascade-covered children are gone too, checked directly rather than
    // trusted: a detail row and a delivery attempt for this garden.
    const orphans = await sql<{ details: string; attempts: string }>`
      SELECT
        (SELECT count(*)::text FROM gardens_mapping.structure_details d
           WHERE d.garden_object_id = ${fixture.mapObjectId}) AS details,
        (SELECT count(*)::text FROM notifications.notification_delivery_attempt a
           WHERE a.intent_id = ${fixture.notificationIntentId}) AS attempts
    `.execute(db);
    expect(orphans.rows[0]).toEqual({ details: '0', attempts: '0' });

    // --- Evidence: the deletion record and its per-step checkpoints. ---
    const evidence = await sql<{
      state: string;
      attempt_count: number;
      media_records_scheduled: number;
      deferred_reason: string | null;
      completed_at: Date | null;
    }>`
      SELECT state, attempt_count, media_records_scheduled, deferred_reason, completed_at
        FROM deletion.deletion_record
       WHERE subject_type = 'garden' AND subject_id = ${fixture.gardenId}
    `.execute(db);
    expect(evidence.rows[0]).toMatchObject({
      state: 'purged',
      // Two sweep passes actually tried: the one that deferred on media and
      // the one that finished. The claim itself is not a pass.
      attempt_count: 2,
      media_records_scheduled: 1,
      deferred_reason: null,
    });
    expect(evidence.rows[0]?.completed_at).not.toBeNull();

    const checkpoints = await sql<{ step_name: string }>`
      SELECT c.step_name FROM deletion.purge_checkpoint c
        JOIN deletion.deletion_record r ON r.id = c.deletion_id
       WHERE r.subject_id = ${fixture.gardenId}
    `.execute(db);
    expect(checkpoints.rows.map((row) => row.step_name)).toEqual(
      expect.arrayContaining(['gardens_mapping.garden', 'plants_inventory.plant']),
    );

    // The evidence names no deleted content: no garden name anywhere in it.
    const evidenceText = await sql<{ blob: string }>`
      SELECT coalesce(string_agg(t.body, ' '), '') AS blob FROM (
        SELECT r::text AS body FROM deletion.deletion_record r WHERE r.subject_id = ${fixture.gardenId}
        UNION ALL
        SELECT a::text FROM platform.audit_event a
         WHERE a.subject_id = ${fixture.gardenId} AND a.subject_type = 'garden'
      ) AS t
    `.execute(db);
    expect(evidenceText.rows[0]?.blob).not.toContain('Purge Garden');
    expect(evidenceText.rows[0]?.blob.length).toBeGreaterThan(0);

    // The completion audit event survives its subject.
    const audit = await sql<{ event_type: string }>`
      SELECT event_type FROM platform.audit_event
       WHERE subject_id = ${fixture.gardenId} AND subject_type = 'garden'
       ORDER BY occurred_at, id
    `.execute(db);
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'garden.deletion_requested',
      'garden.purge_started',
      'garden.purged',
    ]);

    // --- An offline client that still holds the garden converges. ---
    const pulled = await buildSyncTestHarness(db, clock).getSyncChanges.execute(fixture.ownerId, {
      after: null,
      limit: 100,
      protocolVersion: 1,
    });
    const gardenChanges = pulled.items.filter(
      (item) => item.gardenId === fixture.gardenId && item.recordType === 'garden',
    );
    expect(gardenChanges.at(-1)?.operation).toBe('delete');
    // And nothing about a garden they can no longer see leaks past the
    // tombstone: only garden-typed deletes remain visible.
    expect(
      pulled.items
        .filter((item) => item.gardenId === fixture.gardenId)
        .every((item) => item.recordType === 'garden' && item.operation === 'delete'),
    ).toBe(true);
  }, 180_000);
});
