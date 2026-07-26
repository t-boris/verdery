import SwiftUI

/// A small icon-led fact: a symbol, a short label, and a tone.
///
/// This is the workhorse of the dense layout. Where the screens previously
/// wrote a labelled row ("Urgency: high"), they now render a chip whose symbol
/// carries the meaning and whose label confirms it — the same information in a
/// fraction of the height, and legible at a glance rather than by reading.
///
/// Icon-led, never icon-only: the label stays in the layout so a concept the
/// reader has not met before is still named, and VoiceOver reads the pair as
/// one phrase rather than announcing a decorative image.
public struct Chip: View {
    private let symbol: String
    private let label: String
    private let tone: Tone
    /// When false the label is hidden visually but kept as the accessible
    /// name — used only where the surrounding text already says the same
    /// thing, never for a concept this chip alone introduces.
    private let showsLabel: Bool

    public init(symbol: String, label: String, tone: Tone = .neutral, showsLabel: Bool = true) {
        self.symbol = symbol
        self.label = label
        self.tone = tone
        self.showsLabel = showsLabel
    }

    public var body: some View {
        HStack(spacing: Metrics.space1) {
            // A text style plus `imageScale`, never a point size: an SF
            // Symbol sized this way tracks the reader's text size and stays on
            // the label's baseline, which a fixed size does neither of.
            Image(systemName: symbol)
                .font(Typography.micro)
                .imageScale(.medium)
                .symbolRenderingMode(.hierarchical)

            if showsLabel {
                Text(label)
                    .font(Typography.micro)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, Metrics.space2)
        .padding(.vertical, Metrics.space1)
        .background(
            Capsule(style: .continuous)
                .fill(tone.quietFill)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A single symbol used as a status glyph, with no surrounding fill.
///
/// For a row that already carries its meaning in text and needs only a marker
/// — a pending-sync arrow, an elevated-risk triangle. Always labelled.
public struct StatusGlyph: View {
    private let symbol: String
    private let label: String
    private let tone: Tone

    public init(symbol: String, label: String, tone: Tone = .neutral) {
        self.symbol = symbol
        self.label = label
        self.tone = tone
    }

    public var body: some View {
        Image(systemName: symbol)
            .font(Typography.detail)
            .imageScale(.medium)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(tone.foreground)
            .accessibilityLabel(label)
    }
}

/// A symbol on a soft tinted disc — the leading element of a dense row.
///
/// Gives every row a fixed, scannable left edge, so a list reads as a column
/// of kinds rather than a column of sentences.
public struct IconMedallion: View {
    private let symbol: String
    private let label: String
    private let tone: Tone
    private let isLarge: Bool

    @ScaledSize(Metrics.minimumTouchTarget) private var discSize

    public init(symbol: String, label: String, tone: Tone = .accent, isLarge: Bool = false) {
        self.symbol = symbol
        self.label = label
        self.tone = tone
        self.isLarge = isLarge
    }

    public var body: some View {
        Image(systemName: symbol)
            .font(isLarge ? Typography.title : Typography.body)
            .imageScale(.large)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(tone.foreground)
            .frame(width: isLarge ? discSize * 1.6 : discSize, height: isLarge ? discSize * 1.6 : discSize)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                    .fill(tone.quietFill)
            )
            .accessibilityLabel(label)
    }
}
