import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  GARDEN_CONTEXT_KINDS,
  validateGardenContextFactInput,
  validateGardenContextFactProvenance,
  validateGardenContextFactValue,
} from './garden-context-fact.js';
import type { GardenContextFactValue } from './garden-context-fact.js';

describe('GARDEN_CONTEXT_KINDS', () => {
  it('names exactly the six kinds the migration CHECK constraint accepts', () => {
    expect([...GARDEN_CONTEXT_KINDS].sort()).toEqual(
      [
        'sun_exposure',
        'soil_type',
        'drainage',
        'irrigation_method',
        'growing_context',
        'microclimate',
      ].sort(),
    );
  });
});

describe('validateGardenContextFactValue', () => {
  describe('fixed-vocabulary kinds', () => {
    it.each([
      ['sun_exposure', 'full_sun'],
      ['sun_exposure', 'partial_sun'],
      ['sun_exposure', 'partial_shade'],
      ['sun_exposure', 'full_shade'],
      ['drainage', 'well_drained'],
      ['drainage', 'poor_drainage'],
      ['drainage', 'waterlogged'],
      ['irrigation_method', 'manual'],
      ['irrigation_method', 'drip'],
      ['irrigation_method', 'sprinkler'],
      ['irrigation_method', 'none'],
      ['growing_context', 'open_ground'],
      ['growing_context', 'container'],
      ['growing_context', 'greenhouse'],
    ] as const)('accepts %s value %s', (contextKind, value) => {
      const input = { contextKind, value } as GardenContextFactValue;
      expect(validateGardenContextFactValue(input)).toEqual(input);
    });

    it.each([
      ['sun_exposure', 'blazing'],
      ['drainage', 'soggy'],
      ['irrigation_method', 'hose'],
      ['growing_context', 'raisedBed'],
    ] as const)('rejects an unrecognized %s value %s', (contextKind, value) => {
      const input = { contextKind, value } as unknown as GardenContextFactValue;
      expect(() => validateGardenContextFactValue(input)).toThrow(ValidationError);
    });
  });

  describe('free-text kinds', () => {
    it.each(['soil_type', 'microclimate'] as const)(
      'accepts any non-blank text for %s',
      (contextKind) => {
        const input = { contextKind, value: 'Sandy loam, drains fast after rain.' } as const;
        expect(validateGardenContextFactValue(input)).toEqual(input);
      },
    );

    it.each(['soil_type', 'microclimate'] as const)('rejects a blank %s value', (contextKind) => {
      const input = { contextKind, value: '   ' } as const;
      expect(() => validateGardenContextFactValue(input)).toThrow(ValidationError);
    });
  });
});

describe('validateGardenContextFactProvenance', () => {
  it('accepts user_declared with neither reviewedBy nor reviewedOn', () => {
    expect(validateGardenContextFactProvenance({ source: 'user_declared' })).toEqual({
      source: 'user_declared',
    });
  });

  it('accepts imported with neither reviewedBy nor reviewedOn', () => {
    expect(validateGardenContextFactProvenance({ source: 'imported' })).toEqual({
      source: 'imported',
    });
  });

  it('accepts horticulturally_reviewed_default with both reviewedBy and reviewedOn', () => {
    expect(
      validateGardenContextFactProvenance({
        source: 'horticulturally_reviewed_default',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).toEqual({
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });
  });

  it('rejects an unrecognized source', () => {
    expect(() => validateGardenContextFactProvenance({ source: 'guessed' })).toThrow(
      ValidationError,
    );
  });

  it('rejects horticulturally_reviewed_default missing both reviewedBy and reviewedOn', () => {
    expect(() =>
      validateGardenContextFactProvenance({ source: 'horticulturally_reviewed_default' }),
    ).toThrow(ValidationError);
  });

  it('rejects horticulturally_reviewed_default missing only reviewedOn', () => {
    expect(() =>
      validateGardenContextFactProvenance({
        source: 'horticulturally_reviewed_default',
        reviewedBy: 'Dr. Amara Osei',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects horticulturally_reviewed_default missing only reviewedBy', () => {
    expect(() =>
      validateGardenContextFactProvenance({
        source: 'horticulturally_reviewed_default',
        reviewedOn: '2026-03-15',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects horticulturally_reviewed_default with a malformed reviewedOn', () => {
    expect(() =>
      validateGardenContextFactProvenance({
        source: 'horticulturally_reviewed_default',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: 'March 15th',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects user_declared carrying reviewedBy/reviewedOn', () => {
    expect(() =>
      validateGardenContextFactProvenance({
        source: 'user_declared',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects imported carrying reviewedBy/reviewedOn', () => {
    expect(() =>
      validateGardenContextFactProvenance({
        source: 'imported',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects reviewedBy supplied without reviewedOn, independent of source', () => {
    expect(() =>
      validateGardenContextFactProvenance({ source: 'user_declared', reviewedBy: 'Someone' }),
    ).toThrow(ValidationError);
  });

  it('rejects reviewedOn supplied without reviewedBy, independent of source', () => {
    expect(() =>
      validateGardenContextFactProvenance({ source: 'user_declared', reviewedOn: '2026-03-15' }),
    ).toThrow(ValidationError);
  });

  it('treats null reviewedBy/reviewedOn the same as omitted', () => {
    expect(
      validateGardenContextFactProvenance({
        source: 'user_declared',
        reviewedBy: null,
        reviewedOn: null,
      }),
    ).toEqual({ source: 'user_declared' });
  });
});

describe('validateGardenContextFactInput', () => {
  it('validates value and provenance together, returning the combined narrowed shape', () => {
    const result = validateGardenContextFactInput({
      contextKind: 'sun_exposure',
      value: 'full_sun',
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });

    expect(result).toEqual({
      contextKind: 'sun_exposure',
      value: 'full_sun',
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });
  });

  it('rejects an invalid value even when provenance is valid', () => {
    expect(() =>
      validateGardenContextFactInput({
        contextKind: 'drainage',
        value: 'soggy' as never,
        source: 'user_declared',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid provenance even when value is valid', () => {
    expect(() =>
      validateGardenContextFactInput({
        contextKind: 'drainage',
        value: 'well_drained',
        source: 'horticulturally_reviewed_default',
      }),
    ).toThrow(ValidationError);
  });
});
