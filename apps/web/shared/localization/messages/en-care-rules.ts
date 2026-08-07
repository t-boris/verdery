/**
 * English messages for the care-rules disclosure.
 *
 * The blocker copy is the load-bearing part. Each reason gets its own
 * sentence because each has a different answer: one is a deployment fact
 * nobody using the app can change, two are things the reader fixes
 * themselves, and the rest resolve on their own. A single "not available"
 * would be shorter and useless.
 */
export const englishCareRulesMessages = {
  'careRules.title': 'Automatic checks',
  'careRules.description':
    'These run on their own and decide what this garden needs. Anything blocked is listed with the reason.',
  'careRules.loading': 'Loading automatic checks.',
  'careRules.retry': 'Try again',

  'careRules.activeLabel': 'Running',
  'careRules.blockedLabel': 'Blocked',
  'careRules.reviewPending': 'Awaiting horticultural review',
  'careRules.reviewPendingExplanation':
    'This check runs, but its thresholds are placeholders until a horticulturist confirms them.',

  'careRules.blocker.noWeatherProvider':
    'No weather provider is switched on for this deployment. Nothing you can do here changes it.',
  'careRules.blocker.gardenNotGeoreferenced':
    'This garden has no location. Coordinates are what a weather request is made of and what the hemisphere comes from, so setting the location unblocks several checks at once.',
  'careRules.blocker.noWeatherObservation':
    'No current conditions have been fetched for this garden yet. This resolves on its own.',
  'careRules.blocker.noWeatherForecast':
    'No forecast has been fetched for this garden yet. This resolves on its own.',
  'careRules.blocker.noRainfallHistory':
    'No daily rainfall has been recorded yet, so accumulated rain is unknown. Unknown is not the same as dry, so the check will not guess.',
  'careRules.blocker.noIdentifiedPlants':
    'No active plant has a species yet. A check about a species cannot say anything about an unidentified plant.',
  'careRules.blocker.noReviewedSeasonalFacts':
    'No plant here has seasonal timing that a horticulturist has signed off. Unreviewed timing is treated as absent.',
  'careRules.blocker.noPlacedPlants':
    'No active plant is placed in a garden area, so there is no bed history to reason about.',
  'careRules.blocker.awaitingHorticulturalReview':
    'The thresholds are placeholders until a horticulturist confirms them.',

  'careRules.usesWeather': 'Uses weather',
  'careRules.tierElevated': 'Elevated risk',
  'careRules.setLocation': 'Set the location',
} as const;
