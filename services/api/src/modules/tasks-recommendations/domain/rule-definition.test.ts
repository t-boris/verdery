import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { buildRuleDefinition } from './rule-engine-test-support.js';
import {
  EXCLUDED_RULE_CONTENT_CATEGORIES,
  normalizeContentCategory,
  requireAllowedContentCategory,
  validateFactorContribution,
  validateRuleDefinition,
} from './rule-definition.js';

describe('validateRuleDefinition', () => {
  it('accepts a well-formed definition and returns it unchanged', () => {
    const definition = buildRuleDefinition();
    expect(validateRuleDefinition(definition)).toBe(definition);
  });

  it('rejects every excluded content category, in any spelling', () => {
    for (const category of EXCLUDED_RULE_CONTENT_CATEGORIES) {
      for (const spelling of [
        category,
        category.toUpperCase(),
        category.replaceAll('_', '-'),
        category.replaceAll('_', ' '),
      ]) {
        expect(
          () => validateRuleDefinition(buildRuleDefinition({ careCategory: spelling })),
          `careCategory '${spelling}'`,
        ).toThrowError(ValidationError);
      }
    }
  });

  it('names section 13 restricted subjects and launch-excluded elevated-risk subjects in the exclusion list', () => {
    // Section 13 Restricted: chemical application, emergency,
    // legal-boundary, structural, electrical, medical — plus the phase
    // plan's own exclusions: toxicity, pest treatment, and their
    // elevated-risk siblings.
    expect(EXCLUDED_RULE_CONTENT_CATEGORIES).toEqual(
      expect.arrayContaining([
        'chemical_application',
        'emergency',
        'legal_boundary',
        'structural',
        'electrical',
        'medical',
        'toxicity',
        'pest_treatment',
        'disease_diagnosis',
        'fertilizer_concentration',
      ]),
    );
  });

  it('rejects non-positive or fractional timing windows', () => {
    for (const timing of [
      { validityWindowMs: 0, recurrenceIntervalMs: 1000 },
      { validityWindowMs: 1000, recurrenceIntervalMs: -1 },
      { validityWindowMs: 10.5, recurrenceIntervalMs: 1000 },
    ]) {
      expect(() => validateRuleDefinition(buildRuleDefinition({ timing }))).toThrowError(
        ValidationError,
      );
    }
  });

  it('rejects blank action title, description, or explanation template', () => {
    for (const overrides of [
      { actionTitle: '   ' },
      { description: '' },
      { explanationTemplate: '  ' },
    ]) {
      expect(() => validateRuleDefinition(buildRuleDefinition(overrides))).toThrowError(
        ValidationError,
      );
    }
  });

  it('rejects a definition requiring no evidence kinds', () => {
    expect(() =>
      validateRuleDefinition(buildRuleDefinition({ requiredEvidenceKinds: [] })),
    ).toThrowError(ValidationError);
  });

  it('rejects a blank or overlong rule key and a non-positive version', () => {
    expect(() => validateRuleDefinition(buildRuleDefinition({ ruleKey: '  ' }))).toThrowError(
      ValidationError,
    );
    expect(() => validateRuleDefinition(buildRuleDefinition({ version: 0 }))).toThrowError(
      ValidationError,
    );
  });
});

describe('normalizeContentCategory', () => {
  it('folds case, spaces, and hyphens into snake_case', () => {
    expect(normalizeContentCategory(' Pest Treatment ')).toBe('pest_treatment');
    expect(normalizeContentCategory('legal-boundary')).toBe('legal_boundary');
    expect(normalizeContentCategory('watering')).toBe('watering');
  });
});

describe('requireAllowedContentCategory', () => {
  it('accepts ordinary categories', () => {
    expect(() => requireAllowedContentCategory('test.rule', 'watering')).not.toThrow();
    expect(() => requireAllowedContentCategory('test.rule', 'observation')).not.toThrow();
  });
});

describe('validateFactorContribution', () => {
  it('accepts bounded integers, including negative penalties', () => {
    for (const contribution of [-100, -15, 0, 42, 100]) {
      expect(() =>
        validateFactorContribution('test.rule', {
          kind: 'confidence',
          contribution,
          basis: {},
        }),
      ).not.toThrow();
    }
  });

  it('rejects fractional or out-of-range contributions', () => {
    for (const contribution of [-101, 101, 0.5, Number.NaN]) {
      expect(() =>
        validateFactorContribution('test.rule', {
          kind: 'confidence',
          contribution,
          basis: {},
        }),
      ).toThrowError(ValidationError);
    }
  });
});
