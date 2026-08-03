/**
 * A symptom a PERSON reported on an observation (P11-MEDIA-01).
 *
 * Deliberately not the same thing as an `image_analysis_result`, and
 * deliberately not stored with one. That row is a model's proposal and a
 * reviewer's disposition; this one is testimony. Reading either as the other
 * would misstate how much weight a health review should give it, so the two
 * share no table, no foreign key, and no vocabulary — see this table's own
 * migration header for why a single table with an `authored_by` discriminator
 * was rejected.
 *
 * `kind` describes what was VISIBLE, never what caused it: `leaf_spots` is
 * something a gardener can see, `blight` is a diagnosis they would be guessing
 * at. The closed set exists for the same reason
 * `observation_measurement.kind`'s does — the value arrives in a request body,
 * and an open column would accept a symptom nothing can query.
 *
 * At most one row per (observation, kind), matching
 * `observation_symptom_unique_kind`: seeing the same symptom worse next week
 * is a new observation.
 *
 * Source: migrations/1788400000000_observation-symptoms.sql;
 * architecture/plant-intelligence-and-visual-journal.md, section 8.1.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ObservationSymptomKind =
  | 'leaf_spots'
  | 'leaf_yellowing'
  | 'leaf_curling'
  | 'wilting'
  | 'holes_or_chewing'
  | 'mould_or_mildew'
  | 'dieback'
  | 'stunted_growth'
  | 'unusual_growth';

export const OBSERVATION_SYMPTOM_KINDS: readonly ObservationSymptomKind[] = [
  'leaf_spots',
  'leaf_yellowing',
  'leaf_curling',
  'wilting',
  'holes_or_chewing',
  'mould_or_mildew',
  'dieback',
  'stunted_growth',
  'unusual_growth',
];

/** Three values, not a numeric scale: two people would not report the same leaf as the same number out of ten. */
export type ObservationSymptomSeverity = 'mild' | 'moderate' | 'severe';

export const OBSERVATION_SYMPTOM_SEVERITIES: readonly ObservationSymptomSeverity[] = [
  'mild',
  'moderate',
  'severe',
];

export interface ObservationSymptom {
  readonly id: Uuid;
  readonly observationId: Uuid;
  readonly kind: ObservationSymptomKind;
  readonly severity: ObservationSymptomSeverity;
  readonly createdAt: Date;
}

function invalidField(code: string, pointer: string, message: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export function createObservationSymptom(
  id: Uuid,
  observationId: Uuid,
  rawKind: string,
  rawSeverity: string,
  now: Date,
): ObservationSymptom {
  if (!OBSERVATION_SYMPTOM_KINDS.includes(rawKind as ObservationSymptomKind)) {
    throw invalidField(
      'observation_symptom.kind.invalid',
      '/kind',
      `kind must be one of: ${OBSERVATION_SYMPTOM_KINDS.join(', ')}.`,
    );
  }
  if (!OBSERVATION_SYMPTOM_SEVERITIES.includes(rawSeverity as ObservationSymptomSeverity)) {
    throw invalidField(
      'observation_symptom.severity.invalid',
      '/severity',
      `severity must be one of: ${OBSERVATION_SYMPTOM_SEVERITIES.join(', ')}.`,
    );
  }

  return {
    id,
    observationId,
    kind: rawKind as ObservationSymptomKind,
    severity: rawSeverity as ObservationSymptomSeverity,
    createdAt: now,
  };
}
