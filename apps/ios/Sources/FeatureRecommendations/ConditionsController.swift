import CoreDesignSystem
import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// The conditions over the garden, on the screen that acts on them.
///
/// It sits on Today because two of the rules read weather and their stored
/// explanations quote the exact reading they fired on. Showing those readings
/// above the list is what makes "check whether this needs watering" verifiable
/// rather than merely asserted — and on a day with no weather it makes the
/// **absence** of those recommendations legible instead of looking like an
/// empty list.
///
/// A controller of its own rather than more state on `TodayViewModel`, so a
/// weather failure cannot take the recommendation list down with it: they are
/// separate reads and they fail separately.
@MainActor
@Observable
public final class ConditionsController {
    public private(set) var weather: GardenWeather?
    /// The read itself failed — offline, or the request errored. Distinct from
    /// a successful read that carries no data, which reports its own reason.
    public private(set) var isUnreachable = false
    public private(set) var isLoading = false

    private let getWeather: GetGardenWeather
    private let strings: LocalizedStrings
    private let presentation: WeatherPresentation

    public init(
        getWeather: GetGardenWeather,
        strings: LocalizedStrings,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.getWeather = getWeather
        self.strings = strings
        self.presentation = WeatherPresentation(strings: strings, locale: locale)
    }

    public func load(gardenId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            weather = try await getWeather(gardenId: gardenId)
            isUnreachable = false
        } catch {
            isUnreachable = true
        }
    }

    // MARK: - Text

    public var title: String { strings(.weatherTitle) }
    public var observationLabel: String { strings(.weatherObservationLabel) }
    public var forecastLabel: String { strings(.weatherForecastLabel) }
    public var staleLabel: String { strings(.weatherStale) }
    public var staleExplanation: String { strings(.weatherStaleExplanation) }
    public var unavailableTitle: String { strings(.weatherUnavailableTitle) }
    public var offlineText: String { strings(.weatherOffline) }
    public var retryTitle: String { strings(.weatherRetry) }
    public var rainfallNoneText: String { strings(.weatherRainfallNone) }
    public var rainfallExplanation: String { strings(.weatherRainfallExplanation) }

    /// Which sentence about the rules is true right now. With no readings the
    /// two weather rules cannot run at all, and saying so is the difference
    /// between an empty list that looks broken and one that is explained.
    public var ruleImpactText: String {
        weather?.hasReading == true
            ? strings(.weatherRuleImpactWithWeather)
            : strings(.weatherRuleImpactWithoutWeather)
    }

    public var unavailableText: String {
        presentation.unavailableText(weather?.unavailableReason)
    }

    /// The one absence a person can resolve themselves gets a way to resolve
    /// it. The other two are stated and left alone.
    public var canSetLocation: Bool {
        weather?.unavailableReason == .gardenNotGeoreferenced
    }

    public var setLocationTitle: String { strings(.weatherSetLocation) }

    public func measuredAtText(_ reading: GardenWeatherReading) -> String {
        presentation.measuredAtText(reading)
    }

    public func forecastForText(_ reading: GardenWeatherReading) -> String {
        presentation.forecastForText(reading)
    }

    public func measurementCells(_ reading: GardenWeatherReading) -> [ReadingCell] {
        presentation.measurements(for: reading).map { measurement in
            ReadingCell(
                id: measurement.label,
                symbol: measurement.symbol,
                label: measurement.label,
                value: measurement.value,
                isMissing: measurement.isMissing
            )
        }
    }

    public func rainfallBars(_ rainfall: RecentRainfall) -> [RainfallBar] {
        presentation.rainfallDays(rainfall).map { day in
            RainfallBar(
                id: day.id,
                dayLabel: day.dayLabel,
                spokenValue: day.spokenValue,
                fillFraction: day.fillFraction,
                isDry: day.isDry
            )
        }
    }

    public func rainfallTitle(_ rainfall: RecentRainfall) -> String {
        presentation.rainfallTitle(rainfall)
    }

    public func rainfallTotal(_ rainfall: RecentRainfall) -> String {
        presentation.rainfallTotal(rainfall)
    }

    public func rainfallSummary(_ rainfall: RecentRainfall) -> String {
        "\(presentation.rainfallTitle(rainfall)). \(presentation.rainfallTotal(rainfall))"
    }
}

/// The conditions over a garden, as the scheduled sweep last stored them.
public struct GetGardenWeather: Sendable {
    private let gateway: any WeatherGateway

    public init(gateway: any WeatherGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> GardenWeather {
        try await gateway.getGardenWeather(gardenId: gardenId)
    }
}
