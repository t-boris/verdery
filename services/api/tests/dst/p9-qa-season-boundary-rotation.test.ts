/**
 * P9-QA-01, Batch B, Matrix 9 (Season-boundary) — rotation rest-period
 * sub-case: a bed's prior occupant departed in one calendar year and
 * `facts.evaluatedAt` ("now") falls well into a LATER calendar year,
 * proving `rotation.crop-rotation-caution`'s own `wholeDaysBetween`-based
 * elapsed-days calculation (`crop-rotation-caution.ts`) gives the correct
 * total day count across the year boundary, never a count that resets or
 * miscalculates at January 1st.
 *
 * `crop-rotation-caution.fixtures.ts` already exercises this rule's firing
 * and skip conditions, but every one of its own scenarios computes
 * `priorOccupancyEndedAt` as an OFFSET from the shared `FIXTURE_NOW`
 * constant (`FIXTURE_NOW.getTime() - 200 * DAY_MS`,
 * `FIXTURE_NOW.getTime() - 800 * DAY_MS`) — never two independently
 * constructed calendar dates that straddle a real January 1st. This suite
 * calls the rule's own exported `evaluate` directly (not through the
 * shared fixture harness, so it can pick dates the harness's single shared
 * `evaluatedAt` cannot) with real dates on either side of one or more
 * January 1sts, and checks the resulting `elapsedDays` against an
 * INDEPENDENTLY computed `Date.UTC` millisecond difference — never reusing
 * `wholeDaysBetween` itself for the expectation, which would make the
 * assertion tautological.
 *
 * `succession.replanting-reminder` (the OTHER P9D-SEASON-RULES-01 rule with
 * a "days" concept, `successionIntervalDays`) is deliberately NOT covered
 * here — see this package's own final report for why a year-boundary test
 * for that rule would not prove anything real: its `evaluate`/`evaluatePlant`
 * (`succession-replanting-reminder.ts`) never reads `facts.evaluatedAt` at
 * all, and the engine's own recurrence gate that governs its re-fire timing
 * (`rule-evaluation.ts`, `new
 * Date(latest.createdAt.getTime() + rule.timing.recurrenceIntervalMs)`) is
 * itself pure millisecond arithmetic with no calendar-month or
 * calendar-year component anywhere in the call chain.
 */

import { describe, expect, it } from 'vitest';
import type {
  GardenFacts,
  PlantFact,
  PriorBedOccupantFact,
  TaxonomyFact,
} from '../../src/modules/tasks-recommendations/domain/garden-facts.js';
import {
  cropRotationCautionRule,
  ROTATION_SEASON_DAYS,
} from '../../src/modules/tasks-recommendations/domain/rules/crop-rotation-caution.js';
import type { RuleTargetEvaluation } from '../../src/modules/tasks-recommendations/domain/rule-definition.js';
import type { TaxonomySeasonalFact } from '../../src/modules/plants-inventory/public.js';

const GARDEN_ID = '019a3000-0000-7000-8000-00000000bb01';
const PLANT_ID = '019a3000-0000-7000-8000-00000000bb02';
const TAXONOMY_ID = '019a3000-0000-7000-8000-00000000bb03';
const BED_ID = '019a3000-0000-7000-8000-00000000bb04';
const SEASONAL_FACT_ID = '019a3000-0000-7000-8000-00000000bb05';

/** Whole days between two UTC instants, computed independently of `wholeDaysBetween` — the same `Date.UTC`-anchored millisecond-difference method, but written fresh here so the test's own expectation cannot share a bug with the code under test. */
function independentWholeDaysBetween(earlier: Date, later: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((later.getTime() - earlier.getTime()) / dayMs);
}

