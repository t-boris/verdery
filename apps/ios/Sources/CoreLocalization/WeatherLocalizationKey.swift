/// The conditions over a garden, and what one plant's care reads from them.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
///
/// The three unavailable reasons are worded as three DIFFERENT answers,
/// because they are: one is a deployment fact nobody using the application can
/// act on, one is something the reader fixes themselves, and one resolves on
/// its own. Collapsing them into a single "no weather" line would hide the only
/// one that is actionable — the same distinction the web catalogue keeps.
public enum WeatherLocalizationKey: String, Sendable, CaseIterable {
    case weatherTitle = "weather.title"
    case weatherObservationLabel = "weather.observationLabel"
    case weatherForecastLabel = "weather.forecastLabel"
    case weatherMeasuredAt = "weather.measuredAt"
    case weatherForecastFor = "weather.forecastFor"

    case weatherTemperature = "weather.temperature"
    case weatherPrecipitation = "weather.precipitation"
    case weatherWind = "weather.wind"
    case weatherHumidity = "weather.humidity"
    case weatherTemperatureValue = "weather.temperatureValue"
    case weatherPrecipitationValue = "weather.precipitationValue"
    case weatherWindValue = "weather.windValue"
    case weatherHumidityValue = "weather.humidityValue"
    case weatherMeasurementMissing = "weather.measurementMissing"

    case weatherStale = "weather.stale"
    case weatherStaleExplanation = "weather.staleExplanation"

    case weatherUnavailableTitle = "weather.unavailableTitle"
    case weatherReasonNoProvider = "weather.reasonNoProvider"
    case weatherReasonNotGeoreferenced = "weather.reasonNotGeoreferenced"
    case weatherReasonNotYetFetched = "weather.reasonNotYetFetched"
    case weatherSetLocation = "weather.setLocation"

    case weatherRainfallTitle = "weather.rainfallTitle"
    case weatherRainfallTotal = "weather.rainfallTotal"
    case weatherRainfallDayValue = "weather.rainfallDayValue"
    case weatherRainfallNone = "weather.rainfallNone"
    case weatherRainfallDry = "weather.rainfallDry"
    case weatherRainfallExplanation = "weather.rainfallExplanation"

    case weatherRuleImpactWithWeather = "weather.ruleImpactWithWeather"
    case weatherRuleImpactWithoutWeather = "weather.ruleImpactWithoutWeather"
    case weatherOffline = "weather.offline"
    case weatherRetry = "weather.retry"

    // MARK: - One plant's care

    case careTitle = "care.title"
    case careNothingToDo = "care.nothingToDo"
    case careNothingToDoDetail = "care.nothingToDoDetail"
    case careProposalsUnknown = "care.proposalsUnknown"
    case careOriginTask = "care.originTask"
    case careOriginRecommendation = "care.originRecommendation"
    case careDueBy = "care.dueBy"
    case careGardenRainfallNote = "care.gardenRainfallNote"
    case careOpenAction = "care.openAction"
}
