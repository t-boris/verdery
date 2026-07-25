/**
 * Deterministic explanation rendering: the rule's versioned template plus
 * the eligible outcome's explanation facts produce the baseline text every
 * candidate carries — section 10's "Fallback deterministic text", except
 * that at this stage it is not a fallback but the ONLY explanation:
 * P7-AI-01's bounded embellishment arrives later and, per section 10, "If
 * generation fails, the deterministic explanation is shown."
 *
 * Rendering is total or loud: a placeholder with no matching fact is a
 * rule-implementation defect (the template promised a fact the evaluator
 * did not derive), so it throws rather than emitting a hole — an
 * explanation with an invented or absent value would violate section 4's
 * "Missing facts remain missing" at the text layer.
 *
 * Source: architecture/recommendations-and-ai.md, sections "5. Rule
 * Engine" ("Explanation facts") and "10. Explanation Generation".
 */

import { InternalError } from '../../../platform/errors/application-error.js';

const PLACEHOLDER_PATTERN = /\{([a-z0-9_.]+)\}/g;

/**
 * Renders `template`, substituting every `{placeholder}` with the matching
 * explanation fact. Throws `InternalError` on an unresolved placeholder —
 * see this file's header for why that is a defect, not a degradation.
 */
export function renderRuleExplanation(
  ruleKey: string,
  template: string,
  explanationFacts: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, factKey: string) => {
    const value = explanationFacts[factKey];
    if (value === undefined) {
      throw new InternalError(
        'tasks_recommendations.rule_explanation.unresolved_placeholder',
        `Rule '${ruleKey}' explanation template references fact '${factKey}', which its evaluator did not provide.`,
      );
    }
    return String(value);
  });
}

/** The placeholder names a template references, in order of appearance — used by catalog-level tests to keep templates and evaluators honest with each other. */
export function listExplanationPlaceholders(template: string): readonly string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] ?? '');
}
