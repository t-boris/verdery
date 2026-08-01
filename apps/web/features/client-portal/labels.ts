import type { PublicationItemKind, PublicationMediaRole } from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';

/**
 * Label mappings for the client-portal feature (P9C-WEB-01).
 *
 * `PublicationItemKind`/`PublicationMediaRole` are the SAME enums the
 * operational `Publications` domain already declares — this feature does not
 * import `features/organizations` for them (features import public Core and
 * Shared interfaces only, architecture/web-application-design.md, section
 * "20. Dependency Rules"), so the mapping is declared again here, the same
 * posture `features/organizations/labels.ts`'s own header documents for its
 * reuse of `features/collaboration`'s vocabulary.
 */
export function itemKindLabel(kind: PublicationItemKind): MessageKey {
  switch (kind) {
    case 'work_log':
      return 'clientPortal.kindWorkLog';
    case 'media':
      return 'clientPortal.kindMedia';
    case 'garden_snapshot':
      return 'clientPortal.kindGardenSnapshot';
    case 'timeline_entry':
      return 'clientPortal.kindTimelineEntry';
    case 'observation':
      return 'clientPortal.kindObservation';
  }
}

export function mediaRoleLabel(role: PublicationMediaRole): MessageKey {
  switch (role) {
    case 'before':
      return 'clientPortal.mediaRoleBefore';
    case 'after':
      return 'clientPortal.mediaRoleAfter';
    case 'general':
      return 'clientPortal.mediaRoleGeneral';
  }
}
