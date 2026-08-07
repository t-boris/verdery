import SwiftUI

/// A measured quantity: a big numeral, its unit, and three ways to change it.
///
/// A card rather than a text box. **Dragging horizontally anywhere on the
/// card** nudges the value a step at a time with a tick of feedback per step,
/// which for a gloved hand in a garden beats a keypad; **tapping the numeral**
/// raises the system decimal pad for someone who already knows the number; and
/// the −/+ buttons cover both the precise case and every reader who cannot
/// drag.
///
/// The keyboard is one of the few native controls kept deliberately: only it
/// respects the reader's locale separator, their third-party keyboard, and
/// dictation. What is discarded is its chrome — the numeral IS the field,
/// drawn in the mono display face with no box around it.
public struct MeasureField: View {
    private let fieldName: String
    private let unitLabel: String
    private let decreaseLabel: String
    private let increaseLabel: String
    @Binding private var value: Double
    private let step: Double
    private let range: ClosedRange<Double>
    private let fractionDigits: Int
    private let locale: Locale

    @State private var editedText: String
    @State private var dragSteps: Int = 0
    @FocusState private var isTyping: Bool
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumTarget

    /// Screen points of drag per step. Wide enough that a scrolling gesture
    /// does not silently retune a dimension.
    private static let pointsPerStep: CGFloat = 12

    public init(
        fieldName: String,
        unitLabel: String,
        decreaseLabel: String,
        increaseLabel: String,
        value: Binding<Double>,
        step: Double = 0.1,
        range: ClosedRange<Double> = 0...10_000,
        fractionDigits: Int = 2,
        locale: Locale
    ) {
        self.fieldName = fieldName
        self.unitLabel = unitLabel
        self.decreaseLabel = decreaseLabel
        self.increaseLabel = increaseLabel
        _value = value
        self.step = step
        self.range = range
        self.fractionDigits = fractionDigits
        self.locale = locale
        _editedText = State(
            initialValue: MeasureFormatting.format(
                value.wrappedValue, fractionDigits: fractionDigits, locale: locale
            )
        )
    }

    private var formatted: String {
        MeasureFormatting.format(value, fractionDigits: fractionDigits, locale: locale)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Text(fieldName)
                .textCase(.uppercase)
                .font(FieldConsoleType.label.font)
                .foregroundStyle(Palette.textMuted)
                .accessibilityHidden(true)

            HStack(alignment: .firstTextBaseline, spacing: Metrics.space2) {
                nudgeButton(symbol: "minus", label: decreaseLabel, steps: -1)
                numeral
                Text(unitLabel)
                    .font(FieldConsoleType.mono.font)
                    .foregroundStyle(Palette.textMuted)
                Spacer(minLength: 0)
                nudgeButton(symbol: "plus", label: increaseLabel, steps: 1)
            }
        }
        .padding(Metrics.space3)
        .background(
            RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                .fill(Palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                .strokeBorder(Palette.controlBorder, lineWidth: Metrics.hairline)
        )
        .contentShape(Rectangle())
        // On the card, not on the numeral: a bigger target, and it leaves the
        // numeral's own tap free to mean "let me type it".
        .simultaneousGesture(dragToNudge)
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(fieldName)
    }

    /// The numeral is the field. No box, no placeholder chrome — a mono
    /// display face that happens to accept a caret.
    private var numeral: some View {
        TextField(fieldName, text: $editedText)
            .textFieldStyle(.plain)
            .font(FieldConsoleType.metricLarge.font)
            .foregroundStyle(Palette.text)
            .decimalKeyboard()
            .focused($isTyping)
            .fixedSize(horizontal: true, vertical: false)
            .frame(minHeight: minimumTarget)
            .contentTransition(.numericText())
            .onChange(of: isTyping, commitOnBlur)
            .onChange(of: value) { _, _ in
                // While a value changes underneath — a drag, a nudge, an
                // outside edit — the text follows it, unless the reader is
                // mid-word, in which case theirs wins.
                if !isTyping { editedText = formatted }
            }
            .accessibilityLabel(fieldName)
            .accessibilityValue("\(formatted) \(unitLabel)")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: apply(steps: 1)
                case .decrement: apply(steps: -1)
                @unknown default: break
                }
            }
    }

    /// Commits when the caret leaves, not on every keystroke: a half-typed
    /// "3," is not a number, and clamping mid-word would fight the reader.
    private func commitOnBlur(_ wasTyping: Bool, _ isTyping: Bool) {
        guard wasTyping, !isTyping else { return }
        if let parsed = MeasureFormatting.parse(editedText, locale: locale) {
            value = min(max(parsed, range.lowerBound), range.upperBound)
        }
        editedText = formatted
    }

    private var dragToNudge: some Gesture {
        DragGesture(minimumDistance: Self.pointsPerStep)
            .onChanged { gesture in
                let steps = Int((gesture.translation.width / Self.pointsPerStep).rounded(.towardZero))
                guard steps != dragSteps else { return }
                apply(steps: steps - dragSteps)
                dragSteps = steps
            }
            .onEnded { _ in dragSteps = 0 }
    }

    private func nudgeButton(symbol: String, label: String, steps: Int) -> some View {
        Button { apply(steps: steps) } label: {
            Image(systemName: symbol)
                .imageScale(.medium)
                .foregroundStyle(Palette.textMuted)
                .frame(minWidth: minimumTarget, minHeight: minimumTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func apply(steps: Int) {
        let next = MeasureFormatting.nudged(value, by: steps, step: step)
        value = min(max(next, range.lowerBound), range.upperBound)
    }
}

extension View {
    /// `keyboardType` is UIKit-backed and absent from the headless macOS build
    /// this package also compiles for — the same `#if` shape
    /// `inlineNavigationTitle()` uses for `navigationBarTitleDisplayMode`.
    fileprivate func decimalKeyboard() -> some View {
        #if os(iOS)
        return keyboardType(.decimalPad)
        #else
        return self
        #endif
    }
}
