import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import {
  convertCandidateToPlant,
  markCandidateConverted,
  requireConvertibleCandidate,
} from './candidate-conversion.js';
import { createCandidate, setCandidateStatus } from './plant-candidate.js';
import type { CandidatePurchaseFacts } from './plant-candidate.js';
import type { PlantPlacement } from './plant.js';

const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const CONVERTER_PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NEW_PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const MAP_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
const NOW = new Date('2026-07-29T09:00:00Z');
const LATER = new Date('2026-07-29T10:00:00Z');

const NO_PURCHASE_FACTS: CandidatePurchaseFacts = {
  priceAmount: null,
  priceCurrency: null,
  purchaseSource: null,
};

function activeCandidate(): ReturnType<typeof createCandidate> {
  return createCandidate(
    CANDIDATE_ID,
    GARDEN_ID,
    { proposedGardenAreaMapObjectId: MAP_OBJECT_ID, proposedPlacementMapObjectId: null },
    'Fig tree',
    null,
    'Brown Turkey',
    'individual',
    undefined,
    'Shady corner needs something',
    'medium',
    NO_PURCHASE_FACTS,
    null,
    PROFILE_ID,
    NOW,
  );
}

describe('requireConvertibleCandidate', () => {
  it('accepts an active candidate', () => {
    expect(() => requireConvertibleCandidate(activeCandidate())).not.toThrow();
  });

  it('rejects an already-converted candidate', () => {
    const converted = { ...activeCandidate(), status: 'converted' as const };
    expect(() => requireConvertibleCandidate(converted)).toThrow(DomainRuleViolatedError);
  });

  it('rejects an archived candidate', () => {
    const archived = setCandidateStatus(activeCandidate(), 'archived', LATER);
    expect(() => requireConvertibleCandidate(archived)).toThrow(DomainRuleViolatedError);
  });

  it('rejects a rejected candidate', () => {
    const rejected = setCandidateStatus(activeCandidate(), 'rejected', LATER);
    expect(() => requireConvertibleCandidate(rejected)).toThrow(DomainRuleViolatedError);
  });
});

describe('convertCandidateToPlant', () => {
  it('carries identity fields across, starts the plant fresh at revision 1, records the acquisition event', () => {
    const candidate = activeCandidate();
    const finalPlacement: PlantPlacement = {
      gardenAreaMapObjectId: MAP_OBJECT_ID,
      placementMapObjectId: null,
    };

    const plant = convertCandidateToPlant(
      NEW_PLANT_ID,
      candidate,
      finalPlacement,
      '2026-07-29',
      'planted',
      CONVERTER_PROFILE_ID,
      LATER,
    );

    expect(plant.id).toBe(NEW_PLANT_ID);
    expect(plant.gardenId).toBe(GARDEN_ID);
    expect(plant.displayName).toBe('Fig tree');
    expect(plant.varietyLabel).toBe('Brown Turkey');
    expect(plant.gardenAreaMapObjectId).toBe(MAP_OBJECT_ID);
    expect(plant.acquisitionDate).toBe('2026-07-29');
    expect(plant.acquisitionDateType).toBe('planted');
    expect(plant.revision).toBe(1);
    expect(plant.lifecycleStage).toBe('planned');
    expect(plant.status).toBe('active');
    expect(plant.createdByProfileId).toBe(CONVERTER_PROFILE_ID);
    expect(plant.createdAt).toEqual(LATER);
  });

  it('accepts no acquisition date — an honest "converted, exact date unknown" state', () => {
    const plant = convertCandidateToPlant(
      NEW_PLANT_ID,
      activeCandidate(),
      { gardenAreaMapObjectId: null, placementMapObjectId: null },
      null,
      null,
      CONVERTER_PROFILE_ID,
      LATER,
    );
    expect(plant.acquisitionDate).toBeNull();
  });

  it('refuses to convert a non-active candidate, even with a valid placement', () => {
    const converted = { ...activeCandidate(), status: 'converted' as const };
    expect(() =>
      convertCandidateToPlant(
        NEW_PLANT_ID,
        converted,
        { gardenAreaMapObjectId: null, placementMapObjectId: null },
        null,
        null,
        CONVERTER_PROFILE_ID,
        LATER,
      ),
    ).toThrow(DomainRuleViolatedError);
  });
});

describe('markCandidateConverted', () => {
  it('flips status to converted and bumps revision', () => {
    const converted = markCandidateConverted(activeCandidate(), LATER);
    expect(converted.status).toBe('converted');
    expect(converted.revision).toBe(2);
    expect(converted.updatedAt).toEqual(LATER);
  });

  it('refuses an already-converted candidate', () => {
    const converted = { ...activeCandidate(), status: 'converted' as const };
    expect(() => markCandidateConverted(converted, LATER)).toThrow(DomainRuleViolatedError);
  });

  it('refuses an archived candidate', () => {
    const archived = setCandidateStatus(activeCandidate(), 'archived', LATER);
    expect(() => markCandidateConverted(archived, LATER)).toThrow(DomainRuleViolatedError);
  });
});
