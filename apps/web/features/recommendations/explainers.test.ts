import type { RecommendationEvidence, TodayRecommendation } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  describeEvidenceReference,
  describeFactValue,
  describeFactorBasis,
  describeUncertainty,
  formatContribution,
} from './explainers';

const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01';
const OTHER_PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02';
const OBSERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03';

function evidence(overrides: Partial<RecommendationEvidence>): RecommendationEvidence {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a04',
    kind: 'plant_identity',
    sourceObservationId: null,
    sourceTaskId: null,
    sourcePlantId: null,
    sourceWeatherRecordId: null,
    factKey: 'plant.observation_recency',
    factValue: null,
    ...overrides,
  };
}

function todayItem(overrides: Partial<TodayRecommendation>): TodayRecommendation {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a05',
    gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a06',
    ruleKey: 'observation.routine-check-reminder',
    ruleVersion: 1,
    careCategory: 'observation',
    safetyTier: 'ordinary_care',
    state: 'presented',
    urgency: 'low',
    targetKind: 'plant',
    targetGardenAreaMapObjectId: null,
    targetPlantId: PLANT_ID,
    windowStart: null,
    windowEnd: null,
    explanation: 'Tomato row has not been observed for 16 days.',
    supersedesCandidateId: null,
    presentedAt: '2026-07-21T09:00:00Z',
    revision: 2,
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
    actionTitle: 'Record a quick condition check for this plant',
    priorityScore: 40,
    priorityFactors: [],
    evidence: [evidence({ sourcePlantId: PLANT_ID })],
    targetDisplayName: 'Tomato row',
    ...overrides,
  };
}

describe('formatContribution', () => {
  it.each<[number, string]>([
    [20, '+20'],
    [0, '0'],
    [-5, '-5'],
  ])('formats %d as %s', (contribution, expected) => {
    expect(formatContribution(contribution)).toBe(expected);
  });
});

describe('describeFactorBasis', () => {
  it('renders the known launch-rule basis keys as dedicated phrases', () => {
    expect(
      describeFactorBasis({ source: 'own_records', daysSince: 16, weatherFreshness: 'fresh' }),
    ).toEqual([
      { key: 'today.basis.sourceOwnRecords' },
      { key: 'today.basis.daysSince', args: { days: 16 } },
      { key: 'today.basis.weatherFresh' },
    ]);
  });

  it('labels stale weather explicitly — cached stale data is labeled, never silent', () => {
    expect(describeFactorBasis({ weatherFreshness: 'stale' })).toEqual([
      { key: 'today.basis.weatherStale' },
    ]);
  });

  it('falls back to an honest key-value line for unrecognized basis facts', () => {
    expect(describeFactorBasis({ lifecycleStage: 'seed', frostRisk: true })).toEqual([
      { key: 'today.detailEntry', args: { key: 'lifecycleStage', value: 'seed' } },
      { key: 'today.detailEntry', args: { key: 'frostRisk', value: 'true' } },
    ]);
  });
});

describe('describeUncertainty', () => {
  it('surfaces the confidence factor with a signed contribution and its basis', () => {
    const item = todayItem({
      priorityFactors: [
        { kind: 'urgency_window', contribution: 10, basis: { urgency: 'low' } },
        { kind: 'confidence', contribution: 20, basis: { source: 'own_records', daysSince: 16 } },
      ],
    });

    expect(describeUncertainty(item)).toEqual({
      headline: { key: 'today.uncertaintyContribution', args: { contribution: '+20' } },
      basis: [
        { key: 'today.basis.sourceOwnRecords' },
        { key: 'today.basis.daysSince', args: { days: 16 } },
      ],
    });
  });

  it('states the absence honestly when no confidence factor was stored', () => {
    expect(describeUncertainty(todayItem({ priorityFactors: [] }))).toEqual({
      headline: { key: 'today.uncertaintyMissing' },
      basis: [],
    });
  });
});

describe('describeEvidenceReference', () => {
  it('resolves the target plant to the display name the payload itself carries', () => {
    const item = todayItem({});

    expect(describeEvidenceReference(item, evidence({ sourcePlantId: PLANT_ID }))).toEqual({
      key: 'today.evidencePlantNamed',
      args: { name: 'Tomato row' },
    });
  });

  it('falls back to the record id for a plant that is not the resolvable target', () => {
    const item = todayItem({});

    expect(describeEvidenceReference(item, evidence({ sourcePlantId: OTHER_PLANT_ID }))).toEqual({
      key: 'today.evidenceRecordReference',
      args: { id: OTHER_PLANT_ID },
    });
  });

  it('references observation records by id — no per-row fetching', () => {
    const item = todayItem({});
    const observationEvidence = evidence({
      kind: 'observation',
      sourceObservationId: OBSERVATION_ID,
      factKey: 'observation.latest_for_plant',
    });

    expect(describeEvidenceReference(item, observationEvidence)).toEqual({
      key: 'today.evidenceRecordReference',
      args: { id: OBSERVATION_ID },
    });
  });

  it('returns null for context kinds, which reference nothing', () => {
    const item = todayItem({});
    const contextEvidence = evidence({ kind: 'garden_context', factKey: 'garden.season' });

    expect(describeEvidenceReference(item, contextEvidence)).toBeNull();
  });
});

describe('describeFactValue', () => {
  it('renders a plain object as one key-value line per fact', () => {
    expect(describeFactValue({ daysSince: 16, baseline: 'plant_created_at' })).toEqual([
      { key: 'today.detailEntry', args: { key: 'daysSince', value: '16' } },
      { key: 'today.detailEntry', args: { key: 'baseline', value: 'plant_created_at' } },
    ]);
  });

  it('renders a scalar as a single value line', () => {
    expect(describeFactValue('stale')).toEqual([
      { key: 'today.detailValue', args: { value: 'stale' } },
    ]);
  });

  it('renders nothing for null — the referenced row itself is the value', () => {
    expect(describeFactValue(null)).toEqual([]);
  });
});
