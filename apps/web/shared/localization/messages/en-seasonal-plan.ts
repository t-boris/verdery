/**
 * English messages for the Seasonal plan section (P9D-UX-01): the
 * calendar of configured sow/transplant/harvest windows and the
 * continuous bed-rotation status, `GET /gardens/{gardenId}/seasonal-plan`'s
 * own two halves.
 *
 * A separate module spread into `en.ts`, the same split-by-domain judgment
 * `en-today.ts`'s own header documents — the main catalogue sits at the
 * repository's 600-line limit, so a new message domain arrives as its own
 * module rather than more lines in it.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * packages/api-contracts/src/seasonal-plan.ts.
 */
export const englishSeasonalPlanMessages = {
  'seasonalPlan.pageTitle': 'Seasonal plan',
  'seasonalPlan.pageDescription':
    "This garden's configured sowing, transplant, and harvest windows, and the current bed-rotation state.",
  'seasonalPlan.loading': 'Loading the seasonal plan.',
  'seasonalPlan.retry': 'Try again',

  'seasonalPlan.hemisphereUnknownTitle': "We don't know your season yet",
  'seasonalPlan.hemisphereUnknownDescription':
    'Seasonal windows depend on which hemisphere this garden is in, and that is only known once the garden has a location on the map.',
  'seasonalPlan.hemisphereUnknownLink': 'Set the garden location on the map',

  'seasonalPlan.plantFallback': 'Plant {plantId}',

  'seasonalPlan.calendar.title': 'Calendar',
  'seasonalPlan.calendar.empty': 'No active plants to plan a calendar for yet.',
  'seasonalPlan.calendar.noSeasonalData': 'No reviewed seasonal data for this plant yet.',
  'seasonalPlan.calendar.noWindowsConfigured':
    'A seasonal fact is on record, but no sow, transplant, or harvest window is configured.',
  'seasonalPlan.calendar.sowIndoorsLabel': 'Sow indoors',
  'seasonalPlan.calendar.sowOutdoorsLabel': 'Sow outdoors',
  'seasonalPlan.calendar.transplantLabel': 'Transplant',
  'seasonalPlan.calendar.harvestLabel': 'Harvest',
  'seasonalPlan.calendar.monthRange': '{start} – {end}',
  'seasonalPlan.calendar.singleMonth': '{month}',

  'seasonalPlan.rotation.title': 'Rotation',
  'seasonalPlan.rotation.conflictsEmpty': 'No rest-period conflicts right now.',
  'seasonalPlan.rotation.conflictBadge': 'Rest-period conflict',
  'seasonalPlan.rotation.conflictText':
    'This bed grew {priorFamily} {elapsedDays} days ago; the recommended rest for {family} is {restPeriodThresholdDays} days.',
  'seasonalPlan.rotation.showOthers': 'Show every tracked bed',
  'seasonalPlan.rotation.hideOthers': 'Hide every tracked bed',
  'seasonalPlan.rotation.othersEmpty': 'No other bed-rotation history is tracked yet.',
  'seasonalPlan.rotation.noPriorOccupant': '{family}: no known prior occupant for this bed.',
  'seasonalPlan.rotation.differentFamily':
    '{family}: this bed previously grew {priorFamily}, a different family — no rotation concern.',
  'seasonalPlan.rotation.noRestPeriodConfigured':
    '{family}: this bed grew {priorFamily} {elapsedDays} days ago; no rest period is configured for this family.',
  'seasonalPlan.rotation.restDurationUnknown':
    '{family}: this bed previously grew {priorFamily}, but the departure date is not on record.',
  'seasonalPlan.rotation.restPeriodElapsed':
    '{family}: this bed grew {priorFamily} {elapsedDays} days ago, past the {restPeriodThresholdDays}-day recommended rest.',
} as const;
