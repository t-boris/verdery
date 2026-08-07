import SwiftUI

/// One value from a short ordered scale.
///
/// For the cases where the options are not merely different but *ranked* —
/// urgency low/normal/high, severity mild/moderate/severe, the plants list's
/// identified filter. Laying a scale flat, in order, lets someone read the
/// range and their position in it at once, which a menu cannot do.
///
/// Not `Picker(.segmented)`: that control's chrome, type and tint belong to
/// the system, and this one has to sit inside Field Console's own surfaces.
/// The moving indicator is ours, so it can use the interaction colour and the
/// design system's motion — including its Reduce Motion contract.
public struct SegmentedRail<Value: Hashable>: View {
    public struct Option: Identifiable {
        public let value: Value
        public let label: String
        public let symbol: String

        public var id: Value { value }

        public init(value: Value, label: String, symbol: String) {
            self.value = value
            self.label = label
            self.symbol = symbol
        }
    }

    private let fieldName: String
    private let options: [Option]
    @Binding private var selection: Value

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var indicator
    @ScaledSize(Metrics.minimumTouchTarget) private var railHeight

    public init(fieldName: String, options: [Option], selection: Binding<Value>) {
        self.fieldName = fieldName
        self.options = options
        _selection = selection
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                segment(option)
            }
        }
        .padding(Metrics.space1)
        .frame(minHeight: railHeight)
        .background(
            Capsule(style: .continuous)
                .fill(Palette.surfaceSunken)
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(Palette.border, lineWidth: Metrics.hairline)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(fieldName)
    }

    private func segment(_ option: Option) -> some View {
        let isSelected = option.value == selection
        return Button {
            withAnimation(Motion.quick(reduceMotion)) {
                selection = option.value
            }
        } label: {
            HStack(spacing: Metrics.space1) {
                Image(systemName: option.symbol)
                    .imageScale(.small)
                Text(option.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .font(FieldConsoleType.secondary.font)
            .foregroundStyle(isSelected ? Palette.interactionText : Palette.textMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Metrics.space2)
            .background {
                if isSelected {
                    Capsule(style: .continuous)
                        .fill(Palette.interaction)
                        // One shape moving between segments rather than two
                        // fading, so the rail reads as a position on a scale.
                        .matchedGeometryEffect(id: "railIndicator", in: indicator)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .sensoryFeedback(.selection, trigger: isSelected)
    }
}
