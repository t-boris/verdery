import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import { listExplanationPlaceholders, renderRuleExplanation } from './rule-explanation.js';

describe('renderRuleExplanation', () => {
  it('substitutes string and numeric facts deterministically', () => {
    const rendered = renderRuleExplanation(
      'test.rule',
      '{plant.display_name} has not been observed for {plant.days} days.',
      { 'plant.display_name': 'Cherry tomato', 'plant.days': 16 },
    );
    expect(rendered).toBe('Cherry tomato has not been observed for 16 days.');
  });

  it('renders the same text for the same inputs, every time', () => {
    const facts = { 'weather.temperature_celsius': 26.5 } as const;
    const template = 'It is {weather.temperature_celsius} °C.';
    expect(renderRuleExplanation('test.rule', template, facts)).toBe(
      renderRuleExplanation('test.rule', template, facts),
    );
  });

  it('throws loudly on a placeholder the evaluator did not provide', () => {
    expect(() => renderRuleExplanation('test.rule', 'Missing {some.fact}.', {})).toThrowError(
      InternalError,
    );
  });

  it('leaves a template without placeholders untouched', () => {
    expect(renderRuleExplanation('test.rule', 'No placeholders here.', {})).toBe(
      'No placeholders here.',
    );
  });
});

describe('listExplanationPlaceholders', () => {
  it('lists placeholder names in order of appearance', () => {
    expect(listExplanationPlaceholders('{a.b} then {c.d_e} then {a.b} again')).toEqual([
      'a.b',
      'c.d_e',
      'a.b',
    ]);
  });

  it('returns empty for a placeholder-free template', () => {
    expect(listExplanationPlaceholders('plain text')).toEqual([]);
  });
});
