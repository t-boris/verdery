import type { Garden, GardenRole } from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';

export function lifecycleLabel(state: Garden['lifecycleState']): MessageKey {
  switch (state) {
    case 'active':
      return 'gardens.lifecycleActive';
    case 'archived':
      return 'gardens.lifecycleArchived';
    case 'deletionRequested':
      return 'gardens.lifecycleDeletionRequested';
  }
}

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
