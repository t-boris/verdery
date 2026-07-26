/**
 * The assignment, attribution, audit-scope, and last-owner half of the
 * P9A-DATA-01 migration tests
 * (1786500000000_collaboration-operations-and-attribution.sql). Its sibling,
 * `collaboration-operations-and-attribution.test.ts`, covers the uniqueness,
 * temporal-state, invitation, privilege, and rollback halves.
 *
 * ASSIGNMENT AND ATTRIBUTION: a task can name the member responsible for it
 * and the person who actually completed it, the two halves of an assignment
 * are present or absent together, attribution without a completion is
 * impossible — and, the point of the whole thing, the attribution survives
 * the assignee losing access to the garden, because it references the
 * PROFILE and never the membership.
 *
 * LAST OWNER: both halves of the honest answer. The schema alone does NOT
 * stop a garden's last owner from being demoted — no declarative constraint
 * can count sibling rows — and this suite proves that rather than implying
 * otherwise. It then proves that the locking recipe the migration prescribes
 * for the application layer really does reject the concurrent demotion the
 * unguarded path lets through, against two genuine connections.
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  countActiveOwners,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/collaboration-fixtures.js';
import type { Row } from '../support/collaboration-fixtures.js';

const SUITE_NAME = 'collaboration assignment, attribution, and last-owner migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/**
 * The owner set an ownership transition must never be allowed to empty —
 * the exact statement the migration prescribes to the application layer.
 * `FOR UPDATE` serializes concurrent transitions; `ORDER BY id` makes every
 * transaction take the same locks in the same order, so they queue rather
 * than deadlock.
 */
