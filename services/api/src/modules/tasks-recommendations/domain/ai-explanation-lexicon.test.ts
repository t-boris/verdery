/**
 * Alignment tests between the two structural safety lists (P7-SAFE-01):
 * the rule layer's `EXCLUDED_RULE_CONTENT_CATEGORIES` (no rule may
 * declare these subjects) and the AI layer's `PROHIBITED_CATEGORIES`
 * (no embellishment may speak their vocabulary). Both lists enforce ONE
 * policy — recommendations-and-ai.md section 13's excluded subjects —
 * at two different boundaries, so they must not drift apart: a new
 * rule-layer exclusion without lexicon coverage would let generated
 * text discuss a subject no rule may recommend, and a lexicon category
 * without a rule-layer counterpart would reject vocabulary for a
 * subject rules could still declare.
 *
 * THE ONE DELIBERATE DIVERGENCE, pinned by `COVERING_LEXICON_CATEGORY`
 * below and documented in
 * docs/development/recommendation-safety-catalog.md: `toxicity` has no
 * lexicon entry of its own. In both product languages, the words for
 * "this plant is toxic" (toxic, poisonous, яд, ядовит, токсич) ARE the
 * `medical` entry's term set — plant-toxicity guidance and
 * poisoning-related medical guidance share one vocabulary — so a
 * separate `toxicity` entry would duplicate the same stems under a
 * second id without rejecting a single additional draft. The mapping
 * documents the merge; the matcher test below PROVES it still holds.
 */

import { describe, expect, it } from 'vitest';
import { findProhibitedCategory, PROHIBITED_CATEGORIES } from './ai-explanation-lexicon.js';
import { EXCLUDED_RULE_CONTENT_CATEGORIES } from './rule-definition.js';

/**
 * Which prohibited lexicon category rejects each excluded rule
 * category's vocabulary. Identity for every category except `toxicity`
 * (see the file header). Extending `EXCLUDED_RULE_CONTENT_CATEGORIES`
 * without extending this map — and the lexicon behind it — fails the
 * covering test below by construction.
 */
const COVERING_LEXICON_CATEGORY: Readonly<Record<string, string>> = {
  chemical_application: 'chemical_application',
  disease_diagnosis: 'disease_diagnosis',
  electrical: 'electrical',
  emergency: 'emergency',
  fertilizer_concentration: 'fertilizer_concentration',
  legal_boundary: 'legal_boundary',
  medical: 'medical',
  pest_treatment: 'pest_treatment',
  structural: 'structural',
  toxicity: 'medical',
};

describe('safety-list alignment (rule layer vs AI lexicon)', () => {
  const lexiconIds = new Set(PROHIBITED_CATEGORIES.map((category) => category.id));

  it('covers every excluded rule content category with a prohibited lexicon category', () => {
    expect(Object.keys(COVERING_LEXICON_CATEGORY).sort()).toEqual(
      [...EXCLUDED_RULE_CONTENT_CATEGORIES].sort(),
    );
    for (const [ruleCategory, lexiconCategory] of Object.entries(COVERING_LEXICON_CATEGORY)) {
      expect(lexiconIds.has(lexiconCategory), `'${ruleCategory}' → '${lexiconCategory}'`).toBe(
        true,
      );
    }
  });

  it('names no prohibited lexicon category outside the rule-layer exclusion list', () => {
    for (const id of lexiconIds) {
      expect(EXCLUDED_RULE_CONTENT_CATEGORIES, `lexicon category '${id}'`).toContain(id);
    }
  });

  it('proves the toxicity → medical merge: toxicity vocabulary is rejected in both languages', () => {
    for (const text of [
      'The berries of this plant are toxic to pets.',
      'Its sap is poisonous if ingested.',
      'Ягоды этого растения ядовиты для животных.',
      'Сок растения токсичен при попадании на кожу.',
    ]) {
      expect(findProhibitedCategory(text), text).toBe('medical');
    }
  });

  it('carries vocabulary in BOTH product languages for every prohibited category', () => {
    for (const category of PROHIBITED_CATEGORIES) {
      expect(
        category.en.stems.length + category.en.words.length,
        `'${category.id}' has no English terms`,
      ).toBeGreaterThan(0);
      expect(
        category.ru.stems.length + category.ru.words.length,
        `'${category.id}' has no Russian terms`,
      ).toBeGreaterThan(0);
    }
  });
});
