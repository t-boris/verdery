import type {
  ClientEngagementState,
  GardenAssignmentRole,
  GardenAssignmentState,
  OrganizationRole,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Label mappings for the professional-service domain feature (P9B-WEB-01).
 *
 * `assignmentRoleLabel` deliberately reuses `gardens.roleEditor`/
 * `gardens.roleViewer` rather than declaring new keys for the same two
 * words — `GardenAssignmentRole` is the identical `editor`/`viewer`
 * vocabulary `GardenRole` minus `owner` uses, the same reasoning
 * `features/collaboration/labels.ts`'s own `intendedRoleLabel` already
 * documents for `InvitationIntendedRole`. `features/organizations` does not
 * import `features/collaboration` itself — features import public Core and
 * Shared interfaces only (architecture/web-application-design.md, section
 * "20. Dependency Rules") — so the mapping is declared again here rather
 * than imported across the feature boundary.
 */
export function organizationRoleLabel(role: OrganizationRole): MessageKey {
  switch (role) {
    case 'organizationAdmin':
      return 'organizations.roleAdmin';
    case 'professional':
      return 'organizations.roleProfessional';
  }
}

export function assignmentRoleLabel(role: GardenAssignmentRole): MessageKey {
  switch (role) {
    case 'editor':
      return 'gardens.roleEditor';
    case 'viewer':
      return 'gardens.roleViewer';
  }
}

export function assignmentStateLabel(state: GardenAssignmentState): MessageKey {
  switch (state) {
    case 'active':
      return 'assignments.state.active';
    case 'ended':
      return 'assignments.state.ended';
    case 'revoked':
      return 'assignments.state.revoked';
  }
}

export function assignmentStateTone(state: GardenAssignmentState): StatusTone {
  switch (state) {
    case 'active':
      return 'positive';
    case 'ended':
    case 'revoked':
      return 'neutral';
  }
}

export function engagementStateLabel(state: ClientEngagementState): MessageKey {
  switch (state) {
    case 'draft':
      return 'engagements.state.draft';
    case 'active':
      return 'engagements.state.active';
    case 'ended':
      return 'engagements.state.ended';
    case 'revoked':
      return 'engagements.state.revoked';
  }
}

export function engagementStateTone(state: ClientEngagementState): StatusTone {
  switch (state) {
    case 'active':
      return 'positive';
    case 'draft':
      return 'neutral';
    case 'ended':
    case 'revoked':
      return 'neutral';
  }
}
