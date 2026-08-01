import type {
  PlantAcquisitionDateType,
  PlantCandidatePriority,
  PlantCandidateStatus,
  PlantGroupingKind,
  SuitabilityAxis,
  SuitabilityFinding,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Message-key and presentation mapping for the plant-candidate enums.
 *
 * `groupingKind` reuses the contract's shared `PlantGroupingKind` type, but
 * NOT `features/plants/labels.ts`'s own mapping function — a feature must
 * not import another feature (architecture/web-application-design.md,
 * section "20. Dependency Rules"), so the three grouping-kind labels are
 * duplicated here, same as `features/plants/map-object-queries.ts`'s own
 * precedent for this class of problem.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `PlantCandidateStatus`,
 * `PlantCandidatePriority`, `PlantGroupingKind`.
 */

export const CANDIDATE_GROUPING_KINDS: readonly PlantGroupingKind[] = [
  'individual',
  'row',
  'group',
];

/** Every status a filter or a manual transition can select — `converted` is reachable only through `convertCandidate`, never shown as a filter default. */
export const CANDIDATE_STATUSES: readonly PlantCandidateStatus[] = [
  'active',
  'converted',
  'archived',
  'rejected',
];

/** The subset `SetCandidateStatusRequest` accepts — never `converted`. */
export const SETTABLE_CANDIDATE_STATUSES: readonly PlantCandidateStatus[] = [
  'active',
  'archived',
  'rejected',
];

export const CANDIDATE_PRIORITIES: readonly PlantCandidatePriority[] = ['low', 'medium', 'high'];

/** `ConvertCandidateRequest.acquisitionDateType` — duplicates `features/plants/labels.ts`'s identical constant, see this file's own doc comment for why. */
export const CANDIDATE_ACQUISITION_DATE_TYPES: readonly PlantAcquisitionDateType[] = [
  'planted',
  'sown',
  'acquired',
];

export function candidateGroupingKindLabel(kind: PlantGroupingKind): MessageKey {
  switch (kind) {
    case 'individual':
      return 'candidates.enum.groupingKind.individual';
    case 'row':
      return 'candidates.enum.groupingKind.row';
    case 'group':
      return 'candidates.enum.groupingKind.group';
  }
}

export function candidateStatusLabel(status: PlantCandidateStatus): MessageKey {
  switch (status) {
    case 'active':
      return 'candidates.enum.status.active';
    case 'converted':
      return 'candidates.enum.status.converted';
    case 'archived':
      return 'candidates.enum.status.archived';
    case 'rejected':
      return 'candidates.enum.status.rejected';
  }
}

/** `active` reads as positive, `converted` as the successful terminal state, `rejected` as negative, `archived` as neutral. */
export function candidateStatusTone(status: PlantCandidateStatus): StatusTone {
  switch (status) {
    case 'active':
    case 'converted':
      return 'positive';
    case 'archived':
      return 'neutral';
    case 'rejected':
      return 'negative';
  }
}

export function candidatePriorityLabel(priority: PlantCandidatePriority): MessageKey {
  switch (priority) {
    case 'low':
      return 'candidates.enum.priority.low';
    case 'medium':
      return 'candidates.enum.priority.medium';
    case 'high':
      return 'candidates.enum.priority.high';
  }
}

export function candidateAcquisitionDateTypeLabel(type: PlantAcquisitionDateType): MessageKey {
  switch (type) {
    case 'planted':
      return 'candidates.enum.acquisitionDateType.planted';
    case 'sown':
      return 'candidates.enum.acquisitionDateType.sown';
    case 'acquired':
      return 'candidates.enum.acquisitionDateType.acquired';
  }
}

export function suitabilityAxisLabel(axis: SuitabilityAxis): MessageKey {
  switch (axis) {
    case 'hardiness':
      return 'candidates.enum.suitabilityAxis.hardiness';
    case 'sun_exposure':
      return 'candidates.enum.suitabilityAxis.sunExposure';
    case 'soil_ph':
      return 'candidates.enum.suitabilityAxis.soilPh';
    case 'drainage':
      return 'candidates.enum.suitabilityAxis.drainage';
    case 'mature_space':
      return 'candidates.enum.suitabilityAxis.matureSpace';
    case 'growing_context':
      return 'candidates.enum.suitabilityAxis.growingContext';
    case 'structural_conflict':
      return 'candidates.enum.suitabilityAxis.structuralConflict';
    case 'regulatory_status':
      return 'candidates.enum.suitabilityAxis.regulatoryStatus';
    case 'user_preference':
      return 'candidates.enum.suitabilityAxis.userPreference';
  }
}

export function suitabilityCategoryLabel(category: SuitabilityFinding['category']): MessageKey {
  switch (category) {
    case 'match':
      return 'candidates.enum.suitabilityCategory.match';
    case 'caution':
      return 'candidates.enum.suitabilityCategory.caution';
    case 'blocker':
      return 'candidates.enum.suitabilityCategory.blocker';
    case 'unknown':
      return 'candidates.enum.suitabilityCategory.unknown';
    case 'assumption':
      return 'candidates.enum.suitabilityCategory.assumption';
  }
}

/** `match` reads as positive, `blocker` as negative; `caution`, `unknown`, and `assumption` all read as neutral — none of them is a firm yes or no. */
export function suitabilityCategoryTone(category: SuitabilityFinding['category']): StatusTone {
  switch (category) {
    case 'match':
      return 'positive';
    case 'blocker':
      return 'negative';
    case 'caution':
    case 'unknown':
    case 'assumption':
      return 'neutral';
  }
}

export function suitabilityUnknownReasonLabel(
  reason: NonNullable<SuitabilityFinding['reason']>,
): MessageKey {
  switch (reason) {
    case 'garden_context_missing':
      return 'candidates.enum.suitabilityUnknownReason.gardenContextMissing';
    case 'plant_fact_missing':
      return 'candidates.enum.suitabilityUnknownReason.plantFactMissing';
    case 'placement_missing':
      return 'candidates.enum.suitabilityUnknownReason.placementMissing';
  }
}

/** `SuitabilityEvidence.value`/`SuitabilityFinding.assumedValue` are untyped JSON (`{}` in the contract) — displayed as-is when already a string, stringified otherwise. */
export function formatSuitabilityValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
