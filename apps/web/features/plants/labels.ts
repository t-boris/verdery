import type {
  PlantAcquisitionDateType,
  PlantGroupingKind,
  PlantLifecycleStage,
  PlantStatus,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Message-key and presentation mapping for the plants-inventory enums.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `PlantGroupingKind`,
 * `PlantAcquisitionDateType`, `PlantLifecycleStage`, `PlantStatus`.
 */

export const PLANT_GROUPING_KINDS: readonly PlantGroupingKind[] = ['individual', 'row', 'group'];

export const PLANT_ACQUISITION_DATE_TYPES: readonly PlantAcquisitionDateType[] = [
  'planted',
  'sown',
  'acquired',
];

/** No ordering is enforced between stages — see the schema's own description. */
export const PLANT_LIFECYCLE_STAGES: readonly PlantLifecycleStage[] = [
  'planned',
  'seed',
  'seedling',
  'transplanted',
  'growing',
  'flowering',
  'fruiting',
  'ready_to_harvest',
];

export const PLANT_STATUSES: readonly PlantStatus[] = [
  'active',
  'dormant',
  'archived',
  'removed',
  'dead',
];

export function groupingKindLabel(kind: PlantGroupingKind): MessageKey {
  switch (kind) {
    case 'individual':
      return 'plants.enum.groupingKind.individual';
    case 'row':
      return 'plants.enum.groupingKind.row';
    case 'group':
      return 'plants.enum.groupingKind.group';
  }
}

export function acquisitionDateTypeLabel(type: PlantAcquisitionDateType): MessageKey {
  switch (type) {
    case 'planted':
      return 'plants.enum.acquisitionDateType.planted';
    case 'sown':
      return 'plants.enum.acquisitionDateType.sown';
    case 'acquired':
      return 'plants.enum.acquisitionDateType.acquired';
  }
}

export function lifecycleStageLabel(stage: PlantLifecycleStage): MessageKey {
  switch (stage) {
    case 'planned':
      return 'plants.enum.lifecycleStage.planned';
    case 'seed':
      return 'plants.enum.lifecycleStage.seed';
    case 'seedling':
      return 'plants.enum.lifecycleStage.seedling';
    case 'transplanted':
      return 'plants.enum.lifecycleStage.transplanted';
    case 'growing':
      return 'plants.enum.lifecycleStage.growing';
    case 'flowering':
      return 'plants.enum.lifecycleStage.flowering';
    case 'fruiting':
      return 'plants.enum.lifecycleStage.fruiting';
    case 'ready_to_harvest':
      return 'plants.enum.lifecycleStage.readyToHarvest';
  }
}

export function statusLabel(status: PlantStatus): MessageKey {
  switch (status) {
    case 'active':
      return 'plants.enum.status.active';
    case 'dormant':
      return 'plants.enum.status.dormant';
    case 'archived':
      return 'plants.enum.status.archived';
    case 'removed':
      return 'plants.enum.status.removed';
    case 'dead':
      return 'plants.enum.status.dead';
  }
}

/** `active` reads as positive, the two ended-lifecycle statuses as negative, the rest as neutral. */
export function statusTone(status: PlantStatus): StatusTone {
  switch (status) {
    case 'active':
      return 'positive';
    case 'dormant':
    case 'archived':
      return 'neutral';
    case 'removed':
    case 'dead':
      return 'negative';
  }
}
