import SwiftUI

/// One option out of a small closed set, chosen by tapping it.
///
/// The workhorse that replaces `Picker`. Urgency, role, lifecycle stage,
/// symptom severity, fence kind, correction kind — every one of them is a
/// handful of named values, and every one of them was a wheel or a menu that
/// hid its options until tapped. Laid flat, the whole set is readable at once
/// and choosing costs one tap instead of three.
///
/// Selection is marked by an orange ring and a checkmark, never by fill alone:
/// the ring is the mark, the tone keeps saying what the option *is*, and the
/// checkmark carries the state to a reader who cannot see either.
public struct ChoiceChipGrid<Value: Hashable>: View {
    /// One option: the value, what to call it, and the symbol that finds it.
    public struct Option: Identifiable {
        public let value: Value
        public let label: String
        public let symbol: String
        public let tone: Tone

        public var id: Value { value }

        public init(value: Value, label: String, symbol: String, tone: Tone = .neutral) {
            self.value = value
            self.label = label
            self.symbol = symbol
            self.tone = tone
        }
    }

    private let fieldName: String
    private let options: [Option]
    @Binding private var selection: Value

    @ScaledSize(Metrics.minimumTouchTarget) private var minimumTarget

    public init(fieldName: String, options: [Option], selection: Binding<Value>) {
        self.fieldName = fieldName
        self.options = options
        _selection = selection
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Text(fieldName)
                .textCase(.uppercase)
                .font(FieldConsoleType.label.font)
                .foregroundStyle(Palette.textMuted)
                .accessibilityHidden(true)

            // Wrapping at each chip's own width. A grid would size every cell
            // to the widest, which matters here: Russian labels run about 40%
            // longer than their English counterparts, so a fixed column count
            // either clips them or leaves the English layout full of air.
            FlowRow(spacing: Metrics.space2) {
                ForEach(options) { option in
                    chip(option)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(fieldName)
    }

    private func chip(_ option: Option) -> some View {
        let isSelected = option.value == selection
        return Button {
            selection = option.value
        } label: {
            HStack(spacing: Metrics.space1) {
                Image(systemName: option.symbol)
                    .imageScale(.medium)
                Text(option.label)
                    .lineLimit(1)
                if isSelected {
                    Image(systemName: "checkmark")
                        .imageScale(.small)
                }
            }
            .font(FieldConsoleType.secondary.font)
            .foregroundStyle(isSelected ? Palette.text : option.tone.foreground)
            .padding(.horizontal, Metrics.space3)
            .padding(.vertical, Metrics.space2)
            .frame(minHeight: minimumTarget)
            .background(
                Capsule(style: .continuous)
                    .fill(option.tone.quietFill)
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(
                        isSelected ? Palette.interaction : Palette.border,
                        lineWidth: isSelected ? Metrics.focusRingWidth : Metrics.hairline
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .sensoryFeedback(.selection, trigger: isSelected)
    }
}
