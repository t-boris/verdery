/**
 * Row builders for the P9B-DATA-01 migration suite
 * (`tests/migrations/service-organizations-and-client-engagements.test.ts`
 * and its siblings — tenant isolation, garden-assignment lifecycle, and
 * client-engagement state). Reuses `insertRow`/`insertProfile`/`insertGarden`
 * from `collaboration-fixtures.ts` (the P9A-DATA-01 suite's own builders)
 * rather than duplicating them, and follows that file's identical reasoning
 * for going straight against `pg.Client`: these suites test the SCHEMA, and
 * overriding any single column with a value a constraint should reject is
 * exactly what a typed query builder exists to prevent.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { insertRow } from './collaboration-fixtures.js';
import type { Row } from './collaboration-fixtures.js';

export async function insertServiceOrganization(
  client: pg.Client,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.service_organization', {
    id: randomUUID(),
    name: 'Green Thumb Gardening',
    ...overrides,
  });
}

export async function insertOrganizationMembership(
  client: pg.Client,
  organizationId: string,
  profileId: string,
  role = 'professional',
  state = 'active',
): Promise<string> {
  return insertRow(client, 'collaboration.organization_membership', {
    id: randomUUID(),
    organization_id: organizationId,
    profile_id: profileId,
    role,
    state,
  });
}

export async function insertOrganizationMembershipPeriod(
  client: pg.Client,
  membershipId: string,
  organizationId: string,
  profileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.organization_membership_period', {
    id: randomUUID(),
    membership_id: membershipId,
    organization_id: organizationId,
    profile_id: profileId,
    role: 'professional',
    valid_from: new Date('2026-01-10T09:00:00Z'),
    ...overrides,
  });
}

/** Active organization admins, mirroring `collaboration-fixtures.ts`'s `countActiveOwners`. */
export async function countActiveOrganizationAdmins(
  client: pg.Client,
  organizationId: string,
): Promise<number> {
  const { rows } = await client.query<{ admins: number }>(
    `SELECT count(*)::int AS admins FROM collaboration.organization_membership
      WHERE organization_id = $1 AND role = 'organization_admin' AND state = 'active'`,
    [organizationId],
  );
  return rows[0]?.admins ?? 0;
}

export async function insertGardenAssignment(
  client: pg.Client,
  organizationId: string,
  profileId: string,
  gardenId: string,
  createdByProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.garden_assignment', {
    id: randomUUID(),
    organization_id: organizationId,
    profile_id: profileId,
    garden_id: gardenId,
    role: 'editor',
    created_by_profile_id: createdByProfileId,
    ...overrides,
  });
}

export async function insertClientEngagement(
  client: pg.Client,
  gardenId: string,
  createdByProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.client_engagement', {
    id: randomUUID(),
    garden_id: gardenId,
    created_by_profile_id: createdByProfileId,
    ...overrides,
  });
}

export async function insertClientAccessGrant(
  client: pg.Client,
  engagementId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.client_access_grant', {
    id: randomUUID(),
    engagement_id: engagementId,
    ...overrides,
  });
}
