/**
 * Row builders shared by the two halves of the P9A-DATA-01 migration suite
 * (`tests/migrations/collaboration-operations-and-attribution.test.ts` and
 * `tests/migrations/collaboration-assignment-and-last-owner.test.ts`).
 *
 * Direct SQL against a raw `pg.Client` rather than Kysely, because these
 * suites test the SCHEMA: what they need is the ability to override any
 * single column with a value the constraints should reject, which a typed
 * query builder exists to prevent.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Column values for one row; anything not overridden takes the builder's default. */
export type Row = Record<string, unknown>;

/** Inserts one row into `table`, returning its `id`. */
export async function insertRow(client: pg.Client, table: string, row: Row): Promise<string> {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values,
  );
  return row['id'] as string;
}

/** A profile with an active, usable account. */
export async function insertProfile(client: pg.Client): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
     VALUES ($1, $2, 'active')`,
    [id, `firebase-${id}`],
  );
  return id;
}

export async function insertGarden(client: pg.Client, createdBy: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id)
     VALUES ($1, 'Collaboration Garden', $2)`,
    [id, createdBy],
  );
  return id;
}

export async function insertMembership(
  client: pg.Client,
  gardenId: string,
  profileId: string,
  role = 'editor',
  state = 'active',
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO collaboration.membership (id, garden_id, profile_id, role, state)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, gardenId, profileId, role, state],
  );
  return id;
}

/** Active owners of `gardenId`, as an application command must count them. */
export async function countActiveOwners(client: pg.Client, gardenId: string): Promise<number> {
  const { rows } = await client.query<{ owners: number }>(
    `SELECT count(*)::int AS owners FROM collaboration.membership
      WHERE garden_id = $1 AND role = 'owner' AND state = 'active'`,
    [gardenId],
  );
  return rows[0]?.owners ?? 0;
}
