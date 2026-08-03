import type {
  HealthSuggestionDisposition,
  HealthSuggestionSafetyClass,
  ImageAnalysisKind,
  ObservationActorType,
  ObservationCorrectionKind,
  ObservationPhotoPurpose,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Message-key mapping for the observations-history enums.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `ImageAnalysisKind`,
 * `ObservationActorType`, `ObservationCorrectionKind`,
 * `HealthSuggestionSafetyClass`, `HealthSuggestionDisposition`.
 */

export const OBSERVATION_CORRECTION_KINDS: readonly ObservationCorrectionKind[] = [
  'amendment',
  'supersede',
];

/** Every disposition a reviewer can set — `SetHealthSuggestionDisposition` allows reconsidering freely, including back to `unresolved`. */
export const HEALTH_SUGGESTION_DISPOSITIONS: readonly HealthSuggestionDisposition[] = [
  'unresolved',
  'confirmed_externally',
  'accepted_as_observation',
  'rejected',
];

/** Every shot purpose a journal sequence can be narrowed to, in the order the design doc lists them (§8.2): whole plant first, then the parts, then the two special cases. */
export const OBSERVATION_PHOTO_PURPOSES: readonly ObservationPhotoPurpose[] = [
  'whole_plant',
  'leaf_front',
  'leaf_back',
  'stem_or_bark',
  'flower',
  'fruit',
  'symptom_close_up',
  'context_or_free_form',
];

export function photoPurposeLabel(purpose: ObservationPhotoPurpose): MessageKey {
  switch (purpose) {
    case 'whole_plant':
      return 'observations.enum.photoPurpose.wholePlant';
    case 'leaf_front':
      return 'observations.enum.photoPurpose.leafFront';
    case 'leaf_back':
      return 'observations.enum.photoPurpose.leafBack';
    case 'stem_or_bark':
      return 'observations.enum.photoPurpose.stemOrBark';
    case 'flower':
      return 'observations.enum.photoPurpose.flower';
    case 'fruit':
      return 'observations.enum.photoPurpose.fruit';
    case 'symptom_close_up':
      return 'observations.enum.photoPurpose.symptomCloseUp';
    case 'context_or_free_form':
      return 'observations.enum.photoPurpose.contextOrFreeForm';
  }
}

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

export function safetyClassLabel(safetyClass: HealthSuggestionSafetyClass): MessageKey {
  switch (safetyClass) {
    case 'informational':
      return 'observations.enum.safetyClass.informational';
    case 'monitor':
      return 'observations.enum.safetyClass.monitor';
    case 'expert_review_recommended':
      return 'observations.enum.safetyClass.expertReviewRecommended';
  }
}

/** `expert_review_recommended` reads as the most urgent tone available (`negative`, not a literal error — `StatusPill` has no dedicated "warning" tone); `monitor` and `informational` both read as neutral, not `positive` — an AI suggestion is never a confirmed good result. */
export function safetyClassTone(safetyClass: HealthSuggestionSafetyClass): StatusTone {
  switch (safetyClass) {
    case 'informational':
      return 'neutral';
    case 'monitor':
      return 'neutral';
    case 'expert_review_recommended':
      return 'negative';
  }
}

export function dispositionLabel(disposition: HealthSuggestionDisposition): MessageKey {
  switch (disposition) {
    case 'unresolved':
      return 'observations.enum.disposition.unresolved';
    case 'confirmed_externally':
      return 'observations.enum.disposition.confirmedExternally';
    case 'accepted_as_observation':
      return 'observations.enum.disposition.acceptedAsObservation';
    case 'rejected':
      return 'observations.enum.disposition.rejected';
  }
}
