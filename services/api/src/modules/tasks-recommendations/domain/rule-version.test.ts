import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createRuleVersion, validateRuleKey, validateRuleVersionNumber } from './rule-version.js';

const NOW = new Date('2026-07-24T12:00:00Z');
const RULE_VERSION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b01';

describe('validateRuleKey', () => {
  it('trims surrounding whitespace', () => {
    expect(validateRuleKey('  watering.container.summer  ')).toBe('watering.container.summer');
  });

  it('rejects a blank key, including an all-spaces one the migration CHECK would accept', () => {
    expect(() => validateRuleKey('')).toThrow(ValidationError);
    expect(() => validateRuleKey('   ')).toThrow(ValidationError);
  });

  it('rejects a key longer than 200 characters', () => {
    expect(() => validateRuleKey('k'.repeat(201))).toThrow(ValidationError);
    expect(validateRuleKey('k'.repeat(200))).toBe('k'.repeat(200));
  });
});

describe('validateRuleVersionNumber', () => {
  it('accepts a positive integer', () => {
    expect(validateRuleVersionNumber(1)).toBe(1);
    expect(validateRuleVersionNumber(42)).toBe(42);
  });

  it('rejects zero, negatives, and non-integers, mirroring rule_version_version_positive_check', () => {
    expect(() => validateRuleVersionNumber(0)).toThrow(ValidationError);
    expect(() => validateRuleVersionNumber(-1)).toThrow(ValidationError);
    expect(() => validateRuleVersionNumber(1.5)).toThrow(ValidationError);
  });
});

describe('createRuleVersion', () => {
  it('creates an immutable identity row carrying its safety tier', () => {
    const ruleVersion = createRuleVersion({
      id: RULE_VERSION_ID,
      rawRuleKey: 'watering.container.summer',
      rawVersion: 3,
      safetyTier: 'ordinary_care',
      now: NOW,
    });

    expect(ruleVersion).toEqual({
      id: RULE_VERSION_ID,
      ruleKey: 'watering.container.summer',
      version: 3,
      safetyTier: 'ordinary_care',
      createdAt: NOW,
    });
  });

  it('accepts a restricted tier — the identity row may exist; only candidate GENERATION from it is excluded', () => {
    const ruleVersion = createRuleVersion({
      id: RULE_VERSION_ID,
      rawRuleKey: 'chemical.application',
      rawVersion: 1,
      safetyTier: 'restricted',
      now: NOW,
    });
    expect(ruleVersion.safetyTier).toBe('restricted');
  });

  it('rejects a blank key or non-positive version at construction', () => {
    expect(() =>
      createRuleVersion({
        id: RULE_VERSION_ID,
        rawRuleKey: ' ',
        rawVersion: 1,
        safetyTier: 'ordinary_care',
        now: NOW,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createRuleVersion({
        id: RULE_VERSION_ID,
        rawRuleKey: 'watering.container.summer',
        rawVersion: 0,
        safetyTier: 'ordinary_care',
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });
});
