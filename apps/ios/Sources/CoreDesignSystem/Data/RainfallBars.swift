import SwiftUI

/// One day in a ``RainfallBars`` series, already formatted.
///
/// The component takes text, never numbers to format, and never a localization
/// key: the design system resolves no strings and knows no locale. The caller
/// has both, and hands over the result.
public struct RainfallBar: Identifiable, Equatable, Sendable {
    public let id: String
    /// The short day label under the bar — "7 Aug", "Пн".
    public let dayLabel: String
    /// The whole reading, spoken: "7 August: 4.2 mm". This is what VoiceOver
    /// reads, so it carries the number the bar only draws.
    public let spokenValue: String
    /// Height as a fraction of the tallest day, already normalized to 0…1.
    public let fillFraction: Double
    /// Measured, and nothing fell. Drawn as a hairline rather than as nothing,
    /// because "no rain that day" and "no reading for that day" must not look
    /// the same — they lead to opposite decisions.
    public let isDry: Bool

    public init(
        id: String,
        dayLabel: String,
        spokenValue: String,
        fillFraction: Double,
        isDry: Bool
    ) {
        self.id = id
        self.dayLabel = dayLabel
        self.spokenValue = spokenValue
        self.fillFraction = fillFraction
        self.isDry = isDry
    }
}

/// Recent rainfall, as bars.
///
/// Each bar is its own accessible element carrying its day and depth as text,
/// so the chart *is* its accessible table: the thing a screen reader walks is
/// the thing that is drawn, and there is no second representation to keep in
/// sync.
///
/// Bars are scaled against the window's own tallest day rather than a fixed
/// ceiling, because the question a rainfall chart answers is "when did it
/// rain", not "how does this garden compare with elsewhere". The
/// decision-relevant number — the total — is stated as text by the caller,
/// where a number belongs.
public struct RainfallBars: View {
    private let bars: [RainfallBar]
    private let summary: String

    @ScaledSize(72) private var chartHeight
    @ScaledSize(Metrics.space1) private var barWidth

    public init(bars: [RainfallBar], summary: String) {
        self.bars = bars
        self.summary = summary
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: Metrics.space1) {
            ForEach(bars) { bar in
                VStack(spacing: Metrics.space1) {
                    column(for: bar)
                    Text(bar.dayLabel)
                        .font(FieldConsoleType.mono.font)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(bar.spokenValue)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(summary)
    }

    private func column(for bar: RainfallBar) -> some View {
        // The track is drawn at full height so every day occupies the same
        // column whatever fell on it; an evenly spaced axis is what makes the
        // shape of a dry spell readable.
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: Metrics.radiusSmall, style: .continuous)
                .fill(Palette.surfaceSunken)
            RoundedRectangle(cornerRadius: Metrics.radiusSmall, style: .continuous)
                .fill(bar.isDry ? Palette.border : Palette.interaction)
                .frame(
                    height: bar.isDry
                        ? max(barWidth / 2, Metrics.hairline)
                        : chartHeight * clamped(bar.fillFraction)
                )
        }
        .frame(height: chartHeight)
    }

    /// Defensive rather than trusting: a fraction outside 0…1 would draw a bar
    /// out of its own track, and a provider correction is exactly the kind of
    /// thing that produces one.
    private func clamped(_ fraction: Double) -> Double {
        min(max(fraction, 0), 1)
    }
}
