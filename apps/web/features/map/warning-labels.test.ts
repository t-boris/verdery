import { describe, expect, it } from 'vitest';

import { severityLabelKey, warningMessageFor } from './warning-labels';

describe('warningMessageFor', () => {
  it('resolves the one code this codebase already cross-references (the iOS gateway fixture)', () => {
    expect(warningMessageFor('geometry.polygon.below_minimum_area')).toEqual({
      key: 'map.warnings.code.belowMinimumArea',
    });
  });

  it('falls back to a generic message carrying the raw code for an unrecognized code', () => {
    expect(warningMessageFor('geometry.objects.some_future_rule')).toEqual({
      key: 'map.warnings.code.fallback',
      args: { code: 'geometry.objects.some_future_rule' },
    });
  });
});

describe('severityLabelKey', () => {
  it('gives error and warning distinct message keys', () => {
    const errorKey = severityLabelKey('error');
    const warningKey = severityLabelKey('warning');
    expect(errorKey).toBe('map.warnings.severityError');
    expect(warningKey).toBe('map.warnings.severityWarning');
    expect(errorKey).not.toBe(warningKey);
  });
});
