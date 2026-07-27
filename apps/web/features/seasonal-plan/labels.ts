import type {
  PlantListResult,
  SeasonalPlanRotationStatusEntry,
  SeasonalPlanTaxonomyTiming,
} from '@verdery/api-contracts';

import {
  formatMonthName,
  type Locale,
  type MessageArguments,
  type MessageKey,
} from '@/shared/localization/public';

/** One rendered timing row: a window label and the range text to interpolate under it. */
export interface TimingRow {
  readonly labelKey: MessageKey;
  readonly rangeKey: MessageKey;
  readonly rangeArgs: MessageArguments;
}

/**
 * Renders one start/end month pair as the range key when both bounds are
 * set, the single-month key when only one is (an asymmetric configuration
 * the schema allows but a reviewed fact is not expected to produce in
 * practice), or `null` when neither is set — never a fabricated window.
 */
function monthWindow(
  startMonth: number | null,
  endMonth: number | null,
  locale: Locale,
): { readonly key: MessageKey; readonly args: MessageArguments } | null {
  if (startMonth === null && endMonth === null) {
    return null;
  }
  if (startMonth !== null && endMonth !== null) {
    return {
      key: 'seasonalPlan.calendar.monthRange',
      args: { start: formatMonthName(startMonth, locale), end: formatMonthName(endMonth, locale) },
    };
  }
  const month = startMonth ?? endMonth;
  // `??` above already narrows away the `both null` case handled first, so
  // `month` is a number here — kept as a runtime fallback rather than a
  // non-null assertion, matching this codebase's own "honest typed skip"
  // posture (`get-garden-seasonal-plan.ts`) instead of asserting past the
  // type checker.
  return {
    key: 'seasonalPlan.calendar.singleMonth',
    args: { month: month === null ? '' : formatMonthName(month, locale) },
  };
}

/**
 * Every configured window on a reviewed seasonal fact, as rows ready to
 * render — the raw `1`-`12` integers `SeasonalPlanTaxonomyTiming` carries
 * are never handed to a component; only the resolved month name is.
 * Omits a window entirely when both its bounds are null, so a plant with
 * only, say, a harvest window shows exactly that one row.
 */
export function timingRows(
  timing: SeasonalPlanTaxonomyTiming,
  locale: Locale,
): readonly TimingRow[] {
  const candidates: readonly [MessageKey, number | null, number | null][] = [
    [
      'seasonalPlan.calendar.sowIndoorsLabel',
      timing.sowIndoorsStartMonth,
      timing.sowIndoorsEndMonth,
    ],
    [
      'seasonalPlan.calendar.sowOutdoorsLabel',
      timing.sowOutdoorsStartMonth,
      timing.sowOutdoorsEndMonth,
    ],
    [
      'seasonalPlan.calendar.transplantLabel',
      timing.transplantStartMonth,
      timing.transplantEndMonth,
    ],
    ['seasonalPlan.calendar.harvestLabel', timing.harvestStartMonth, timing.harvestEndMonth],
  ];

  const rows: TimingRow[] = [];
  for (const [labelKey, start, end] of candidates) {
    const window = monthWindow(start, end, locale);
    if (window !== null) {
      rows.push({ labelKey, rangeKey: window.key, rangeArgs: window.args });
    }
  }
  return rows;
}

/** `plantId -> displayName`, built once per render from the active-plants lookup page. */
export type PlantNameLookup = ReadonlyMap<string, string>;

export function plantNameLookup(plants: PlantListResult | undefined): PlantNameLookup {
  return new Map((plants?.items ?? []).map((plant) => [plant.id, plant.displayName]));
}

/** The plant's own name when the lookup has it, or the honest `plantId` fallback otherwise. */
export function resolvedPlantName(lookup: PlantNameLookup, plantId: string): string | null {
  return lookup.get(plantId) ?? null;
}

/** One line describing a rotation-status entry, ready for `t(description.key, description.args)`. */
export interface RotationEntryDescription {
  readonly key: MessageKey;
  readonly args: MessageArguments;
}

/**
 * Classifies one `SeasonalPlanRotationStatusEntry` into the exact sentence
 * that describes it — never a generic "no conflict" catch-all, so a member
 * reading the non-alarmed list can still see WHY each bed is fine (no prior
 * occupant on record, a different family, no configured rest period, an
 * unknown departure date, or a rest period that has already elapsed).
 *
 * The `withinRestPeriod: true` branch trusts the contract's own guarantee
 * (`SeasonalPlanRotationStatusEntry.withinRestPeriod`'s doc comment: true
 * only when `priorFamily` matches, a threshold is configured, and
 * `elapsedDays` is below it) rather than re-deriving it — the `??` fallbacks
 * there are unreachable in practice, kept only so a malformed response
 * degrades to `0` instead of throwing.
 */
export function describeRotationEntry(
  entry: SeasonalPlanRotationStatusEntry,
): RotationEntryDescription {
  if (entry.withinRestPeriod) {
    return {
      key: 'seasonalPlan.rotation.conflictText',
      args: {
        family: entry.family,
        priorFamily: entry.priorFamily ?? '',
        elapsedDays: entry.elapsedDays ?? 0,
        restPeriodThresholdDays: entry.restPeriodThresholdDays ?? 0,
      },
    };
  }

  if (entry.priorFamily === null) {
    return { key: 'seasonalPlan.rotation.noPriorOccupant', args: { family: entry.family } };
  }

  if (entry.priorFamily !== entry.family) {
    return {
      key: 'seasonalPlan.rotation.differentFamily',
      args: { family: entry.family, priorFamily: entry.priorFamily },
    };
  }

  if (entry.elapsedDays === null) {
    return {
      key: 'seasonalPlan.rotation.restDurationUnknown',
      args: { family: entry.family, priorFamily: entry.priorFamily },
    };
  }

  if (entry.restPeriodThresholdDays === null) {
    return {
      key: 'seasonalPlan.rotation.noRestPeriodConfigured',
      args: {
        family: entry.family,
        priorFamily: entry.priorFamily,
        elapsedDays: entry.elapsedDays,
      },
    };
  }

  return {
    key: 'seasonalPlan.rotation.restPeriodElapsed',
    args: {
      family: entry.family,
      priorFamily: entry.priorFamily,
      elapsedDays: entry.elapsedDays,
      restPeriodThresholdDays: entry.restPeriodThresholdDays,
    },
  };
}
