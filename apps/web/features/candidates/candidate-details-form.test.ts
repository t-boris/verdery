import { describe, expect, it } from 'vitest';

import { editCandidateSchema } from './candidate-details-form';

const baseValues = {
  displayName: 'Fig tree',
  varietyLabel: '',
  rationaleNote: '',
  priority: '',
  priceAmount: '',
  priceCurrency: '',
  purchaseSource: '',
};

describe('editCandidateSchema', () => {
  it('requires a positive integer for a row or group', () => {
    const schema = editCandidateSchema('row');

    expect(schema.safeParse({ ...baseValues, quantity: '' }).success).toBe(false);
    expect(schema.safeParse({ ...baseValues, quantity: '1.5' }).success).toBe(false);
    expect(schema.safeParse({ ...baseValues, quantity: '3' }).success).toBe(true);
  });

  it('allows an individual plant to omit quantity', () => {
    expect(
      editCandidateSchema('individual').safeParse({ ...baseValues, quantity: '' }).success,
    ).toBe(true);
  });
});
