import SwiftUI

/// The filled brand button: one per screen, for the action the screen exists
/// to perform.
public struct PrimaryButtonStyle: ButtonStyle {
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumHeight
    @Environment(\.isEnabled) private var isEnabled

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typography.body.weight(.semibold))
            .foregroundStyle(Palette.accentText)
            .padding(.horizontal, Metrics.space4)
            .frame(minHeight: minimumHeight)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                    .fill(Palette.accent)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.82 : 1) : 0.45)
    }
}

/// The outlined button: everything else that is a full-width commitment.
///
/// `tone` defaults to `.accent` (every existing call site's unchanged look);
/// pass `.negative` for a destructive action like a plant's Delete, so its
/// label reads red without a second button style to maintain.
public struct SecondaryButtonStyle: ButtonStyle {
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumHeight
    @Environment(\.isEnabled) private var isEnabled
    private let tone: Tone

    public init(tone: Tone = .accent) {
        self.tone = tone
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typography.body.weight(.medium))
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, Metrics.space4)
            .frame(minHeight: minimumHeight)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                    .fill(Palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                    .strokeBorder(tone == .accent ? Palette.controlBorder : tone.foreground, lineWidth: Metrics.hairline)
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

    public init(symbol: String, title: String, tone: Tone = .accent, action: @escaping () -> Void) {
        self.symbol = symbol
        self.title = title
        self.tone = tone
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: Metrics.space1) {
                Image(systemName: symbol)
                    .font(Typography.detail)
                    .imageScale(.medium)
                    .symbolRenderingMode(.hierarchical)
                Text(title)
                    .font(Typography.micro)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(tone.foreground)
            .frame(maxWidth: .infinity, minHeight: minimumSize)
            .padding(.vertical, Metrics.space2)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                    .fill(tone.quietFill)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}
