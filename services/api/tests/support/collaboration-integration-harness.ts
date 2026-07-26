/**
 * Shared fixture builders for the P9A-API-01 integration suites
 * (`collaboration-invitations.test.ts`, `collaboration-accept-invitation
 * .test.ts`, `collaboration-membership.test.ts`) — real PostgreSQL, real
 * Kysely repositories, no fakes, the same posture `gardens-mapping.test.ts`
 * already established for this module.
 *
 * Pure functions only, no shared container: "every suite keeps its own
 * container" (`postgres-container.ts`'s own header), so each test file runs
 * its own `beforeAll`/`afterAll` and passes its own `db` handle in here.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

export async function insertProfile(
  db: Kysely<DatabaseSchema>,
  id: string = randomUUID(),
): Promise<string> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
  return id;
}

export async function insertGarden(db: Kysely<DatabaseSchema>, createdBy: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('gardens_mapping.garden')
    .values({
      id,
      name: 'Collaboration Garden',
      lifecycle_state: 'active',
      created_by_profile_id: createdBy,
    })
    .execute();
  return id;
}

/**
 * Inserts an ACTIVE membership row plus its currently-open
 * `membership_period` — a real command (`AcceptInvitation`, `CreateGarden`)
 * always writes both together, so a fixture that skipped the period would
 * quietly test against a state no command ever produces.
 */
export async function insertMembership(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  profileId: string,
  role: 'owner' | 'editor' | 'viewer' = 'editor',
  grantedAt: Date = new Date('2026-01-01T00:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.membership')
    .values({
      id,
      garden_id: gardenId,
      profile_id: profileId,
      role,
      state: 'active',
      created_at: grantedAt,
      updated_at: grantedAt,
    })
    .execute();
  await db
    .insertInto('collaboration.membership_period')
    .values({
      id: randomUUID(),
      membership_id: id,
      garden_id: gardenId,
      profile_id: profileId,
      role,
      valid_from: grantedAt,
      valid_until: null,
      ended_reason: null,
    })
    .execute();
  return id;
}

export async function activeOwnerCount(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
): Promise<number> {
  const row = await db
    .selectFrom('collaboration.membership')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('garden_id', '=', gardenId)
    .where('role', '=', 'owner')
    .where('state', '=', 'active')
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function auditEventFor(
  db: Kysely<DatabaseSchema>,
  subjectId: string,
  eventType: string,
) {
  return db
    .selectFrom('platform.audit_event')
    .selectAll()
    .where('subject_id', '=', subjectId)
    .where('event_type', '=', eventType)
    .executeTakeFirst();
}
