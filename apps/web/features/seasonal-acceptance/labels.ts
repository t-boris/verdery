import type { SeasonalPlanTaxonomyTiming } from '@verdery/api-contracts';

import {
  formatMonthName,
  type Locale,
  type MessageArguments,
  type MessageKey,
} from '@/shared/localization/public';

/**
 * One rendered timing row: a window label and the range text under it.
 *
 * DUPLICATED FROM `features/seasonal-plan/labels.ts`, deliberately.
 * "Features import public Core and Shared interfaces only ... a small hook
 * duplicated across features is preferred to a cross-feature import"
 * (architecture/web-application-design.md, section 20), the same rule
 * `features/garden-context/queries.ts` follows for `useCallerRole`.
 *
 * What is NOT duplicated is the wording: both features resolve the SAME
 * `seasonalPlan.calendar.*` message keys out of the shared catalogue, so
 * the months a person accepts here are labelled exactly as they will read
 * them in the seasonal plan afterwards. A second vocabulary would let the
 * two drift, and "Sow indoors" meaning one thing on the accept screen and
 * another on the plan is precisely the confusion a review gate cannot
 * afford.
 */
export interface TimingRow {
  readonly labelKey: MessageKey;
  readonly rangeKey: MessageKey;
  readonly rangeArgs: MessageArguments;
}

/** `null` when neither bound is set — never a fabricated window. */
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
  return {
    key: 'seasonalPlan.calendar.singleMonth',
    args: { month: month === null ? '' : formatMonthName(month, locale) },
  };
}

/**
 * Every configured window on a fact, as rows ready to render. The raw
 * `1`-`12` integers are never handed to a component; only the resolved
 * month name is. A taxon with only a harvest window shows exactly that one
 * row — and a taxon with no configured window at all shows none, which the
 * panel reports rather than rendering an empty box.
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
