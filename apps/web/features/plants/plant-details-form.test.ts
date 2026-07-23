import { describe, expect, it } from 'vitest';

import { editPlantSchema } from './plant-details-form';

const baseValues = {
  displayName: 'Tomato',
  varietyLabel: '',
  acquisitionDate: '',
  acquisitionDateType: '',
  conditionNote: '',
  careGuidanceNote: '',
};

describe('editPlantSchema', () => {
  it('requires a positive integer for a row or group', () => {
    const schema = editPlantSchema('row');

    expect(schema.safeParse({ ...baseValues, quantity: '' }).success).toBe(false);
    expect(schema.safeParse({ ...baseValues, quantity: '1.5' }).success).toBe(false);
    expect(schema.safeParse({ ...baseValues, quantity: '3' }).success).toBe(true);
  });

  it('allows an individual plant to omit quantity', () => {
    expect(editPlantSchema('individual').safeParse({ ...baseValues, quantity: '' }).success).toBe(
      true,
    );
  });
});
