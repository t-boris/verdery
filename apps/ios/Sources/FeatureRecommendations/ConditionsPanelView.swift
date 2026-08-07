import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The conditions over the garden, above the recommendations they produced.
///
/// Every degraded state is rendered as content rather than hidden: a stale
/// reading is labelled and kept, because it is still the most recent one this
/// garden has, and each unavailable reason gets its own sentence because only
/// one of them is something the reader can act on.
struct ConditionsPanelView: View {
    let controller: ConditionsController
    /// Where the garden's location is set. Absent when this screen has no route
    /// there, in which case the reason is stated without a dead button.
    let setLocation: (() -> Void)?

    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                SectionEyebrow(symbol: "cloud.sun", title: controller.title)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if controller.isUnreachable {
            InlineMessage(controller.offlineText, tone: .neutral)
                .accessibilityIdentifier("weather.offline")
        } else if let weather = controller.weather {
            if let observation = weather.observation {
                reading(observation, title: controller.observationLabel, isForecast: false)
            }
            if let forecast = weather.forecast {
                reading(forecast, title: controller.forecastLabel, isForecast: true)
            }
            if !weather.hasReading {
                unavailable
            }
            rainfall(weather)

            Text(controller.ruleImpactText)
                .font(FieldConsoleType.secondary.font)
                .foregroundStyle(Palette.textMuted)

            if let attribution = weather.attributionText {
                // A licence obligation of the provider's own terms, carried on
                // the record — rendered whenever a reading is.
                Text(attribution)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
        } else if controller.isLoading {
            LoadingStateView(controller.title)
                .accessibilityIdentifier("weather.loading")
        }
    }

    @ViewBuilder
    private func reading(
        _ reading: GardenWeatherReading,
        title: String,
        isForecast: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            HStack(spacing: Metrics.space2) {
                Text(title)
                    .font(FieldConsoleType.label.font)
                    .foregroundStyle(Palette.textMuted)
                Spacer(minLength: 0)
                Text(
                    isForecast
                        ? controller.forecastForText(reading)
                        : controller.measuredAtText(reading)
                )
                .font(FieldConsoleType.mono.font)
                .foregroundStyle(Palette.textMuted)
            }

            ReadingGrid(cells: controller.measurementCells(reading))
                .accessibilityIdentifier(isForecast ? "weather.forecast" : "weather.observation")

            if reading.isStale {
                Chip(
                    symbol: "clock.badge.exclamationmark",
                    label: controller.staleLabel,
                    tone: .warning
                )
                Text(controller.staleExplanation)
                    .font(FieldConsoleType.secondary.font)
                    .foregroundStyle(Palette.textMuted)
            }
        }
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Text(controller.unavailableTitle)
                .font(FieldConsoleType.bodyStrong.font)
                .foregroundStyle(Palette.text)
            Text(controller.unavailableText)
                .font(FieldConsoleType.secondary.font)
                .foregroundStyle(Palette.textMuted)
            if controller.canSetLocation, let setLocation {
                Button(controller.setLocationTitle, action: setLocation)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("weather.setLocation")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("weather.unavailable")
    }

    @ViewBuilder
    private func rainfall(_ weather: GardenWeather) -> some View {
        if let rainfall = weather.recentRainfall, !rainfall.days.isEmpty {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                HStack {
                    Text(controller.rainfallTitle(rainfall))
                        .font(FieldConsoleType.label.font)
                        .foregroundStyle(Palette.textMuted)
                    Spacer(minLength: 0)
                    Text(controller.rainfallTotal(rainfall))
                        .font(FieldConsoleType.monoStrong.font)
                        .foregroundStyle(Palette.text)
                }
                RainfallBars(
                    bars: controller.rainfallBars(rainfall),
                    summary: controller.rainfallSummary(rainfall)
                )
                .accessibilityIdentifier("weather.rainfall")
                Text(controller.rainfallExplanation)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
        } else {
            // Unknown, not dry. The sentence says which, because the two lead
            // to opposite decisions.
            Text(controller.rainfallNoneText)
                .font(FieldConsoleType.secondary.font)
                .foregroundStyle(Palette.textMuted)
                .accessibilityIdentifier("weather.rainfallNone")
        }
    }
}
