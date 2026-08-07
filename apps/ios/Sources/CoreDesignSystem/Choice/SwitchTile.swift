import SwiftUI

/// A genuine yes-or-no, as a card rather than a switch.
///
/// Eleven of this application's twelve `Toggle`s turned out not to be booleans
/// at all — they were the presence of an optional value, gating a hidden date
/// picker, which is what ``OptionalValueCard`` replaced. This is for the few
/// that really are: include the photographs or do not; show this map layer or
/// do not.
///
/// State is carried by a symbol pair and a fill, never by a switch position,
/// so it survives greyscale and reads at a glance from arm's length.
public struct SwitchTile: View {
    private let title: String
    private let explanation: String?
    private let onSymbol: String
    private let offSymbol: String
    @Binding private var isOn: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumTarget

    public init(
        title: String,
        explanation: String? = nil,
        onSymbol: String,
        offSymbol: String,
        isOn: Binding<Bool>
    ) {
        self.title = title
        self.explanation = explanation
        self.onSymbol = onSymbol
        self.offSymbol = offSymbol
        _isOn = isOn
    }

    public var body: some View {
        Button {
            withAnimation(Motion.quick(reduceMotion)) { isOn.toggle() }
        } label: {
            HStack(alignment: .top, spacing: Metrics.space3) {
                Image(systemName: isOn ? onSymbol : offSymbol)
                    .imageScale(.large)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(isOn ? Palette.interaction : Palette.textMuted)
                    .frame(minWidth: minimumTarget, minHeight: minimumTarget)

                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(title)
                        .font(FieldConsoleType.bodyStrong.font)
                        .foregroundStyle(Palette.text)
                    if let explanation {
                        Text(explanation)
                            .font(FieldConsoleType.secondary.font)
                            .foregroundStyle(Palette.textMuted)
                            .multilineTextAlignment(.leading)
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .imageScale(.medium)
                    .foregroundStyle(isOn ? Palette.interaction : Palette.border)
            }
            .padding(Metrics.space3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                    .fill(isOn ? Palette.interactionQuiet : Palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                    .strokeBorder(
                        isOn ? Palette.interactionQuietBorder : Palette.border,
                        lineWidth: Metrics.hairline
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(explanation ?? "")
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
        .sensoryFeedback(.selection, trigger: isOn)
    }
}
