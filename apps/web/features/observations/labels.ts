import type {
  ImageAnalysisKind,
  ObservationActorType,
  ObservationCorrectionKind,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';

/**
 * Message-key mapping for the observations-history enums.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `ImageAnalysisKind`,
 * `ObservationActorType`, `ObservationCorrectionKind`.
 */

export const OBSERVATION_CORRECTION_KINDS: readonly ObservationCorrectionKind[] = [
  'amendment',
  'supersede',
];

export function analysisKindLabel(kind: ImageAnalysisKind): MessageKey {
  switch (kind) {
    case 'stress':
      return 'observations.enum.analysisKind.stress';
    case 'disease':
      return 'observations.enum.analysisKind.disease';
    case 'pest':
      return 'observations.enum.analysisKind.pest';
    case 'other':
      return 'observations.enum.analysisKind.other';
  }
}

export function correctionKindLabel(kind: ObservationCorrectionKind): MessageKey {
  switch (kind) {
    case 'amendment':
      return 'observations.enum.correctionKind.amendment';
    case 'supersede':
      return 'observations.enum.correctionKind.supersede';
  }
}

export function actorTypeLabel(actor: ObservationActorType): MessageKey {
  switch (actor) {
    case 'user':
      return 'observations.enum.actorType.user';
    case 'system':
      return 'observations.enum.actorType.system';
  }
}
