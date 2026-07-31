/**
 * A single typed measurement attached to an observation — height, width, or
 * count. Append-only, one row per `(observationId, kind)`, matching the
 * migration's own `observation_measurement_unique_kind` constraint: a
 * correction that needs a revised measurement is a new observation, not an
 * update to an existing measurement row.
 *
 * `kind` is a closed enum rather than an open `fact_key`-style string: unlike
 * `plant_fact_assertion.fact_key` (populated by a reviewed provider
 * pipeline), a measurement here comes directly from a client request body,
 * so an open column would let a client submit an unqueryable, ungoverned
 * kind.
 *
 * Source: migrations/1787900000000_visual-journal-observation-extensions.sql,
 * `observations_history.observation_measurement`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ObservationMeasurementKind = 'height' | 'width' | 'count';

export const OBSERVATION_MEASUREMENT_KINDS: readonly ObservationMeasurementKind[] = [
  'height',
  'width',
  'count',
];

export interface ObservationMeasurement {
  readonly id: Uuid;
  readonly observationId: Uuid;
  readonly kind: ObservationMeasurementKind;
  readonly value: number;
  readonly unit: string;
  readonly createdAt: Date;
}

function invalidField(code: string, pointer: string, message: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export function createObservationMeasurement(
  id: Uuid,
  observationId: Uuid,
  rawKind: string,
  value: number,
  unit: string,
  now: Date,
): ObservationMeasurement {
  if (!OBSERVATION_MEASUREMENT_KINDS.includes(rawKind as ObservationMeasurementKind)) {
    throw invalidField(
      'observation_measurement.kind.invalid',
      '/kind',
      `kind must be one of: ${OBSERVATION_MEASUREMENT_KINDS.join(', ')}.`,
    );
  }
  if (!Number.isFinite(value) || value < 0) {
    throw invalidField(
      'observation_measurement.value.invalid',
      '/value',
      'value must be a non-negative finite number.',
    );
  }
  const trimmedUnit = unit.trim();
  if (trimmedUnit.length === 0) {
    throw invalidField('observation_measurement.unit.invalid', '/unit', 'unit must not be blank.');
  }

  return {
    id,
    observationId,
    kind: rawKind as ObservationMeasurementKind,
    value,
    unit: trimmedUnit,
    createdAt: now,
  };
}
