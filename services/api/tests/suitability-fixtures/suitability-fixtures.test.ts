/**
 * The fixture runner: every fixture's constructed garden/candidate goes
 * through the REAL pure engine, but against a catalog containing ONLY the
 * one rule its own file is named for — not the full three-rule catalog.
 * This deviates deliberately from `tests/rule-fixtures/rule-fixtures.test.ts`
 * (which always runs the full recommendation catalog, because duplicate
 * suppression genuinely depends on every rule's combined output): these
 * three suitability axes are fully independent, with no cross-rule
 * suppression or shared state, so pinning "the other two rules also
 * produced their own unrelated `unknown` finding" in every single-axis
 * fixture would be pure restatement, not real coverage. The full-catalog
 * concatenation behavior (multiple rules' findings combining into one
 * result) is covered once, directly, in
 * `../../src/modules/plants-inventory/domain/evaluate-candidate-suitability.test.ts`.
 *
 * A second pass per fixture proves determinism.
 *
 * See README.md in this directory for review status and protocol.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateCandidateSuitability,
  SuitabilityRuleCatalog,
} from '../../src/modules/plants-inventory/public.js';
import type { SuitabilityRuleDefinition } from '../../src/modules/plants-inventory/public.js';
import type { SuitabilityFixture } from './fixture-support.js';
import { DRAINAGE_COMPATIBILITY_RULE } from '../../src/modules/plants-inventory/domain/suitability-rules/drainage-compatibility.js';
import { REGULATORY_STATUS_RULE } from '../../src/modules/plants-inventory/domain/suitability-rules/regulatory-status.js';
import { SUN_EXPOSURE_COMPATIBILITY_RULE } from '../../src/modules/plants-inventory/domain/suitability-rules/sun-exposure-compatibility.js';
import { drainageCompatibilityFixtures } from './drainage-compatibility.fixtures.js';
import { regulatoryStatusFixtures } from './regulatory-status.fixtures.js';
import { sunExposureCompatibilityFixtures } from './sun-exposure-compatibility.fixtures.js';

const FIXTURE_GROUPS: readonly (readonly [
  string,
  SuitabilityRuleDefinition,
  readonly SuitabilityFixture[],
])[] = [
  [
    'suitability.sun_exposure_compatibility',
    SUN_EXPOSURE_COMPATIBILITY_RULE,
    sunExposureCompatibilityFixtures,
  ],
  [
    'suitability.drainage_compatibility',
    DRAINAGE_COMPATIBILITY_RULE,
    drainageCompatibilityFixtures,
  ],
  ['suitability.regulatory_status', REGULATORY_STATUS_RULE, regulatoryStatusFixtures],
];

for (const [groupName, rule, fixtures] of FIXTURE_GROUPS) {
  describe(`suitability fixtures — ${groupName}`, () => {
    const catalog = new SuitabilityRuleCatalog([rule]);

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        const result = evaluateCandidateSuitability(
          fixture.candidate.candidateId,
          catalog.activeRules(),
          fixture.garden,
          fixture.candidate,
        );
        expect(result).toEqual(fixture.expected);

        // Determinism: identical inputs produce a deeply equal result.
        expect(
          evaluateCandidateSuitability(
            fixture.candidate.candidateId,
            catalog.activeRules(),
            fixture.garden,
            fixture.candidate,
          ),
        ).toEqual(result);
      });
    }
  });
}
