/**
 * Service-organization roles as stable capabilities, mirroring
 * `gardens-mapping/domain/garden-role.ts`'s shape: a `Record<Role,
 * ReadonlySet<Capability>>` plus a `roleHas*` lookup, not a role-literal
 * comparison scattered across future command handlers.
 *
 * ONLY ONE MATRIX HERE, UNLIKE `garden-role.ts`. That file pairs its role
 * matrix with a SECOND matrix — which lifecycle states each capability
 * survives — because `gardens_mapping.garden` has a real lifecycle
 * (`active`/`archived`/`deletion_requested`/`purging`) capabilities must be
 * evaluated against. `collaboration.service_organization` has no lifecycle
 * column at all (see the migration's own "NO LIFECYCLE ON
 * `service_organization`" comment), so there is no second axis to pair
 * against yet. A future organization lifecycle would earn its own matrix the
 * same way the garden one did — not before.
 *
 * NO CAPABILITY IS CHECKED BY ANY COMMAND TODAY. P9B-DATA-01 (this package)
 * is schema-only; P9B-API-01 is what will call `organizationRoleHasCapability`
 * from an actual command. The vocabulary is declared now so the schema's
 * `organization_membership_role_check` and this type never drift apart, the
 * same reason `GardenRole` lives beside `collaboration.membership_role_check`
 * rather than after it.
 *
 * Source: architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Service Organizations"; architecture/collaboration-and-client-
 * sharing.md, section "7. Service Organizations and Assignments".
 */

export type OrganizationRole = 'organization_admin' | 'professional';

export type OrganizationCapability =
  /**
   * Invite, remove, and change the role of organization members. Organization
   * administration, never implied by mere membership — ADR-0012:
   * "`organization_admin`: organization membership, garden assignments,
   * publisher grants, and organization policy."
   */
  | 'manageOrganizationMembership'
  /**
   * Create and revoke `collaboration.garden_assignment` rows — the ONLY
   * mechanism through which a professional's organization membership becomes
   * garden access (ADR-0012: "Organization membership alone grants no garden
   * access").
   */
  | 'manageGardenAssignment'
  /**
   * Create, activate, end, and revoke a `collaboration.client_engagement` on
   * this organization's behalf.
   */
  | 'manageEngagement';

/** Every modeled capability, listed once so a new one cannot be added to one role's set without being added here too — the same completeness property `GARDEN_CAPABILITIES` gives `garden-role.ts`. */
export const ORGANIZATION_CAPABILITIES: readonly OrganizationCapability[] = [
  'manageOrganizationMembership',
  'manageGardenAssignment',
  'manageEngagement',
];

const ROLE_CAPABILITIES: Readonly<Record<OrganizationRole, ReadonlySet<OrganizationCapability>>> = {
  organization_admin: new Set(ORGANIZATION_CAPABILITIES),
  // A professional's rights come entirely from `garden_assignment` (itself
  // scoped by `GardenCapability`, per the migration's "ROLE-SHAPED
  // ASSIGNMENT" comment), never from organization membership itself.
  professional: new Set(),
};

export function organizationRoleHasCapability(
  role: OrganizationRole,
  capability: OrganizationCapability,
): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}
