import { describe, expect, it } from 'vitest';

import {
  GARDEN_CONTEXT_KINDS,
  canEditGardenContent,
  contextKindLabel,
  contextSourceLabel,
  contextValueLabel,
  contextValueOptions,
} from './labels';

describe('GARDEN_CONTEXT_KINDS', () => {
  it('lists every context kind exactly once', () => {
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

describe('contextKindLabel / contextSourceLabel', () => {
  it('gives every kind and source a distinct catalogue key', () => {
    const kindKeys = GARDEN_CONTEXT_KINDS.map(contextKindLabel);
    expect(new Set(kindKeys).size).toBe(GARDEN_CONTEXT_KINDS.length);

    const sourceKeys = ['user_declared', 'horticulturally_reviewed_default', 'imported'].map(
      (source) => contextSourceLabel(source as never),
    );
    expect(new Set(sourceKeys).size).toBe(3);
  });
});

describe('contextValueOptions', () => {
  it('returns a fixed vocabulary for the four enumerated kinds', () => {
    expect(contextValueOptions('sun_exposure')?.map((option) => option.value)).toEqual([
      'full_sun',
      'partial_sun',
      'partial_shade',
      'full_shade',
    ]);
    expect(contextValueOptions('drainage')?.map((option) => option.value)).toEqual([
      'well_drained',
      'poor_drainage',
      'waterlogged',
    ]);
    expect(contextValueOptions('irrigation_method')?.map((option) => option.value)).toEqual([
      'manual',
      'drip',
      'sprinkler',
      'none',
    ]);
    expect(contextValueOptions('growing_context')?.map((option) => option.value)).toEqual([
      'open_ground',
      'container',
      'greenhouse',
    ]);
  });

  it('returns null for the two free-text kinds', () => {
    expect(contextValueOptions('soil_type')).toBeNull();
    expect(contextValueOptions('microclimate')).toBeNull();
  });
});

describe('contextValueLabel', () => {
  it('resolves a recognized enum value', () => {
    expect(contextValueLabel('sun_exposure', 'full_sun')).toBe(
      'contextQuality.enum.sunExposure.fullSun',
    );
  });

  it('returns null for free text and for an unrecognized value', () => {
    expect(contextValueLabel('soil_type', 'sandy loam')).toBeNull();
    expect(contextValueLabel('sun_exposure', 'not-a-real-value')).toBeNull();
  });
});

describe('canEditGardenContent', () => {
  it('allows an owner or editor', () => {
    expect(canEditGardenContent('owner')).toBe(true);
    expect(canEditGardenContent('editor')).toBe(true);
  });

  it('denies a viewer', () => {
    expect(canEditGardenContent('viewer')).toBe(false);
  });
});