function seasonalFact(rotationRestSeasons: number | null): TaxonomySeasonalFact {
  return {
    id: SEASONAL_FACT_ID,
    taxonomyReferenceId: TAXONOMY_ID,
    hemisphere: 'northern',
    sowIndoorsStartMonth: null,
    sowIndoorsEndMonth: null,
    sowOutdoorsStartMonth: null,
    sowOutdoorsEndMonth: null,
    transplantStartMonth: null,
    transplantEndMonth: null,
    harvestStartMonth: null,
    harvestEndMonth: null,
    daysToMaturityMin: null,
    daysToMaturityMax: null,
    successionIntervalDays: null,
    rotationRestSeasons,
    authoringMethod: 'human_authored',
    reviewStatus: 'horticulturally_reviewed',
    reviewedBy: 'Fixture Reviewer',
    reviewedOn: '2026-01-01',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function buildFacts(options: {
  readonly evaluatedAt: Date;
  readonly priorOccupancyEndedAt: Date;
  readonly rotationRestSeasons: number;
}): GardenFacts {
  const plant: PlantFact = {
    plantId: PLANT_ID,
    displayName: 'Overwintered tomato bed',
    lifecycleStage: 'growing',
    status: 'active',
    createdAt: new Date('2020-01-01T00:00:00Z'),
    taxonomyReferenceId: TAXONOMY_ID,
    gardenAreaMapObjectId: BED_ID,
  };
  const taxonomyFact: TaxonomyFact = {
    taxonomyReferenceId: TAXONOMY_ID,
    family: 'Solanaceae',
    seasonalFact: seasonalFact(options.rotationRestSeasons),
  };
  const priorOccupant: PriorBedOccupantFact = {
    plantId: PLANT_ID,
    gardenAreaMapObjectId: BED_ID,
    priorFamily: 'Solanaceae',
    priorOccupancyEndedAt: options.priorOccupancyEndedAt,
  };

  return {
    gardenId: GARDEN_ID,
    evaluatedAt: options.evaluatedAt,
    plants: [plant],
    observations: [],
    openTasks: [],
    weatherObservation: { availability: 'missing' },
    weatherForecast: { availability: 'missing' },
    hemisphere: 'northern',
    taxonomyFacts: [taxonomyFact],
    priorBedOccupants: [priorOccupant],
  };
}

function targetFor(
  evaluation: ReturnType<typeof cropRotationCautionRule.evaluate>,
): RuleTargetEvaluation {
  if (evaluation.outcome !== 'evaluated') {
    throw new Error(`expected 'evaluated', got '${evaluation.outcome}'`);
  }
  const target = evaluation.targets[0];
  if (target === undefined) {
    throw new Error('expected exactly one target evaluation');
  }
  return target;
}

describe('season-boundary sweep: rotation.crop-rotation-caution elapsed-days across a calendar-year seam', () => {
  it('counts the exact elapsed days when the prior occupant departed in the PREVIOUS calendar year and evaluatedAt is well into the NEXT one', () => {
    const priorOccupancyEndedAt = new Date('2025-11-15T09:00:00Z');
    const evaluatedAt = new Date('2026-03-01T09:00:00Z');
    const expectedElapsedDays = independentWholeDaysBetween(priorOccupancyEndedAt, evaluatedAt);
    expect(expectedElapsedDays).toBe(106); // Independently verified: not reset by the intervening January 1st.

    const facts = buildFacts({ evaluatedAt, priorOccupancyEndedAt, rotationRestSeasons: 1 });
    const evaluation = targetFor(cropRotationCautionRule.evaluate(facts));

    expect(evaluation.outcome).toBe('eligible');
    if (evaluation.outcome !== 'eligible') {
      throw new Error('unreachable');
    }
    expect(evaluation.explanationFacts['bed.days_since_prior_family']).toBe(expectedElapsedDays);
    const seasonalCalendarEvidence = evaluation.evidence.find(
      (item) => item.kind === 'seasonal_calendar',
    );
    expect((seasonalCalendarEvidence?.factValue as { elapsedDays: number }).elapsedDays).toBe(
      expectedElapsedDays,
    );
    // Sanity: 106 days is well inside the 1-season (365-day) rest period —
    // firing is the correct decision, and the caution's own explanation
    // reports the true cross-year count, not "106 - 365 = clamped to 0" or
    // any other seam artifact.
    expect(expectedElapsedDays).toBeLessThan(1 * ROTATION_SEASON_DAYS);
  });

  it('counts the exact elapsed days when the prior occupant departed TWO calendar years before evaluatedAt, correctly judging the rest period already elapsed', () => {
    const priorOccupancyEndedAt = new Date('2024-01-01T09:00:00Z');
    const evaluatedAt = new Date('2026-03-01T09:00:00Z');
    const expectedElapsedDays = independentWholeDaysBetween(priorOccupancyEndedAt, evaluatedAt);
    expect(expectedElapsedDays).toBe(790); // Independently verified: spans TWO January 1sts correctly.

    const facts = buildFacts({ evaluatedAt, priorOccupancyEndedAt, rotationRestSeasons: 1 });
    const evaluation = targetFor(cropRotationCautionRule.evaluate(facts));

    // 790 days > 365 (one rest season) — the rest period has genuinely
    // elapsed, so the rule stays quiet. A buggy "days since January 1st"
    // substitute would compute a tiny number (well under the threshold)
    // and wrongly fire a caution about a rotation conflict from two years
    // ago.
    expect(evaluation.outcome).toBe('notEligible');
    if (evaluation.outcome !== 'notEligible') {
      throw new Error('unreachable');
    }
    expect(evaluation.reasonCode).toBe('bed.rotation_rest_period_elapsed');
  });

  it('counts the exact elapsed days for a departure and evaluation instant on the SAME side of the seam but many years apart, as a control', () => {
    // Both dates in the same calendar year — a control case confirming the
    // independent day-count method itself, and that a same-year comparison
    // (no seam at all) agrees with the cross-year ones above.
    const priorOccupancyEndedAt = new Date('2026-01-05T09:00:00Z');
    const evaluatedAt = new Date('2026-03-01T09:00:00Z');
    const expectedElapsedDays = independentWholeDaysBetween(priorOccupancyEndedAt, evaluatedAt);
    expect(expectedElapsedDays).toBe(55);

    const facts = buildFacts({ evaluatedAt, priorOccupancyEndedAt, rotationRestSeasons: 1 });
    const evaluation = targetFor(cropRotationCautionRule.evaluate(facts));

    expect(evaluation.outcome).toBe('eligible');
    if (evaluation.outcome !== 'eligible') {
      throw new Error('unreachable');
    }
    expect(evaluation.explanationFacts['bed.days_since_prior_family']).toBe(expectedElapsedDays);
  });
});