const ACTIVE_OWNERS_LOCKED = `SELECT id FROM collaboration.membership
   WHERE garden_id = $1 AND role = 'owner' AND state = 'active'
   ORDER BY id
     FOR UPDATE`;

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    profileId = await insertProfile(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('assigns a task to a member and attributes its completion to whoever actually did it', async () => {
    const gardenId = await insertGarden(client, profileId);
    const assignee = await insertProfile(client);
    const membershipId = await insertMembership(client, gardenId, assignee);
    const taskId = randomUUID();

    await client.query(
      `INSERT INTO tasks_recommendations.task
         (id, garden_id, target_kind, title, created_by_profile_id,
          assigned_profile_id, assigned_at)
       VALUES ($1, $2, 'garden', 'Prune the hedge', $3, $4, $5)`,
      [taskId, gardenId, profileId, assignee, JANUARY],
    );

    // An assignee without an instant, or an instant without an assignee, is a
    // half-written assignment.
    await expect(
      client.query(`UPDATE tasks_recommendations.task SET assigned_at = NULL WHERE id = $1`, [
        taskId,
      ]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'task_assignment_linkage_check' });

    // Attribution without a completion is not attribution.
    await expect(
      client.query(
        `UPDATE tasks_recommendations.task SET completed_by_profile_id = $2 WHERE id = $1`,
        [taskId, assignee],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'task_completion_attribution_check' });

    await client.query(
      `UPDATE tasks_recommendations.task
          SET status = 'completed', completed_at = $2, completed_by_profile_id = $3
        WHERE id = $1`,
      [taskId, MARCH, assignee],
    );

    // THE POINT: revoking access leaves the attribution intact, because it
    // references the profile and not the membership.
    await client.query(`UPDATE collaboration.membership SET state = 'removed' WHERE id = $1`, [
      membershipId,
    ]);
    const { rows } = await client.query<Row>(
      `SELECT t.completed_by_profile_id, m.state
         FROM tasks_recommendations.task t
         JOIN collaboration.membership m ON m.id = $2
        WHERE t.id = $1`,
      [taskId, membershipId],
    );
    expect(rows[0]).toEqual({ completed_by_profile_id: assignee, state: 'removed' });

    // The journal records the assignee the command settled on, so assignment
    // history needs no table of its own.
    await client.query(
      `INSERT INTO tasks_recommendations.task_revision
         (task_id, revision, command_type, status, actor_profile_id, assigned_profile_id)
       VALUES ($1, 2, 'AssignTask', 'planned', $2, $3)`,
      [taskId, profileId, assignee],
    );
    // One row per revision is what makes concurrent assignment safe.
    await expect(
      client.query(
        `INSERT INTO tasks_recommendations.task_revision
           (task_id, revision, command_type, actor_profile_id, assigned_profile_id)
         VALUES ($1, 2, 'AssignTask', $2, $3)`,
        [taskId, profileId, assignee],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'task_revision_task_id_revision_key' });
  });

  it('scopes an audit event to a garden without tying its survival to one', async () => {
    const gardenId = await insertGarden(client, profileId);
    const auditId = randomUUID();

    await client.query(
      `INSERT INTO platform.audit_event
         (id, event_type, subject_type, subject_id, actor_profile_id, garden_id)
       VALUES ($1, 'membership.role_changed', 'membership', $2, $3, $4)`,
      [auditId, randomUUID(), profileId, gardenId],
    );
    // Account-level events genuinely have no garden.
    await client.query(
      `INSERT INTO platform.audit_event (id, event_type, subject_type, subject_id, actor_profile_id)
       VALUES ($1, 'account.suspended', 'profile', $2, $2)`,
      [randomUUID(), profileId],
    );

    // No foreign key: the record outlives the garden it names.
    await client.query('DELETE FROM gardens_mapping.garden WHERE id = $1', [gardenId]);
    const { rows } = await client.query<Row>(
      'SELECT garden_id FROM platform.audit_event WHERE id = $1',
      [auditId],
    );
    expect(rows[0]).toEqual({ garden_id: gardenId });
  });

  it('does NOT stop the last owner being demoted on its own: no declarative constraint can count sibling rows', async () => {
    const gardenId = await insertGarden(client, profileId);
    const sole = await insertProfile(client);
    const membershipId = await insertMembership(client, gardenId, sole, 'owner');

    // The database accepts this. It is recorded here so nobody reads the
    // migration's constraint list and assumes the invariant is covered.
    await client.query(`UPDATE collaboration.membership SET role = 'viewer' WHERE id = $1`, [
      membershipId,
    ]);

    expect(await countActiveOwners(client, gardenId)).toBe(0);
  });

  it('rejects the concurrent demotion of two co-owners when the prescribed lock is taken, and lets it through when it is not', async () => {
    const first = new pg.Client({ connectionString: databaseUrl });
    const second = new pg.Client({ connectionString: databaseUrl });
    await first.connect();
    await second.connect();

    try {
      // --- Unguarded: each transaction reads a snapshot in which the other
      // owner is still an owner, so both commit and the garden is orphaned.
      const naiveGarden = await insertGarden(client, profileId);
      const naiveA = await insertMembership(
        client,
        naiveGarden,
        await insertProfile(client),
        'owner',
      );
      const naiveB = await insertMembership(
        client,
        naiveGarden,
        await insertProfile(client),
        'owner',
      );
      const unlocked = `SELECT id FROM collaboration.membership
          WHERE garden_id = $1 AND role = 'owner' AND state = 'active'`;

      await first.query('BEGIN');
      await second.query('BEGIN');
      expect((await first.query(unlocked, [naiveGarden])).rowCount).toBe(2);
      expect((await second.query(unlocked, [naiveGarden])).rowCount).toBe(2);
      await first.query(`UPDATE collaboration.membership SET role = 'editor' WHERE id = $1`, [
        naiveA,
      ]);
      await second.query(`UPDATE collaboration.membership SET role = 'editor' WHERE id = $1`, [
        naiveB,
      ]);
      await first.query('COMMIT');
      await second.query('COMMIT');

      expect(await countActiveOwners(client, naiveGarden)).toBe(0);

      // --- Guarded by the recipe the migration prescribes. ---
      const gardenId = await insertGarden(client, profileId);
      const ownerA = await insertMembership(client, gardenId, await insertProfile(client), 'owner');
      const ownerB = await insertMembership(client, gardenId, await insertProfile(client), 'owner');

      await first.query('BEGIN');
      expect((await first.query(ACTIVE_OWNERS_LOCKED, [gardenId])).rowCount).toBe(2);
      await first.query(`UPDATE collaboration.membership SET role = 'editor' WHERE id = $1`, [
        ownerA,
      ]);

      // The second transaction blocks on the rows the first holds instead of
      // reading a stale owner set.
      await second.query('BEGIN');
      const blocked = second.query<{ id: string }>(ACTIVE_OWNERS_LOCKED, [gardenId]);
      let settledEarly = false;
      const settled = blocked.then(
        () => {
          settledEarly = true;
        },
        () => {
          settledEarly = true;
        },
      );
      await sleep(250);
      expect(settledEarly).toBe(false);

      await first.query('COMMIT');

      // Re-evaluated after the first commit: the demoted row no longer
      // matches, so the second transaction sees the single remaining owner
      // and must reject rather than demote it.
      const lockedBySecond = await blocked;
      await settled;
      expect(lockedBySecond.rows.map((row) => row.id)).toEqual([ownerB]);
      await second.query('ROLLBACK');

      expect(await countActiveOwners(client, gardenId)).toBe(1);
    } finally {
      await first.end();
      await second.end();
    }
  }, 60_000);
});
