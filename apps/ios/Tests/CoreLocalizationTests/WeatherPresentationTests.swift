import CoreDomain
import Foundation
import Testing

@testable import CoreLocalization

/// The text two screens share.
///
/// Today and a plant's care card render the same readings, and a garden whose
/// rainfall reads "12 mm" in one place and "12.0" in the other looks like two
/// different measurements — which is why the formatting lives in one type and
/// is asserted here rather than in either screen.
@Suite("Weather presentation")
struct WeatherPresentationTests {
    private func presentation(_ languageCode: String) -> WeatherPresentation {
        let locale = Locale(identifier: languageCode)
        return WeatherPresentation(strings: LocalizedStrings(locale: locale), locale: locale)
    }

    private func reading(
        temperature: Double? = 18.4,
        precipitation: Double? = 0,
        wind: Double? = 3.2,
        humidity: Double? = 61
    ) -> GardenWeatherReading {
        GardenWeatherReading(
            effectiveAt: Date(timeIntervalSince1970: 1_780_000_000),
            retrievedAt: Date(timeIntervalSince1970: 1_780_000_000),
            freshness: .fresh,
            temperatureCelsius: temperature,
            precipitationMm: precipitation,
            windSpeedMps: wind,
            humidityPercent: humidity
        )
    }

    /// A grid that silently drops the fields a provider did not send makes
    /// "not reported" indistinguishable from "zero" — and for precipitation
    /// those are opposite facts.
    @Test("always renders four measurements, absent ones marked as absent")
    func absentMeasurementsStaySaid() {
        let cells = presentation("en").measurements(for: reading(precipitation: nil))
        #expect(cells.count == 4)
        #expect(cells.filter(\.isMissing).count == 1)

        let precipitation = cells[1]
        #expect(precipitation.isMissing)
        #expect(precipitation.value == "Not reported")

        // Zero is a measurement and is rendered as one.
        let measured = presentation("en").measurements(for: reading(precipitation: 0))
        #expect(!measured[1].isMissing)
        #expect(measured[1].value.contains("0"))
    }

    /// `String(format: "%.1f", …)` always emits the POSIX separator, and a
    /// Russian reader saw `1.5` inside otherwise-Russian prose.
    @Test("uses the reader's own decimal separator")
    func decimalSeparatorFollowsLocale() {
        #expect(presentation("en").measurements(for: reading())[0].value.contains("18.4"))
        #expect(presentation("ru").measurements(for: reading())[0].value.contains("18,4"))
    }

    /// Humidity is a whole percent. Showing more digits than the estimate
    /// behind it supports is false precision.
    @Test("shows humidity without fraction digits")
    func humidityIsWhole() {
        let cells = presentation("en").measurements(for: reading(humidity: 61))
        #expect(cells[3].value == "61%")
    }

    @Test("scales bars against the tallest day and never divides by zero")
    func rainfallFractions() {
        let days = presentation("en").rainfallDays(
            RecentRainfall(
                windowDays: 3,
                totalMm: 6,
                days: [
                    DailyRainfall(date: "2026-08-05", precipitationMm: 0),
                    DailyRainfall(date: "2026-08-06", precipitationMm: 2),
                    DailyRainfall(date: "2026-08-07", precipitationMm: 4),
                ]
            )
        )
        #expect(days.map(\.fillFraction) == [0, 0.5, 1])
        #expect(days[0].isDry)
        #expect(!days[2].isDry)

        // Every day dry: a peak of zero must not become a division.
        let allDry = presentation("en").rainfallDays(
            RecentRainfall(
                windowDays: 2,
                totalMm: 0,
                days: [
                    DailyRainfall(date: "2026-08-06", precipitationMm: 0),
                    DailyRainfall(date: "2026-08-07", precipitationMm: 0),
                ]
            )
        )
        #expect(allDry.allSatisfy { $0.fillFraction == 0 })
    }

    /// The bar draws the number but cannot say it, so the spoken label carries
    /// both the day and the depth.
    @Test("speaks each day with its depth")
    func spokenValueCarriesBoth() {
        let day = presentation("en").rainfallDays(
            RecentRainfall(
                windowDays: 1,
                totalMm: 4.2,
                days: [DailyRainfall(date: "2026-08-07", precipitationMm: 4.2)]
            )
        )[0]
        #expect(day.spokenValue.contains("4.2"))
        #expect(day.spokenValue.contains(day.dayLabel))
    }

    /// An unparsable day is shown as it arrived rather than dropped: a bar with
    /// no label is worse than one labelled with the raw date.
    @Test("falls back to the raw day when it cannot be parsed")
    func unparsableDayLabel() {
        #expect(presentation("en").dayLabel("not-a-date") == "not-a-date")
    }

    /// Three different answers, because they are three different situations
    /// and only one of them is something the reader can act on.
    @Test("gives each unavailable reason its own sentence")
    func reasonsStayApart() {
        let text = presentation("en")
        let sentences = [
            text.unavailableText(.noProviderConfigured),
            text.unavailableText(.gardenNotGeoreferenced),
            text.unavailableText(.notYetFetched),
        ]
        #expect(Set(sentences).count == 3)
        #expect(sentences.allSatisfy { !$0.isEmpty })
        // An unrecognised reason falls back to the sentence that is true of
        // every reason, so it cannot mislead.
        #expect(text.unavailableText(nil) == sentences[2])
    }

    @Test("translates every reason into Russian")
    func russianReasons() {
        let russian = presentation("ru")
        for reason in [
            WeatherUnavailableReason.noProviderConfigured,
            .gardenNotGeoreferenced,
            .notYetFetched,
        ] {
            let text = russian.unavailableText(reason)
            #expect(!text.isEmpty)
            #expect(text != reason.rawValue)
        }
    }
}
