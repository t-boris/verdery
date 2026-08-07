import SwiftUI

/// A value that may or may not be there, and the editor for it.
///
/// This replaces every `Toggle` in the application, and every `DatePicker` each
/// one was gating. All eleven of them were named `hasSomething`, and all eleven
/// were followed by a conditionally-revealed picker — so none of them was a
/// boolean at all. They were the presence of an optional value, wearing a
/// switch, split across two controls that had to agree.
///
/// Unset, this is a dashed outline and an invitation. Set, it is the value
/// itself with a way to clear it. Either way it is one thing, and the state is
/// carried by shape and by content, never by a switch position.
public struct OptionalValueCard<Editor: View>: View {
    private let fieldName: String
    private let addPrompt: String
    private let clearLabel: String
    private let symbol: String
    /// The value as a person reads it, or `nil` when there is none.
    private let displayValue: String?
    private let clear: () -> Void
    private let editor: () -> Editor

    @State private var isEditing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumTarget

    public init(
        fieldName: String,
        addPrompt: String,
        clearLabel: String,
        symbol: String,
        displayValue: String?,
        clear: @escaping () -> Void,
        @ViewBuilder editor: @escaping () -> Editor
    ) {
        self.fieldName = fieldName
        self.addPrompt = addPrompt
        self.clearLabel = clearLabel
        self.symbol = symbol
        self.displayValue = displayValue
        self.clear = clear
        self.editor = editor
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            if let displayValue {
                setRow(displayValue)
                if isEditing { editor() }
            } else if isEditing {
                editor()
            } else {
                unsetRow
            }
        }
        .padding(Metrics.space3)
        .background(
            RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                .fill(displayValue == nil ? Palette.canvas : Palette.surface)
        )
        .overlay(outline)
        .animation(Motion.settle(reduceMotion), value: isEditing)
        .animation(Motion.settle(reduceMotion), value: displayValue)
    }

    private var unsetRow: some View {
        Button {
            isEditing = true
        } label: {
            HStack(spacing: Metrics.space2) {
                Image(systemName: "plus.circle")
                    .imageScale(.medium)
                Text(addPrompt)
                    .font(FieldConsoleType.body.font)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Palette.textMuted)
            .frame(minHeight: minimumTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(addPrompt)
    }

    private func setRow(_ value: String) -> some View {
        HStack(spacing: Metrics.space2) {
            Button {
                isEditing.toggle()
            } label: {
                HStack(spacing: Metrics.space2) {
                    Image(systemName: symbol)
                        .imageScale(.medium)
                        .foregroundStyle(Palette.textMuted)
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(fieldName)
                            .textCase(.uppercase)
                            .font(FieldConsoleType.label.font)
                            .foregroundStyle(Palette.textMuted)
                        Text(value)
                            .font(FieldConsoleType.metric.font)
                            .foregroundStyle(Palette.text)
                            .contentTransition(.numericText())
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: minimumTarget)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(fieldName): \(value)")

            Button {
                isEditing = false
                clear()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .imageScale(.medium)
                    .foregroundStyle(Palette.textMuted)
                    .frame(minWidth: minimumTarget, minHeight: minimumTarget)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(clearLabel)
        }
    }

    /// Dashed while empty, solid once filled: the outline says "there could be
    /// something here" without spending a colour on it.
    @ViewBuilder
    private var outline: some View {
        let shape = RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
        if displayValue == nil {
            shape.strokeBorder(
                Palette.controlBorder,
                style: StrokeStyle(lineWidth: Metrics.hairline, dash: [4, 4])
            )
        } else {
            shape.strokeBorder(Palette.border, lineWidth: Metrics.hairline)
        }
    }
}
