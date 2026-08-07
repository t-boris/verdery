/**
 * English messages for the per-plant care panel.
 *
 * The water copy is the load-bearing part, and it is deliberately worded as
 * measurement rather than instruction. The rule that produces these numbers
 * refuses to state a watering amount, a schedule, or anything about the
 * soil, so the panel that displays them must not quietly supply one — "the
 * window is short by N mm" is a fact the reader can act on with their own
 * judgment; "water for ten minutes" would be advice nobody in this system
 * is entitled to give.
 *
 * `water.unknown` exists so a missing measurement never renders as zero.
 * "No rainfall recorded" and "no rain fell" are different claims, and only
 * the first one is true when the sweep has not stored a total yet.
 */
export const englishPlantCareMessages = {
  'plantCare.title': 'Care',
  'plantCare.loading': 'Loading this plant’s care.',
  'plantCare.nothingOpen': 'Nothing is open for this plant right now.',
  'plantCare.recommendationsTitle': 'Suggested',
  'plantCare.tasksTitle': 'Open tasks',
  'plantCare.ruleIdentity': 'Rule {key} v{version}',
  'plantCare.due': 'Due {date}',
  'plantCare.water.unknown':
    'No rainfall has been recorded for this garden yet, so the water balance is unknown. Unknown is not the same as dry, which is why no watering check is raised.',
  'plantCare.water.overDays': 'of rain over the last {days} days',
  'plantCare.water.barLabel':
    '{accumulated} mm of rain against the {reference} mm a week usually supplies',
  'plantCare.water.short':
    'That is {shortfall} mm short of what the window usually supplies — worth checking whether this plant needs watering.',
  'plantCare.water.sufficient': 'At or above the {reference} mm the window usually supplies.',
  'plantCare.water.coverage': 'Measured across {covered} of {days} days.',
} as const;
