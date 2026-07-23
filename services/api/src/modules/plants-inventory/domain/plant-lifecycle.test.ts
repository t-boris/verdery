import { describe, expect, it } from 'vitest';
import type { Plant } from './plant.js';
import { setPlantStatus, transitionPlantLifecycleStage } from './plant-lifecycle.js';

const NOW = new Date('2026-07-21T12:00:00Z');

function activePlant(): Plant {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
    gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    displayName: 'Tomato',
    taxonomyReferenceId: null,
    varietyLabel: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'planned',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 3,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('transitionPlantLifecycleStage', () => {
  it('sets the target stage and bumps the revision', () => {
    const result = transitionPlantLifecycleStage(activePlant(), 'flowering', NOW);
    expect(result.lifecycleStage).toBe('flowering');
    expect(result.revision).toBe(4);
    expect(result.updatedAt).toBe(NOW);
  });

  it('allows any stage to any stage, including a self-transition', () => {
    const plant = { ...activePlant(), lifecycleStage: 'growing' as const };
    expect(() => transitionPlantLifecycleStage(plant, 'seed', NOW)).not.toThrow();
    expect(() => transitionPlantLifecycleStage(plant, 'growing', NOW)).not.toThrow();
  });

  it('does not touch status', () => {
    const result = transitionPlantLifecycleStage(activePlant(), 'seedling', NOW);
    expect(result.status).toBe('active');
  });
});

describe('setPlantStatus', () => {
  it('sets the target status and bumps the revision', () => {
    const result = setPlantStatus(activePlant(), 'dormant', NOW);
    expect(result.status).toBe('dormant');
    expect(result.revision).toBe(4);
    expect(result.updatedAt).toBe(NOW);
  });

  it('allows any status to any status, including a self-transition', () => {
    const plant = activePlant();
    expect(() => setPlantStatus(plant, 'removed', NOW)).not.toThrow();
    expect(() => setPlantStatus(plant, 'active', NOW)).not.toThrow();
  });

  it('does not touch lifecycleStage', () => {
    const result = setPlantStatus(activePlant(), 'dead', NOW);
    expect(result.lifecycleStage).toBe('planned');
  });
});
