/**
 * Garden roles as stable capabilities, not scattered role-name comparisons.
 *
 * Only the capabilities Phase 2 endpoints actually check are modeled here
 * (`manageMembership`, for example, has no endpoint yet). A later module
 * adds a capability the same way: extend `GardenCapability` and the matrix
 * below, not a parallel mechanism.
 *
 * Source: architecture/identity-and-authorization.md, section "8. Garden Roles".
 */

export type GardenRole = 'owner' | 'editor' | 'viewer';

export type GardenCapability =
  /** View garden content and permitted history. Every role has it. */
  | 'viewGarden'
  /** Add and change garden content — media, observations, tasks, map. Owner and editor. */
  | 'editGardenContent'
  /** Rename, archive, and request deletion. Owner only. */
  | 'manageGarden';

const ROLE_CAPABILITIES: Readonly<Record<GardenRole, ReadonlySet<GardenCapability>>> = {
  owner: new Set(['viewGarden', 'editGardenContent', 'manageGarden']),
  editor: new Set(['viewGarden', 'editGardenContent']),
  viewer: new Set(['viewGarden']),
};

export function roleHasCapability(role: GardenRole, capability: GardenCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}
