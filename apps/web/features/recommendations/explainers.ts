import type {
  RecommendationEvidence,
  RecommendationPriorityFactor,
  TodayRecommendation,
} from '@verdery/api-contracts';

import type { MessageArguments, MessageKey } from '@/shared/localization/public';

/**
 * Turns the open-shaped parts of a Today item — priority-factor `basis`
 * objects and evidence `factValue` snapshots — into localized, readable
 * lines instead of raw JSON.
 *
 * The basis vocabulary is rule-authored and open (`additionalProperties:
 * true` in the contract), so this module renders the keys the launch rules
 * are known to write (`source`, `weatherFreshness`, `daysSince`) as real
 * sentences — including the stale-weather label external-integrations.md
 * section 11 requires ("Cached stale data is labeled") — and falls back to
 * an honest `key: value` line for anything it does not recognize, rather
 * than hiding it. Values are never invented: a missing confidence factor
 * renders as exactly that.
 *
 * Everything here returns message DESCRIPTORS (`{ key, args }`), not
 * strings, so components translate through the one `useLocalization` path
 * and this module stays renderable-logic only.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas
 * `RecommendationPriorityFactor` (basis), `RecommendationEvidence`
 * (factValue); services/api `domain/rules/*` for the launch-rule bases.
 */

export interface MessageDescriptor {
  readonly key: MessageKey;
  readonly args?: MessageArguments;
}

/** Formats an unknown JSON value into a short human-readable string. */
function formatScalar(value: unknown): string {
  if (value === null) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeBasisEntry(key: string, value: unknown): MessageDescriptor {
  if (key === 'source' && value === 'own_records') {
    return { key: 'today.basis.sourceOwnRecords' };
  }
  if (key === 'source' && value === 'user_declared_lifecycle_stage') {
    return { key: 'today.basis.sourceUserDeclaredLifecycleStage' };
  }
  if (key === 'source' && value === 'forecast') {
    return { key: 'today.basis.sourceForecast' };
  }
  if (key === 'weatherFreshness' && value === 'fresh') {
    return { key: 'today.basis.weatherFresh' };
  }
  if (key === 'weatherFreshness' && value === 'stale') {
    return { key: 'today.basis.weatherStale' };
  }
  if (key === 'daysSince' && typeof value === 'number') {
    return { key: 'today.basis.daysSince', args: { days: value } };
  }
  return { key: 'today.detailEntry', args: { key, value: formatScalar(value) } };
}

/** One factor basis, as readable lines — one per basis fact. */
export function describeFactorBasis(basis: Readonly<Record<string, unknown>>): MessageDescriptor[] {
  return Object.entries(basis).map(([key, value]) => describeBasisEntry(key, value));
}

/** Signed contribution display (`+20`, `-5`) — `Intl` adds no sign for positives. */
export function formatContribution(contribution: number): string {
  return contribution > 0 ? `+${String(contribution)}` : String(contribution);
}

/**
 * The item's uncertainty statement: the `confidence` factor's contribution
 * and basis, or the honest absence line when no confidence factor was
 * stored.
 */
export function describeUncertainty(item: TodayRecommendation): {
  readonly headline: MessageDescriptor;
  readonly basis: readonly MessageDescriptor[];
} {
  const confidence = item.priorityFactors.find(
    (factor): factor is RecommendationPriorityFactor => factor.kind === 'confidence',
  );
  if (confidence === undefined) {
    return { headline: { key: 'today.uncertaintyMissing' }, basis: [] };
  }
  return {
    headline: {
      key: 'today.uncertaintyContribution',
      args: { contribution: formatContribution(confidence.contribution) },
    },
    basis: describeFactorBasis(confidence.basis),
  };
}

/**
 * The record an evidence row references, as a readable line — or `null` for
 * context kinds, which reference nothing. The Today payload carries exactly
 * one resolvable display name (the target plant's), so an evidence row
 * pointing at that same plant renders its name; every other reference
 * renders its record id honestly rather than fetching per row.
 */
export function describeEvidenceReference(
  item: TodayRecommendation,
  evidence: RecommendationEvidence,
): MessageDescriptor | null {
  if (evidence.sourcePlantId !== null) {
    if (evidence.sourcePlantId === item.targetPlantId && item.targetDisplayName !== null) {
      return { key: 'today.evidencePlantNamed', args: { name: item.targetDisplayName } };
    }
    return { key: 'today.evidenceRecordReference', args: { id: evidence.sourcePlantId } };
  }
  if (evidence.sourceObservationId !== null) {
    return { key: 'today.evidenceRecordReference', args: { id: evidence.sourceObservationId } };
  }
  if (evidence.sourceTaskId !== null) {
    return { key: 'today.evidenceRecordReference', args: { id: evidence.sourceTaskId } };
  }
  if (evidence.sourceWeatherRecordId !== null) {
    return { key: 'today.evidenceRecordReference', args: { id: evidence.sourceWeatherRecordId } };
  }
  return null;
}

/**
 * One evidence `factValue` snapshot as readable lines: a plain object
 * becomes one `key: value` line per fact, a scalar becomes a single value
 * line, and `null` becomes nothing — for reference kinds the referenced row
 * itself is the value, per the schema's own description.
 */
export function describeFactValue(factValue: unknown): MessageDescriptor[] {
  if (factValue === null || factValue === undefined) {
    return [];
  }
  if (isPlainRecord(factValue)) {
    return Object.entries(factValue).map(([key, value]) => ({
      key: 'today.detailEntry',
      args: { key, value: formatScalar(value) },
    }));
  }
  return [{ key: 'today.detailValue', args: { value: formatScalar(factValue) } }];
}
