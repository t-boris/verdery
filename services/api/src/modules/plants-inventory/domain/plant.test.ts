import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  confirmPlantIdentification,
  createPlant,
  movePlant,
  updatePlantDetails,
  validateAcquisitionDate,
  validateDisplayName,
  validateQuantityForGroupingKind,
} from './plant.js';
import type { PlantPlacement } from './plant.js';

const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const MAP_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const IDENTIFICATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
const NOW = new Date('2026-07-21T09:00:00Z');
const LATER = new Date('2026-07-21T10:00:00Z');

const NO_PLACEMENT: PlantPlacement = { gardenAreaMapObjectId: null, placementMapObjectId: null };

function individualPlant(): ReturnType<typeof createPlant> {
  return createPlant(
    PLANT_ID,
    GARDEN_ID,
    NO_PLACEMENT,
    'Tomato #1',
    null,
    null,
    null,
    null,
    'individual',
    undefined,
    PROFILE_ID,
    NOW,
  );
}

describe('createPlant', () => {
  it('starts at revision 1, planned/active, trimmed name, no accepted identification', () => {
    const plant = individualPlant();

    expect(plant).toEqual({
      id: PLANT_ID,
      gardenId: GARDEN_ID,
      gardenAreaMapObjectId: null,
      placementMapObjectId: null,
      displayName: 'Tomato #1',
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
      revision: 1,
      createdByProfileId: PROFILE_ID,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('trims a padded display name', () => {
    const plant = createPlant(
      PLANT_ID,
      GARDEN_ID,
      NO_PLACEMENT,
      '  Tomato  ',
      null,
      null,
      null,
      null,
      'individual',
      undefined,
      PROFILE_ID,
      NOW,
    );
    expect(plant.displayName).toBe('Tomato');
  });

  it('accepts a placement referencing map objects', () => {
    const placement: PlantPlacement = {
      gardenAreaMapObjectId: MAP_OBJECT_ID,
      placementMapObjectId: null,
    };
    const plant = createPlant(
      PLANT_ID,
      GARDEN_ID,
      placement,
      'Tomato',
      null,
      null,
      null,
      null,
      'individual',
      undefined,
      PROFILE_ID,
      NOW,
    );
    expect(plant.gardenAreaMapObjectId).toBe(MAP_OBJECT_ID);
  });

  it('rejects a blank display name', () => {
    expect(() =>
      createPlant(
        PLANT_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        '   ',
        null,
        null,
        null,
        null,
        'individual',
        undefined,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('rejects quantity set on an individual plant', () => {
    expect(() =>
      createPlant(
        PLANT_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        'Tomato',
        null,
        null,
        null,
        null,
        'individual',
        3,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('requires a positive quantity for a row', () => {
    expect(() =>
      createPlant(
        PLANT_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        'Carrots',
        null,
        null,
        null,
        null,
        'row',
        undefined,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      createPlant(
        PLANT_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        'Carrots',
        null,
        null,
        null,
        null,
        'row',
        0,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('accepts a positive quantity for a row', () => {
    const plant = createPlant(
      PLANT_ID,
      GARDEN_ID,
      NO_PLACEMENT,
      'Carrots',
      null,
      null,
      null,
      null,
      'row',
      12,
      PROFILE_ID,
      NOW,
    );
    expect(plant.quantity).toBe(12);
  });

  it('rejects a malformed acquisition date', () => {
    expect(() =>
      createPlant(
        PLANT_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        'Tomato',
        null,
        null,
        '07/21/2026',
        'planted',
        'individual',
        undefined,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('accepts a well-formed acquisition date', () => {
    const plant = createPlant(
      PLANT_ID,
      GARDEN_ID,
      NO_PLACEMENT,
      'Tomato',
      null,
      null,
      '2026-05-01',
      'planted',
      'individual',
      undefined,
      PROFILE_ID,
      NOW,
    );
    expect(plant.acquisitionDate).toBe('2026-05-01');
  });
});

describe('validateDisplayName', () => {
  it('rejects a name that is blank only after trimming', () => {
    expect(() => validateDisplayName('   ')).toThrow(ValidationError);
  });

  it('rejects a name over 200 characters', () => {
    expect(() => validateDisplayName('x'.repeat(201))).toThrow(ValidationError);
  });
});

describe('validateQuantityForGroupingKind', () => {
  it('returns null for individual with no quantity', () => {
    expect(validateQuantityForGroupingKind('individual', undefined)).toBeNull();
  });

  it('rejects individual with a quantity', () => {
    expect(() => validateQuantityForGroupingKind('individual', 5)).toThrow(ValidationError);
  });

  it('rejects group with no quantity', () => {
    expect(() => validateQuantityForGroupingKind('group', null)).toThrow(ValidationError);
  });

  it('rejects group with a non-positive quantity', () => {
    expect(() => validateQuantityForGroupingKind('group', -1)).toThrow(ValidationError);
  });

  it('accepts group with a positive quantity', () => {
    expect(validateQuantityForGroupingKind('group', 4)).toBe(4);
  });
});

describe('validateAcquisitionDate', () => {
  it('rejects an empty string', () => {
    expect(() => validateAcquisitionDate('')).toThrow(ValidationError);
  });

  it('accepts an ISO calendar date', () => {
    expect(validateAcquisitionDate('2026-01-05')).toBe('2026-01-05');
  });
});

describe('updatePlantDetails', () => {
  it('leaves fields untouched when omitted, and bumps the revision', () => {
    const plant = individualPlant();
    const updated = updatePlantDetails(plant, {}, LATER);

    expect(updated).toEqual({ ...plant, revision: 2, updatedAt: LATER });
  });

  it('applies every provided field', () => {
    const plant = individualPlant();
    const updated = updatePlantDetails(
      plant,
      {
        displayName: '  Tomato #2  ',
        taxonomyReferenceId: TAXONOMY_ID,
        varietyLabel: 'Cherry',
        acquisitionDate: '2026-03-01',
        acquisitionDateType: 'sown',
        conditionNote: 'Thriving',
        careGuidanceNote: 'Water daily',
      },
      LATER,
    );

    expect(updated).toMatchObject({
      displayName: 'Tomato #2',
      taxonomyReferenceId: TAXONOMY_ID,
      varietyLabel: 'Cherry',
      acquisitionDate: '2026-03-01',
      acquisitionDateType: 'sown',
      conditionNote: 'Thriving',
      careGuidanceNote: 'Water daily',
      revision: 2,
    });
  });

  it('clears taxonomyReferenceId when explicitly set to null', () => {
    const plant = updatePlantDetails(individualPlant(), { taxonomyReferenceId: TAXONOMY_ID }, NOW);
    const cleared = updatePlantDetails(plant, { taxonomyReferenceId: null }, LATER);
    expect(cleared.taxonomyReferenceId).toBeNull();
  });

  it("validates quantity against the plant's own immutable groupingKind", () => {
    const plant = individualPlant();
    expect(() => updatePlantDetails(plant, { quantity: 5 }, LATER)).toThrow(ValidationError);
  });

  it('rejects a blank displayName update', () => {
    expect(() => updatePlantDetails(individualPlant(), { displayName: '   ' }, LATER)).toThrow(
      ValidationError,
    );
  });
});

describe('confirmPlantIdentification', () => {
  it('sets taxonomyReferenceId and acceptedIdentificationId and bumps the revision', () => {
    const plant = individualPlant();
    const confirmed = confirmPlantIdentification(plant, TAXONOMY_ID, IDENTIFICATION_ID, LATER);

    expect(confirmed.taxonomyReferenceId).toBe(TAXONOMY_ID);
    expect(confirmed.acceptedIdentificationId).toBe(IDENTIFICATION_ID);
    expect(confirmed.revision).toBe(2);
    expect(confirmed.updatedAt).toBe(LATER);
  });

  it('accepts a null taxonomyReferenceId for a confirmed "no confident match" identification', () => {
    const plant = individualPlant();
    const confirmed = confirmPlantIdentification(plant, null, IDENTIFICATION_ID, LATER);
    expect(confirmed.taxonomyReferenceId).toBeNull();
    expect(confirmed.acceptedIdentificationId).toBe(IDENTIFICATION_ID);
  });
});

describe('movePlant', () => {
  it('updates placement fields only and bumps the revision', () => {
    const plant = individualPlant();
    const moved = movePlant(
      plant,
      { gardenAreaMapObjectId: MAP_OBJECT_ID, placementMapObjectId: null },
      LATER,
    );

    expect(moved).toEqual({
      ...plant,
      gardenAreaMapObjectId: MAP_OBJECT_ID,
      placementMapObjectId: null,
      revision: 2,
      updatedAt: LATER,
    });
    expect(moved.gardenId).toBe(plant.gardenId);
  });
});
