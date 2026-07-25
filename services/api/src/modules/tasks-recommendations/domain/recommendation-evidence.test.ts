import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type {
  NewRecommendationEvidence,
  RecommendationEvidenceKind,
} from './recommendation-evidence.js';
import {
  buildRecommendationEvidence,
  validateEvidenceReferenceConsistency,
} from './recommendation-evidence.js';

const NOW = new Date('2026-07-24T12:00:00Z');
const EVIDENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c02';
const OBSERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c03';
const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c04';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c05';
const WEATHER_RECORD_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c06';

function item(overrides: Partial<NewRecommendationEvidence> = {}): NewRecommendationEvidence {
  return {
    id: EVIDENCE_ID,
    kind: 'garden_context',
    sourceObservationId: null,
    sourceTaskId: null,
    sourcePlantId: null,
    sourceWeatherRecordId: null,
    rawFactKey: 'garden.season',
    factValue: 'summer',
    ...overrides,
  };
}

/** Every kind with the one reference field it must set (`null` for the context kinds), mirroring the migration's reference-consistency CHECK exhaustively. */
const KIND_REFERENCE_MATRIX: readonly {
  kind: RecommendationEvidenceKind;
  reference: Partial<NewRecommendationEvidence>;
}[] = [
  { kind: 'observation', reference: { sourceObservationId: OBSERVATION_ID } },
  { kind: 'task', reference: { sourceTaskId: TASK_ID } },
  { kind: 'plant_identity', reference: { sourcePlantId: PLANT_ID } },
  { kind: 'lifecycle_stage', reference: { sourcePlantId: PLANT_ID } },
  { kind: 'weather', reference: { sourceWeatherRecordId: WEATHER_RECORD_ID } },
  { kind: 'garden_context', reference: {} },
  { kind: 'soil_moisture', reference: {} },
  { kind: 'geometry_exposure', reference: {} },
  { kind: 'user_preference', reference: {} },
];

describe('validateEvidenceReferenceConsistency', () => {
  it('accepts every kind carrying exactly its own reference', () => {
    for (const { kind, reference } of KIND_REFERENCE_MATRIX) {
      expect(() =>
        validateEvidenceReferenceConsistency(item({ kind, ...reference }), 0),
      ).not.toThrow();
    }
  });

  it('rejects every reference kind missing its required reference', () => {
    for (const kind of [
      'observation',
      'task',
      'plant_identity',
      'lifecycle_stage',
      'weather',
    ] as const) {
      expect(() => validateEvidenceReferenceConsistency(item({ kind }), 0)).toThrow(
        ValidationError,
      );
    }
  });

  it('rejects a stray extra reference on a reference kind', () => {
    expect(() =>
      validateEvidenceReferenceConsistency(
        item({ kind: 'observation', sourceObservationId: OBSERVATION_ID, sourceTaskId: TASK_ID }),
        0,
      ),
    ).toThrow(ValidationError);
  });

  it('rejects any reference on a context kind', () => {
    for (const kind of [
      'garden_context',
      'soil_moisture',
      'geometry_exposure',
      'user_preference',
    ] as const) {
      expect(() =>
        validateEvidenceReferenceConsistency(item({ kind, sourcePlantId: PLANT_ID }), 0),
      ).toThrow(ValidationError);
    }
  });
});

describe('buildRecommendationEvidence', () => {
  it('binds the item to its candidate, trims the fact key, and stamps the creation time', () => {
    const evidence = buildRecommendationEvidence(
      item({ rawFactKey: '  garden.season  ' }),
      0,
      CANDIDATE_ID,
      NOW,
    );

    expect(evidence).toEqual({
      id: EVIDENCE_ID,
      candidateId: CANDIDATE_ID,
      kind: 'garden_context',
      sourceObservationId: null,
      sourceTaskId: null,
      sourcePlantId: null,
      sourceWeatherRecordId: null,
      factKey: 'garden.season',
      factValue: 'summer',
      createdAt: NOW,
    });
  });

  it('keeps a null factValue null — a missing fact stays missing, never invented', () => {
    const evidence = buildRecommendationEvidence(
      item({ kind: 'observation', sourceObservationId: OBSERVATION_ID, factValue: null }),
      0,
      CANDIDATE_ID,
      NOW,
    );
    expect(evidence.factValue).toBeNull();
  });

  it('rejects a blank fact key, including the all-spaces one the migration CHECK would accept', () => {
    expect(() =>
      buildRecommendationEvidence(item({ rawFactKey: '   ' }), 0, CANDIDATE_ID, NOW),
    ).toThrow(ValidationError);
  });

  it('rejects a fact key longer than 200 characters', () => {
    expect(() =>
      buildRecommendationEvidence(item({ rawFactKey: 'k'.repeat(201) }), 0, CANDIDATE_ID, NOW),
    ).toThrow(ValidationError);
  });

  it('points at the offending list index in its error detail', () => {
    try {
      buildRecommendationEvidence(item({ rawFactKey: '' }), 2, CANDIDATE_ID, NOW);
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details?.[0]?.pointer).toBe('/evidence/2');
    }
  });
});
