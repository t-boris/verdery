import SwiftUI

/// The filled brand button: one per screen, for the action the screen exists
/// to perform.
public struct PrimaryButtonStyle: ButtonStyle {
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumHeight
    @Environment(\.isEnabled) private var isEnabled

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(FieldConsoleType.body.font.weight(.semibold))
            .foregroundStyle(Palette.interactionText)
            .padding(.horizontal, Metrics.space4)
            .frame(minHeight: minimumHeight)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                    .fill(Palette.interaction)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.82 : 1) : 0.45)
    }
}

/// The outlined button: everything else that is a full-width commitment.
///
/// `tone` defaults to `.neutral`, which is the ordinary quiet button — an ink
/// label inside a `controlBorder` hairline. It used to default to `.accent`,
/// and under Field Console that would have made every secondary button on
/// every screen carry the one interaction signal, which is precisely how a
/// signal stops signalling. The orange belongs to ``PrimaryButtonStyle``, one
/// per screen.
///
/// Pass `.negative` for a destructive action like a plant's Delete, so its
/// label reads red without a second button style to maintain.
public struct SecondaryButtonStyle: ButtonStyle {
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumHeight
    @Environment(\.isEnabled) private var isEnabled
    private let tone: Tone

    public init(tone: Tone = .neutral) {
        self.tone = tone
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(FieldConsoleType.body.font.weight(.medium))
            // A neutral button's label is ink, not muted ink: `Tone.neutral`'s
            // foreground is right for a chip's caption and too quiet to read
            // as the words of a control.
            .foregroundStyle(tone == .neutral ? Palette.text : tone.foreground)
            .padding(.horizontal, Metrics.space4)
            .frame(minHeight: minimumHeight)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                    .fill(Palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                    .strokeBorder(
                        tone == .neutral ? Palette.controlBorder : tone.foreground,
                        lineWidth: Metrics.hairline
                    )
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.82 : 1) : 0.45)
    }
}

/// A compact icon-and-label control that sits in a row of its peers.
///
/// The dense alternative to a stack of full-width buttons: a symbol above a
/// one-word label, in a target that still clears 44 points in both dimensions
/// however small the symbol is drawn.
public struct CompactActionButton: View {
    private let symbol: String
    private let title: String
    private let tone: Tone
    private let action: () -> Void

    @ScaledSize(Metrics.minimumTouchTarget) private var minimumSize

    public init(symbol: String, title: String, tone: Tone = .neutral, action: @escaping () -> Void) {
        self.symbol = symbol
        self.title = title
        self.tone = tone
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: Metrics.space1) {
                Image(systemName: symbol)
                    .font(FieldConsoleType.detail.font)
                    .imageScale(.medium)
                    .symbolRenderingMode(.hierarchical)
                Text(title)
                    .font(FieldConsoleType.detail.font)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(tone.foreground)
            .frame(maxWidth: .infinity, minHeight: minimumSize)
            .padding(.vertical, Metrics.space2)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                    .fill(tone.quietFill)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}
