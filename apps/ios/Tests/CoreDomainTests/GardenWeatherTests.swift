import Foundation
import Testing

@testable import CoreDomain

/// Rainfall arithmetic, and the one distinction the whole feature rests on.
///
/// "No rain fell" and "nobody measured" are opposite inputs to a watering
/// decision, and every property here exists to keep them apart.
@Suite("Garden weather")
struct GardenWeatherTests {
    private func rainfall(_ values: [Double], windowDays: Int = 7) -> RecentRainfall {
        RecentRainfall(
            windowDays: windowDays,
            totalMm: values.reduce(0, +),
            days: values.enumerated().map { index, value in
                DailyRainfall(date: "2026-08-0\(index + 1)", precipitationMm: value)
            }
        )
    }

    @Test("scales bars against the window's own tallest day")
    func peakIsTheWindowsOwn() {
        #expect(rainfall([0, 4.2, 1.1]).peakMm == 4.2)
        // Every day dry means a peak of zero, and every bar is then the
        // hairline — which is the right picture, not a division by zero.
        #expect(rainfall([0, 0, 0]).peakMm == 0)
        #expect(rainfall([]).peakMm == 0)
    }

    @Test("a measured dry week is not an unmeasured one")
    func dryIsNotUnknown() {
        #expect(rainfall([0, 0, 0]).isMeasuredDry)
        // No series at all is unknown, and unknown is not dry.
        #expect(!rainfall([]).isMeasuredDry)
        #expect(!rainfall([0, 2.5]).isMeasuredDry)
    }

    /// A garden with less history than the window is ordinary, not an error.
    @Test("accepts a series shorter than its window")
    func shortSeries() {
        let series = rainfall([1.0, 2.0], windowDays: 7)
        #expect(series.days.count == 2)
        #expect(series.windowDays == 7)
        #expect(series.totalMm == 3.0)
    }

    @Test("a day that measured zero is a day, not a gap")
    func zeroDayIsADay() {
        let day = DailyRainfall(date: "2026-08-07", precipitationMm: 0)
        #expect(day.isDry)
        #expect(day.id == "2026-08-07")
    }

    /// A stale reading is displayable state, not an error: it is still the most
    /// recent one this garden has, and the rules branch on exactly this.
    @Test("keeps a stale reading as a reading")
    func staleIsDisplayable() {
        let reading = GardenWeatherReading(
            effectiveAt: Date(timeIntervalSince1970: 1_780_000_000),
            retrievedAt: Date(timeIntervalSince1970: 1_780_000_000),
            freshness: .stale,
            temperatureCelsius: 18,
            precipitationMm: nil,
            windSpeedMps: 3,
            humidityPercent: 60
        )
        #expect(reading.isStale)

        let weather = GardenWeather(
            observation: reading,
            forecast: nil,
            providerConfigured: true,
            attributionText: "Weather data by Open-Meteo.com",
            recentRainfall: nil,
            unavailableReason: nil
        )
        #expect(weather.hasReading)
        // An absent measurement stays absent. Substituting zero here would
        // turn "not reported" into "it did not rain".
        #expect(weather.observation?.precipitationMm == nil)
    }
}
