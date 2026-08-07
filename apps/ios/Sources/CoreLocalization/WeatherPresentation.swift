import CoreDomain
import Foundation

/// Turning stored weather into the exact text two screens render.
///
/// It lives here rather than in either feature because Today and a plant's
/// care card show the same readings and must word them identically — a garden
/// whose rainfall reads "12 mm over 7 days" in one place and "12.0 mm" in the
/// other looks like two different measurements. `CoreDesignSystem` resolves no
/// keys and knows no locale, and a feature may not import a sibling, so the
/// only home that both can reach is this one.
///
/// Everything here is a value in and a `String` out, so all of it is testable
/// without rendering anything.
public struct WeatherPresentation: Sendable {
    /// One formatted day of rainfall, ready to be drawn as a bar.
    public struct RainfallDay: Sendable, Equatable {
        public let id: String
        public let dayLabel: String
        /// The whole reading spoken, which is what a screen reader gets: the
        /// bar draws the number but cannot say it.
        public let spokenValue: String
        public let fillFraction: Double
        public let isDry: Bool
    }

    /// One measurement, with its label and either a value or an explicit
    /// "not reported" — never a blank and never a substituted zero.
    public struct Measurement: Sendable, Equatable {
        public let symbol: String
        public let label: String
        public let value: String
        /// True when the provider did not report this field. The screen styles
        /// it differently, because "not reported" and "zero" are different
        /// facts and for precipitation they are opposite ones.
        public let isMissing: Bool
    }

    private let strings: LocalizedStrings
    private let locale: Locale

    public init(strings: LocalizedStrings, locale: Locale = .autoupdatingCurrent) {
        self.strings = strings
        self.locale = locale
    }

    // MARK: - Readings

    /// Fixed order, and every measurement always present — including the ones
    /// the provider did not report. A grid that silently drops absent fields
    /// makes "not reported" indistinguishable from "zero".
    public func measurements(for reading: GardenWeatherReading) -> [Measurement] {
        [
            measurement(
                symbol: "thermometer.medium",
                label: strings(.weatherTemperature),
                value: reading.temperatureCelsius,
                template: .weatherTemperatureValue,
                fractionDigits: 1
            ),
            measurement(
                symbol: "drop",
                label: strings(.weatherPrecipitation),
                value: reading.precipitationMm,
                template: .weatherPrecipitationValue,
                fractionDigits: 1
            ),
            measurement(
                symbol: "wind",
                label: strings(.weatherWind),
                value: reading.windSpeedMps,
                template: .weatherWindValue,
                fractionDigits: 1
            ),
            measurement(
                symbol: "humidity",
                label: strings(.weatherHumidity),
                value: reading.humidityPercent,
                template: .weatherHumidityValue,
                fractionDigits: 0
            ),
        ]
    }

    private func measurement(
        symbol: String,
        label: String,
        value: Double?,
        template: WeatherLocalizationKey,
        fractionDigits: Int
    ) -> Measurement {
        guard let value else {
            return Measurement(
                symbol: symbol,
                label: label,
                value: strings(.weatherMeasurementMissing),
                isMissing: true
            )
        }
        return Measurement(
            symbol: symbol,
            label: label,
            value: strings.string(
                template,
                parameters: ["value": strings.number(value, fractionDigits: fractionDigits)]
            ),
            isMissing: false
        )
    }

    public func measuredAtText(_ reading: GardenWeatherReading) -> String {
        strings.string(
            .weatherMeasuredAt,
            parameters: ["time": instantText(reading.effectiveAt)]
        )
    }

    public func forecastForText(_ reading: GardenWeatherReading) -> String {
        strings.string(
            .weatherForecastFor,
            parameters: ["time": instantText(reading.effectiveAt)]
        )
    }

    // MARK: - Rainfall

    /// Bars scaled against the window's own tallest day: the question a
    /// rainfall series answers is "when did it rain", not "how does this
    /// compare with elsewhere". The total is stated as text, where a number
    /// belongs.
    public func rainfallDays(_ rainfall: RecentRainfall) -> [RainfallDay] {
        let peak = rainfall.peakMm
        return rainfall.days.map { day in
            let depth = strings.number(day.precipitationMm, fractionDigits: 1)
            let label = dayLabel(day.date)
            return RainfallDay(
                id: day.id,
                dayLabel: label,
                spokenValue: strings.string(
                    .weatherRainfallDayValue,
                    parameters: ["day": label, "value": depth]
                ),
                // Peak zero means every day was dry, and every bar is then the
                // hairline — which is exactly the right picture.
                fillFraction: peak == 0 ? 0 : day.precipitationMm / peak,
                isDry: day.isDry
            )
        }
    }

    public func rainfallTitle(_ rainfall: RecentRainfall) -> String {
        strings.string(
            .weatherRainfallTitle,
            parameters: ["days": String(rainfall.windowDays)]
        )
    }

    public func rainfallTotal(_ rainfall: RecentRainfall) -> String {
        strings.string(
            .weatherRainfallTotal,
            parameters: ["total": strings.number(rainfall.totalMm, fractionDigits: 1)]
        )
    }

    // MARK: - Absence

    public func unavailableText(_ reason: WeatherUnavailableReason?) -> String {
        switch reason {
        case .noProviderConfigured: strings(.weatherReasonNoProvider)
        case .gardenNotGeoreferenced: strings(.weatherReasonNotGeoreferenced)
        case .notYetFetched: strings(.weatherReasonNotYetFetched)
        // An unrecognised reason falls back to the sentence that is true of
        // every reason, so it cannot mislead.
        case nil: strings(.weatherReasonNotYetFetched)
        }
    }

    // MARK: - Dates

    /// Short and numeric: the axis under a bar has room for a day, not a
    /// sentence, and the full date is spoken in the accessible label instead.
    public func dayLabel(_ calendarDay: String) -> String {
        guard let date = CalendarDate.date(from: calendarDay) else { return calendarDay }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("dMMM")
        return formatter.string(from: date)
    }

    public func instantText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
