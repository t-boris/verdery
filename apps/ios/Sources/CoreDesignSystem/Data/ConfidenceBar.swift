import SwiftUI

/// How sure something is, as a bar **and** a number.
///
/// Both, always. The bar is what gets read at a glance across a stack of cards
/// — "that one is much less certain than the last" is a shape, not a figure.
/// The number is what somebody quotes back when the suggestion turns out to be
/// wrong, and it is the only one of the two that survives a screenshot sent to
/// somebody else.
///
/// The bar carries no colour scale. A red-amber-green confidence gradient would
/// be this application's opinion about where a provider's number stops being
/// trustworthy, and it does not have one — the figure is reported, not judged.
public struct ConfidenceBar: View {
    private let fraction: Double
    private let label: String

    @ScaledSize(Metrics.space2) private var barHeight

    public init(fraction: Double, label: String) {
        self.fraction = fraction
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.surfaceSunken)
                    Capsule()
                        .fill(Palette.interaction)
                        .frame(width: proxy.size.width * clamped)
                }
            }
            .frame(height: barHeight)

            Text(label)
                .font(FieldConsoleType.mono.font)
                .foregroundStyle(Palette.textMuted)
        }
        // One element, one sentence: the bar is a picture of the figure, and
        // reading both aloud would say the same thing twice.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    /// A provider correction outside 0…1 would otherwise draw a bar past its
    /// own track.
    private var clamped: Double { min(max(fraction, 0), 1) }
}
