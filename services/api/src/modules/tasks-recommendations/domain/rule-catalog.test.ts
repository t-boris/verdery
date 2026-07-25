import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { buildRuleDefinition } from './rule-engine-test-support.js';
import { RuleCatalog } from './rule-catalog.js';

describe('RuleCatalog', () => {
  it('rejects two definitions with the same key and version', () => {
    expect(() => new RuleCatalog([buildRuleDefinition(), buildRuleDefinition()])).toThrowError(
      ValidationError,
    );
  });

  it('validates every definition at construction', () => {
    expect(
      () => new RuleCatalog([buildRuleDefinition({ careCategory: 'pest_treatment' })]),
    ).toThrowError(ValidationError);
  });

  it('keeps every shipped version findable while only the latest is active', () => {
    const v1 = buildRuleDefinition({ version: 1 });
    const v2 = buildRuleDefinition({ version: 2 });
    const other = buildRuleDefinition({ ruleKey: 'other.rule' });
    const catalog = new RuleCatalog([v1, v2, other]);

    expect(catalog.allVersions()).toEqual([v1, v2, other]);
    expect(catalog.activeRules()).toEqual([v2, other]);
    expect(catalog.find('test.rule', 1)).toBe(v1);
    expect(catalog.find('test.rule', 2)).toBe(v2);
    expect(catalog.find('test.rule', 3)).toBeNull();
    expect(catalog.find('unknown.rule', 1)).toBeNull();
  });

  it('activates the highest version regardless of declaration order', () => {
    const v1 = buildRuleDefinition({ version: 1 });
    const v2 = buildRuleDefinition({ version: 2 });
    expect(new RuleCatalog([v2, v1]).activeRules()).toEqual([v2]);
  });
});
