import type { Generated } from 'kysely';

/**
 * Kysely row types for the six tables
 * `1786600000000_service-organizations-and-client-engagements.sql` (P9B-DATA-01)
 * adds. All six live in the `collaboration` Postgres schema, matching
 * `architecture/data-and-geospatial-design.md` section "3. Schema Ownership"
 * ("Collaboration — Memberships, organizations, assignments, engagements,
 * work logs, publications, and grants"). No table declared here overlaps
 * with `gardens-mapping/persistence/schema.ts`'s own `collaboration.*`
 * entries (`membership`, `membership_period`, `invitation`,
 * `ownership_transfer`) — see the migration's own header for why the schema
 * is, for now, typed from two TypeScript modules.
 */

/** Mirrors `collaboration.service_organization`. No lifecycle column — see the migration's own comment for why. */
export interface ServiceOrganizationRow {
  id: string;
  name: string;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Mirrors `collaboration.organization_membership` — the current-state row, structurally identical to `gardens-mapping`'s `MembershipRow`. */
export interface OrganizationMembershipRow {
  id: string;
  organization_id: string;
  profile_id: string;
  role: string;
  state: string;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Mirrors `collaboration.organization_membership_period` — the append-only interval history, structurally identical to `gardens-mapping`'s `MembershipPeriodRow`. */
export interface OrganizationMembershipPeriodRow {
  id: string;
  membership_id: string;
  organization_id: string;
  profile_id: string;
  role: string;
  valid_from: Date;
  valid_until: Date | null;
  ended_reason: string | null;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.garden_assignment` — the ONLY mechanism through
 * which organization membership becomes garden access. Built directly in
 * `membership_period`'s append-only shape; see the migration's own "WHY
 * `garden_assignment` GETS NO SEPARATE PERIOD TABLE" comment. `garden_id`
 * carries no foreign key, matching `membership.garden_id`'s own posture
 * since P8-DELETE-01, so an assignment record can survive a garden purge.
 */
export interface GardenAssignmentRow {
  id: string;
  organization_id: string;
  profile_id: string;
  garden_id: string;
  role: string;
  state: Generated<string>;
  valid_from: Generated<Date>;
  valid_until: Date | null;
  created_by_profile_id: string;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.client_engagement`. `garden_id` carries no foreign
 * key for the same reason `GardenAssignmentRow.garden_id` does not.
 * `stewardship_policy` is `Generated<string>` rather than a literal type for
 * the same reason `CoordinateSpaceRow.kind` is in `gardens-mapping`: the
 * migration's CHECK constrains the vocabulary (today: `'residential'` only),
 * and a Kysely row type describes what a column returns, not the CHECK's
 * current vocabulary.
 */
export interface ClientEngagementRow {
  id: string;
  garden_id: string;
  service_organization_id: string | null;
  state: Generated<string>;
  stewardship_policy: Generated<string>;
  client_notifications_enabled: Generated<boolean>;
  created_by_profile_id: string;
  activated_at: Date | null;
  ended_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.client_access_grant`. `client_profile_id` and
 * `invited_email` are both nullable because a grant identifies its client
 * either by a bound profile or by an invitation target that has not yet been
 * accepted — see the migration's own "WHY `client_access_grant` HAS NO
 * TOKEN" comment. No token/expiry columns exist here on purpose: that
 * mechanism belongs to P9C-INVITE-01.
 */
export interface ClientAccessGrantRow {
  id: string;
  engagement_id: string;
  client_profile_id: string | null;
  invited_email: string | null;
  state: Generated<string>;
  granted_at: Date | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface CollaborationDatabaseSchema {
  'collaboration.service_organization': ServiceOrganizationRow;
  'collaboration.organization_membership': OrganizationMembershipRow;
  'collaboration.organization_membership_period': OrganizationMembershipPeriodRow;
  'collaboration.garden_assignment': GardenAssignmentRow;
  'collaboration.client_engagement': ClientEngagementRow;
  'collaboration.client_access_grant': ClientAccessGrantRow;
}
