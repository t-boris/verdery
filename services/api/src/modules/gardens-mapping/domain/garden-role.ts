/**
 * Garden roles as stable capabilities, not scattered role-name comparisons.
 *
 * Only the capabilities Phase 2 endpoints actually check are modeled here
 * (`manageMembership`, for example, has no endpoint yet). A later module
 * adds a capability the same way: extend `GardenCapability` and BOTH matrices
 * below, not a parallel mechanism.
 *
 * Two matrices, because two independent questions decide one request: WHO may
 * ask (role -> capability) and WHETHER THE GARDEN IS IN A STATE TO BE ASKED
 * (capability -> lifecycle states). Keeping the second one here, beside the
 * first, is what makes the pair reviewable as a single permission matrix
 * instead of a rule scattered across command handlers.
 *
 * Source: architecture/identity-and-authorization.md, sections "8. Garden
 * Roles" and "9. Authorization Evaluation".
 */

import type { GardenLifecycleState } from './garden.js';

export type GardenRole = 'owner' | 'editor' | 'viewer';

export type GardenCapability =
  /** View garden content and permitted history. Every role has it. */
  | 'viewGarden'
  /** Add and change garden content — media, observations, tasks, map. Owner and editor. */
  | 'editGardenContent'
  /** Rename, archive, and request deletion. Owner only. */
  | 'manageGarden'
  /**
   * Export the full shared garden (P8-EXPORT-01). Owner only — architecture/
   * data-export-and-deletion.md section 4: "Garden owner can export the full
   * shared garden"; the same section's "Editor and viewer export rights are
   * controlled by garden capability" names THIS capability as the control
   * point, and no document grants those roles a default, so widening it is a
   * matrix change here, not a parallel mechanism (deferred-capabilities.md
   * records the open product decision).
   */
  | 'exportGarden';

const ROLE_CAPABILITIES: Readonly<Record<GardenRole, ReadonlySet<GardenCapability>>> = {
  owner: new Set(['viewGarden', 'editGardenContent', 'manageGarden', 'exportGarden']),
  editor: new Set(['viewGarden', 'editGardenContent']),
  viewer: new Set(['viewGarden']),
};

export function roleHasCapability(role: GardenRole, capability: GardenCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

const EVERY_LIFECYCLE_STATE: readonly GardenLifecycleState[] = [
  'active',
  'archived',
  'deletion_requested',
  'purging',
];

/**
 * The garden lifecycle states in which each capability may be exercised at all
 * — the "resource-specific restrictions" step of
 * identity-and-authorization.md section 9's evaluation, applied once for every
 * capability rather than re-derived per command.
 *
 * The record is exhaustive over `GardenCapability` BY TYPE, which is the
 * point: a capability added for a future command cannot compile until someone
 * decides which lifecycle states it survives, so a command written next phase
 * cannot silently inherit "allowed everywhere".
 *
 * Each decision, and why:
 *
 * - `viewGarden` — every state. The 30-day recovery window is worthless if the
 *   owner cannot see what they are about to lose
 *   (data-export-and-deletion.md section 10.4). Reads are never refused here;
 *   a purged garden stops being readable because its membership row stops
 *   being `active`, not because of this matrix. One non-read command rides on
 *   this capability on purpose — `UpdateNotificationPreferences`, which tunes
 *   the CALLER'S OWN notification settings and is "a fact of membership
 *   itself, not a content edit" (its own comment). It stays permitted: a user
 *   silencing notifications about a garden they just asked to delete is the
 *   expected thing to want.
 * - `editGardenContent` — `active` and `archived` only. THIS is the invariant
 *   section 10.3 promises ("marks deletion requested and revokes new edits"):
 *   from `deletion_requested` onward every content command is refused, in
 *   every module, because every content command funnels through this
 *   capability. `archived` stays writable, unchanged: archiving has never
 *   frozen content, and this matrix is not the place to change that.
 * - `manageGarden` — every state, deliberately. The four lifecycle commands
 *   that hold it disagree about what is legal from where, and only the domain
 *   transitions can express that: rename and archive refuse a pending
 *   deletion, requesting deletion twice is refused, and RESTORE MUST BE
 *   ALLOWED from `deletion_requested` or there is no recovery window at all.
 *   A blanket refusal here would break the recovery path this whole feature
 *   exists to provide.
 * - `exportGarden` — everything except `purging`. Exporting during the
 *   recovery window is exactly the point of the window; exporting during a
 *   purge is not, and is actively harmful: the purge's
 *   `exports.export_request.close_active` preparation has already run by then,
 *   so a request accepted afterwards would be a live row pointing at a garden
 *   whose row the purge is about to delete.
 */
const CAPABILITY_LIFECYCLE_STATES: Readonly<
  Record<GardenCapability, ReadonlySet<GardenLifecycleState>>
> = {
  viewGarden: new Set(EVERY_LIFECYCLE_STATE),
  editGardenContent: new Set(['active', 'archived']),
  manageGarden: new Set(EVERY_LIFECYCLE_STATE),
  exportGarden: new Set(['active', 'archived', 'deletion_requested']),
};

/**
 * Every modeled capability, derived from the matrix above rather than listed
 * again — so a test can enumerate capabilities and stay complete on its own.
 */
export const GARDEN_CAPABILITIES: readonly GardenCapability[] = Object.keys(
  CAPABILITY_LIFECYCLE_STATES,
) as GardenCapability[];

export function capabilityAllowedInLifecycleState(
  capability: GardenCapability,
  lifecycleState: GardenLifecycleState,
): boolean {
  return CAPABILITY_LIFECYCLE_STATES[capability].has(lifecycleState);
}
