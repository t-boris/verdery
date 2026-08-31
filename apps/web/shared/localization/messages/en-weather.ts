/**
 * English messages for the garden weather panel.
 *
 * Its own module for the same reason every sibling here is one — the main
 * catalogue sits at the repository's 600-line source-file limit. Keys join
 * `englishMessages`, and `ru-weather.ts` is typed against this module so it
 * cannot omit or invent one.
 *
 * The three unavailable reasons are deliberately worded as three DIFFERENT
 * answers, because they are: one is a deployment fact nobody using the app
 * can act on, one is something the person fixes themselves in one click,
 * and one resolves on its own. Collapsing them into a single "no weather"
 * line would hide the only one that is actionable.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const englishWeatherMessages = {
  'weather.title': 'Conditions',
  'weather.description': 'Current conditions, the next forecast point, and completed-day rainfall.',
  'weather.loading': 'Loading weather.',
  'weather.retry': 'Try again',

  'weather.observationLabel': 'Current conditions',
  'weather.forecastLabel': 'Next forecast',
  'weather.observationWindow': 'A point reading for the latest stored conditions',
  'weather.forecastWindow': 'The nearest upcoming hourly point',
  'weather.forecastFor': 'For {time}',
  'weather.measuredAt': 'Measured {time}',
  'weather.fetchedAt': 'fetched {time}',

  'weather.temperature': 'Temperature',
  'weather.precipitation': 'Precipitation',
  'weather.wind': 'Wind',
  'weather.humidity': 'Humidity',
  'weather.precipitationValue': '{value} mm',
  'weather.windValue': '{value} m/s',
  'weather.humidityValue': '{value}%',
  'weather.measurementMissing': 'Unavailable in this stored reading',
  'weather.temperatureUnit': 'Temperature unit',

  'weather.stale': 'Out of date',
  'weather.staleExplanation':
    'This is the most recent reading for this garden, but it is older than the refresh window. Weather-based recommendations treat it with lower confidence, and frost warnings are withheld entirely.',

  'weather.unavailableTitle': 'No weather for this garden yet',
  'weather.reasonNoProvider':
    'This deployment has no weather provider switched on, so no garden receives readings. Nothing here needs your attention.',
  'weather.reasonNotGeoreferenced':
    'This garden has no location yet, and coordinates are what a weather request is made of. Set the location in the garden settings and readings begin at the next refresh.',
  'weather.reasonNotYetFetched':
    'The scheduled refresh has not reached this garden yet. Readings appear on their own shortly.',
  'weather.setLocation': 'Set the location',

  'weather.todayPrecipitationTitle': "Today's precipitation",
  'weather.latestIntervalPrecipitation': 'Latest reported interval: {value} mm',
  'weather.todayPrecipitationUnavailable': 'No interval precipitation value is available.',
  'weather.todayPrecipitationExplanation':
    'The latest value is one provider interval, not a whole-day total. A verified daily total appears in the completed-day chart after the day ends; the application does not add partial and forecast periods together.',
  'weather.rainfallTitle': 'Completed-day precipitation · last {days} days',
  'weather.rainfallTotal': '{total} mm',
  'weather.rainfallCoverage': '{available} of {days} completed days available',
  'weather.rainfallDayLabel': '{day}',
  'weather.rainfallDayValue': '{day}: {value} mm',
  'weather.rainfallNone': 'No rainfall has been measured for this garden yet.',
  'weather.rainfallExplanation':
    'This is the elapsed daily series the watering check reads. Zero means a measured dry day; a missing day is not treated as zero.',

  'weather.ruleImpactTitle': 'What this changes',
  'weather.ruleImpactWithWeather':
    'Watering checks and frost warnings are generated from these readings.',
  'weather.ruleImpactWithoutWeather':
    'Without readings, watering checks and frost warnings cannot be generated. Every other recommendation is unaffected.',
} as const;
