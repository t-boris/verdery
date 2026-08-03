import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createObservationSymptom } from './observation-symptom.js';

const ID = randomUUID();
const OBSERVATION_ID = randomUUID();
const NOW = new Date('2026-08-03T09:00:00Z');

describe('createObservationSymptom', () => {
  it('records what was seen, with the severity the observer chose', () => {
    const symptom = createObservationSymptom(ID, OBSERVATION_ID, 'leaf_spots', 'moderate', NOW);

    expect(symptom).toEqual({
      id: ID,
      observationId: OBSERVATION_ID,
      kind: 'leaf_spots',
      severity: 'moderate',
      createdAt: NOW,
    });
  });

  // A vocabulary this open would let a client record something nothing can
  // query — the same reason `observation_measurement.kind` is closed.
  it.each(['blight', 'LEAF_SPOTS', '', 'stress'])('refuses %o as a symptom', (kind) => {
    expect(() => createObservationSymptom(ID, OBSERVATION_ID, kind, 'mild', NOW)).toThrow(
      ValidationError,
    );
  });

  // `stress` above is deliberately in that list: it is a valid
  // `ImageAnalysisKind`, and a model's vocabulary must not be accepted as an
  // observer's.
  it.each(['none', 'critical', '3', ''])('refuses %o as a severity', (severity) => {
    expect(() => createObservationSymptom(ID, OBSERVATION_ID, 'wilting', severity, NOW)).toThrow(
      ValidationError,
    );
  });
});
