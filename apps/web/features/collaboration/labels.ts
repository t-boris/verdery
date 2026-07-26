import type { GardenRole, InvitationIntendedRole, InvitationState } from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Label mappings for the collaboration feature.
 *
 * `roleLabel`/`intendedRoleLabel` deliberately reuse `gardens.roleOwner`,
 * `gardens.roleEditor`, and `gardens.roleViewer` rather than declaring new
 * keys for the same three words: message keys are one flat namespace
 * regardless of which feature or module declares them (the same posture
 * `tasks.fromRecommendation` already takes, living in `en-today.ts` despite
 * its own prefix). Duplicating the English and Russian strings under a
 * second key would be a translation to keep in sync for no benefit.
 *
 * `features/collaboration` does not import `features/gardens/labels.ts`
 * itself — features import public Core and Shared interfaces only
 * (architecture/web-application-design.md, section "20. Dependency Rules")
 * — so this function is declared again here rather than imported across the
 * feature boundary.
 */
export function roleLabel(role: GardenRole): MessageKey {
  switch (role) {
    case 'owner':
      return 'gardens.roleOwner';
    case 'editor':
      return 'gardens.roleEditor';
    case 'viewer':
      return 'gardens.roleViewer';
  }
}

/** `InvitationIntendedRole` is `GardenRole` minus `owner` — `roleLabel` already covers both members. */
export function intendedRoleLabel(role: InvitationIntendedRole): MessageKey {
  return roleLabel(role);
}

export function invitationStateLabel(state: InvitationState): MessageKey {
  switch (state) {
    case 'pending':
      return 'invitations.state.pending';
    case 'accepted':
      return 'invitations.state.accepted';
    case 'revoked':
      return 'invitations.state.revoked';
    case 'expired':
      return 'invitations.state.expired';
  }
}

export function invitationStateTone(state: InvitationState): StatusTone {
  switch (state) {
    case 'pending':
      return 'neutral';
    case 'accepted':
      return 'positive';
    case 'revoked':
    case 'expired':
      return 'negative';
  }
}
