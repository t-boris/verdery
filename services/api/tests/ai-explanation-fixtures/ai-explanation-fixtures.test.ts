/**
 * The bilingual AI-explanation evaluation harness (P7-AI-01) — the
 * versioned evaluation dataset of recommendations-and-ai.md section 16,
 * runnable: every fixture drives one constructed model draft through the
 * REAL `validateAiExplanationDraft` against one launch rule's REAL
 * baseline and pins the FULL verdict with deep equality. See README.md
 * for the section-16 mapping and what the human evaluation pass adds.
 */

import { describe, expect, it } from 'vitest';
import { validateAiExplanationDraft } from '../../src/modules/tasks-recommendations/public.js';
import type { AiExplanationFixture } from './fixture-support.js';
import { lifecycleHarvestReadinessCheckAiFixtures } from './lifecycle-harvest-readiness-check.fixtures.js';
import { observationRoutineCheckReminderAiFixtures } from './observation-routine-check-reminder.fixtures.js';
import { wateringDrySpellCheckAiFixtures } from './watering-dry-spell-check.fixtures.js';
import { weatherFrostWatchAiFixtures } from './weather-frost-watch.fixtures.js';

const suites: readonly [string, readonly AiExplanationFixture[]][] = [
  ['watering.dry-spell-check v1', wateringDrySpellCheckAiFixtures],
  ['observation.routine-check-reminder v1', observationRoutineCheckReminderAiFixtures],
  ['lifecycle.harvest-readiness-check v1', lifecycleHarvestReadinessCheckAiFixtures],
  ['weather.frost-watch v1', weatherFrostWatchAiFixtures],
];

describe('AI explanation evaluation fixtures', () => {
  for (const [ruleName, fixtures] of suites) {
    describe(ruleName, () => {
      for (const item of fixtures) {
        it(item.name, () => {
          expect(validateAiExplanationDraft(item.input)).toEqual(item.expected);
        });
      }
    });
  }

  it('every launch rule is evaluated in BOTH product languages, accepted and rejected cases alike', () => {
    for (const [ruleName, fixtures] of suites) {
      for (const language of ['en', 'ru'] as const) {
        const inLanguage = fixtures.filter((item) => item.draftLanguage === language);
        expect(inLanguage.length, `${ruleName} has no ${language} cases`).toBeGreaterThan(0);
        expect(
          inLanguage.some((item) => item.expected.verdict === 'accepted'),
          `${ruleName} has no accepted ${language} case`,
        ).toBe(true);
        expect(
          inLanguage.some((item) => item.expected.verdict !== 'accepted'),
          `${ruleName} has no rejected ${language} case`,
        ).toBe(true);
      }
    }
  });
});
