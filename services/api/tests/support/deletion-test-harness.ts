/**
 * Shared harness for the P8-DELETE-01 integration suites: the real garden
 * deletion/restore commands, the real account deletion command surface, and
 * the real sweep — every one of them wired exactly as `compose-deletion.ts`
 * and `compose-gardens-mapping.ts` wire them, against a real migrated
 * PostgreSQL/PostGIS database.
 *
 * The only substituted collaborators are the two that would otherwise reach
 * outside the process: Cloud Storage (`FakeMediaStorageGateway`) and Firebase
 * Authentication (`FakeIdentityProviderAccountGateway`). Every deletion rule
 * under test — authorization, the step-up gate, revision guards, the
 * revocation cascade, the purge cascade with its real foreign keys, the
 * checkpoints — runs against the real thing.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { sql } from 'kysely';
import type { Kysely, RawBuilder } from 'kysely';
import {
  GetAccountDeletion,
  KyselyDeletionUnitOfWork,
  RequestAccountDeletion,
  RestoreAccountDeletion,
  RunDeletionSweep,
  RunPurge,
} from '../../src/modules/deletion/public.js';
import {
  GardenAuthorization,
  KyselyGardenRepository,
  KyselyGardensMappingUnitOfWork,
  KyselyMembershipRepository,
  RequestGardenDeletion,
  RestoreGardenDeletion,
} from '../../src/modules/gardens-mapping/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import { TEST_BUCKETS } from '../../src/modules/media/application/media-test-doubles.js';
import {
  KyselyMediaUnitOfWork,
  SchedulePurgeMediaDeletion,
} from '../../src/modules/media/public.js';
import { FakeIdentityProviderAccountGateway } from '../../src/platform/authentication/identity-provider-account-test-double.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from '../../src/shared/time/clock.js';

/** A clock a test moves forward by hand — the recovery window is 30 days, which no suite is going to wait for. */
export class MovableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(at: Date): void {
    this.current = at;
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}

export function buildDeletionTestHarness(db: Kysely<DatabaseSchema>, clock: Clock) {
  const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
  const gardenIdempotency = new KyselyIdempotencyStore(db, clock);
  const gardensMappingUnitOfWork = new KyselyGardensMappingUnitOfWork(db, clock);
  const deletionUnitOfWork = new KyselyDeletionUnitOfWork(db, clock);
  const deletionIdempotency = new KyselyIdempotencyStore(db, clock);
  const identityProviderAccounts = new FakeIdentityProviderAccountGateway();

  const purgeMedia = new SchedulePurgeMediaDeletion(
    new KyselyMediaUnitOfWork(db, clock),
    TEST_BUCKETS,
    clock,
  );

  return {
    identityProviderAccounts,
    profiles: new KyselyProfileRepository(db),
    gardens: new KyselyGardenRepository(db),
    memberships: new KyselyMembershipRepository(db),
    requestGardenDeletion: new RequestGardenDeletion(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      authorization,
      clock,
    ),
    restoreGardenDeletion: new RestoreGardenDeletion(
      gardenIdempotency,
      gardensMappingUnitOfWork,
      authorization,
      clock,
    ),
    requestAccountDeletion: new RequestAccountDeletion(
      deletionIdempotency,
      deletionUnitOfWork,
      clock,
    ),
    restoreAccountDeletion: new RestoreAccountDeletion(
      deletionIdempotency,
      deletionUnitOfWork,
      clock,
    ),
    getAccountDeletion: new GetAccountDeletion(
      new KyselyProfileRepository(db),
      new KyselyMembershipRepository(db),
      new KyselyGardenRepository(db),
    ),
    runDeletionSweep: new RunDeletionSweep(
      deletionUnitOfWork,
      new RunPurge(deletionUnitOfWork, purgeMedia, identityProviderAccounts, clock),
      clock,
    ),
  };
}

export type DeletionTestHarness = ReturnType<typeof buildDeletionTestHarness>;

/**
 * Every table that could possibly hold a row belonging to a garden, derived
 * from the live catalog rather than from a hand-written list — the point of
 * the systematic-emptiness proof.
 *
 * Two sources, because one is not enough:
 *
 * - The transitive closure of foreign keys pointing at
 *   `gardens_mapping.garden` (a plant references a garden; a plant photo
 *   references a plant; and so on to any depth).
 * - Any table carrying a column literally named `garden_id` or
 *   `scope_garden_id`. `notifications.notification_intent.garden_id`
 *   deliberately has no foreign key, so foreign keys alone would miss it —
 *   and a future table making the same choice would be missed too.
 */
export async function gardenReferencingTables(db: Kysely<DatabaseSchema>): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    WITH RECURSIVE reachable(rel) AS (
      SELECT 'gardens_mapping.garden'::regclass::oid
      UNION
      SELECT c.conrelid
        FROM pg_constraint c
        JOIN reachable r ON c.confrelid = r.rel
       WHERE c.contype = 'f'
    ),
    by_foreign_key AS (
      SELECT n.nspname || '.' || cl.relname AS table_name
        FROM reachable
        JOIN pg_class cl ON cl.oid = reachable.rel
        JOIN pg_namespace n ON n.oid = cl.relnamespace
    ),
    by_column_name AS (
      SELECT table_schema || '.' || table_name AS table_name
        FROM information_schema.columns
       WHERE column_name IN ('garden_id', 'scope_garden_id')
         AND table_schema NOT IN ('pg_catalog', 'information_schema')
    )
    SELECT DISTINCT table_name
      FROM (
        SELECT table_name FROM by_foreign_key
        UNION
        SELECT table_name FROM by_column_name
      ) AS all_tables
     ORDER BY table_name
  `.execute(db);

  return rows.map((row) => row.table_name);
}

/**
 * Every (table, column) that points at `identity_access.profile` — the
 * account purge's own emptiness proof, derived from the catalog for exactly
 * the same reason.
 */
export async function profileReferencingColumns(
  db: Kysely<DatabaseSchema>,
): Promise<{ table: string; column: string }[]> {
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    SELECT DISTINCT
           child_ns.nspname || '.' || child.relname AS table_name,
           att.attname AS column_name
      FROM pg_constraint c
      JOIN pg_class child ON child.oid = c.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid = 'identity_access.profile'::regclass
     ORDER BY table_name, column_name
  `.execute(db);

  return rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

/** Rows left in `table` matching `predicate` — the assertion every emptiness check makes. */
export async function countRows(
  db: Kysely<DatabaseSchema>,
  table: string,
  predicate: RawBuilder<unknown>,
): Promise<number> {
  const { rows } = await sql<{ remaining: string }>`
    SELECT count(*)::text AS remaining FROM ${sql.table(table)} WHERE ${predicate}
  `.execute(db);

  return Number(rows[0]?.remaining ?? '0');
}
