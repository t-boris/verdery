/**
 * Shared fixture builders for the P9B-API-01 integration suites
 * (`collaboration-organizations.test.ts`, `collaboration-garden-assignments
 * .test.ts`, `collaboration-client-engagements.test.ts`,
 * `collaboration-organization-garden-denial-matrix.test.ts`) — real
 * PostgreSQL, real Kysely repositories, no fakes, the same posture
 * `collaboration-integration-harness.ts` already established for the P9A
 * suites. Re-exports that file's `fixedClock`/`insertProfile`/
 * `insertGarden`/`insertMembership`/`auditEventFor` rather than duplicating
 * them, and adds the organization/assignment/engagement-shaped builders
 * P9A's own harness has no reason to know about.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';

export {
  auditEventFor,
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
} from './collaboration-integration-harness.js';

export async function insertOrganization(
  db: Kysely<DatabaseSchema>,
  name = 'Green Thumb Gardening',
): Promise<string> {
  const id = randomUUID();
  await db.insertInto('collaboration.service_organization').values({ id, name }).execute();
  return id;
}

/**
 * Inserts an ACTIVE organization membership row plus its currently-open
 * `organization_membership_period` — a real command (`CreateServiceOrganization`,
 * `AddOrganizationMember`) always writes both together, the identical
 * "a fixture that skipped the period would quietly test against a state no
 * command ever produces" reasoning `insertMembership` documents for gardens.
 */
export async function insertOrganizationMembership(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  profileId: string,
  role: 'organization_admin' | 'professional' = 'professional',
  grantedAt: Date = new Date('2026-01-01T00:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.organization_membership')
    .values({
      id,
      organization_id: organizationId,
      profile_id: profileId,
      role,
      state: 'active',
      created_at: grantedAt,
      updated_at: grantedAt,
    })
    .execute();
  await db
    .insertInto('collaboration.organization_membership_period')
    .values({
      id: randomUUID(),
      membership_id: id,
      organization_id: organizationId,
      profile_id: profileId,
      role,
      valid_from: grantedAt,
      valid_until: null,
      ended_reason: null,
    })
    .execute();
  return id;
}

export async function activeAdminCount(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
): Promise<number> {
  const row = await db
    .selectFrom('collaboration.organization_membership')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('organization_id', '=', organizationId)
    .where('role', '=', 'organization_admin')
    .where('state', '=', 'active')
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/** Inserts an ACTIVE `collaboration.garden_assignment` row directly, bypassing `CreateGardenAssignment` — useful for seeding a pre-existing assignment a test then ends/revokes/lists. */
export async function insertGardenAssignment(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  profileId: string,
  gardenId: string,
  createdByProfileId: string,
  role: 'editor' | 'viewer' = 'editor',
  validFrom: Date = new Date('2026-02-01T00:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.garden_assignment')
    .values({
      id,
      organization_id: organizationId,
      profile_id: profileId,
      garden_id: gardenId,
      role,
      state: 'active',
      valid_from: validFrom,
      valid_until: null,
      created_by_profile_id: createdByProfileId,
      created_at: validFrom,
    })
    .execute();
  return id;
}

export async function activeAssignmentCount(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  profileId: string,
): Promise<number> {
  const row = await db
    .selectFrom('collaboration.garden_assignment')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('garden_id', '=', gardenId)
    .where('profile_id', '=', profileId)
    .where('state', '=', 'active')
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/** Inserts a `draft` `collaboration.client_engagement` row directly, bypassing `CreateClientEngagement`. */
export async function insertClientEngagement(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  createdByProfileId: string,
  serviceOrganizationId: string | null = null,
  createdAt: Date = new Date('2026-03-01T00:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.client_engagement')
    .values({
      id,
      garden_id: gardenId,
      service_organization_id: serviceOrganizationId,
      state: 'draft',
      stewardship_policy: 'residential',
      client_notifications_enabled: true,
      created_by_profile_id: createdByProfileId,
      activated_at: null,
      ended_at: null,
      revoked_at: null,
      revoked_reason: null,
      created_at: createdAt,
      updated_at: createdAt,
    })
    .execute();
  return id;
}
