/**
 * The fixture runner: every fixture's constructed garden goes through the
 * REAL launch catalog and the REAL pure engine, and the ENTIRE evaluation
 * plan is asserted with deep equality — decisions, candidates, evidence,
 * factors, windows, and rendered explanations, exactly. A second pass per
 * fixture proves determinism (same inputs, deeply equal output).
 *
 * See README.md in this directory for what these fixtures are, their
 * review status (AWAITING horticultural review, P7-SAFE-01), and how a
 * human reviewer reads and signs off on them.
 */

import { describe, expect, it } from 'vitest';
import {
  createLaunchRuleCatalog,
  evaluateGardenRules,
} from '../../src/modules/tasks-recommendations/public.js';
import type { RuleFixture } from './fixture-support.js';
import { crossRuleFixtures } from './cross-rule.fixtures.js';
import { lifecycleHarvestReadinessCheckFixtures } from './lifecycle-harvest-readiness-check.fixtures.js';
import { observationRoutineCheckReminderFixtures } from './observation-routine-check-reminder.fixtures.js';
import { wateringDrySpellCheckFixtures } from './watering-dry-spell-check.fixtures.js';
import { weatherFrostWatchFixtures } from './weather-frost-watch.fixtures.js';

const FIXTURE_GROUPS: readonly (readonly [string, readonly RuleFixture[]])[] = [
  ['watering.dry-spell-check', wateringDrySpellCheckFixtures],
  ['observation.routine-check-reminder', observationRoutineCheckReminderFixtures],
  ['lifecycle.harvest-readiness-check', lifecycleHarvestReadinessCheckFixtures],
  ['weather.frost-watch', weatherFrostWatchFixtures],
  ['cross-rule', crossRuleFixtures],
];

const catalog = createLaunchRuleCatalog();

for (const [groupName, fixtures] of FIXTURE_GROUPS) {
  describe(`rule fixtures — ${groupName}`, () => {
    for (const fixture of fixtures) {
      it(fixture.name, () => {
        const plan = evaluateGardenRules(catalog, fixture.facts, fixture.prior);
        expect(plan).toEqual(fixture.expected);

        if (fixture.expectedPriorityOrder !== undefined) {
          const byDescendingScore = [...plan.plannedCandidates]
            .sort((a, b) => b.priorityScore - a.priorityScore)
            .map((candidate) => candidate.ruleKey);
          expect(byDescendingScore).toEqual(fixture.expectedPriorityOrder);
        }

        // Determinism: the identical inputs produce a deeply equal plan.
        expect(evaluateGardenRules(catalog, fixture.facts, fixture.prior)).toEqual(plan);
      });
    }
  });
}
