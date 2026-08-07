import SwiftUI

/// A continuous value, set by dragging across it.
///
/// Not `Slider`. The two do the same job, and the difference is the same one
/// `SegmentedRail` makes against a segmented `Picker`: the track, the thumb,
/// the tint and the type here belong to this application rather than to UIKit,
/// so a control on a charcoal chassis does not arrive wearing the system's
/// default blue.
///
/// The figure is always shown. A bare track answers "roughly where" and never
/// "what value", and somebody adjusting a plan's transparency wants to be able
/// to come back to the number they liked.
///
/// The drag has an accessible equivalent because a drag with none is a control
/// that does not exist for a VoiceOver reader — the same rule ``CompassDial``
/// and ``MeasureField`` follow.
public struct ValueDial: View {
    private let fieldName: String
    private let valueText: String
    @Binding private var value: Double
    private let range: ClosedRange<Double>
    private let step: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(Metrics.space5) private var trackHeight
    @ScaledSize(Metrics.space4) private var knobSize

    public init(
        fieldName: String,
        valueText: String,
        value: Binding<Double>,
        range: ClosedRange<Double> = 0...1,
        step: Double = 0.05
    ) {
        self.fieldName = fieldName
        self.valueText = valueText
        _value = value
        self.range = range
        self.step = step
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            HStack {
                Text(fieldName)
                    .textCase(.uppercase)
                    .font(FieldConsoleType.label.font)
                    .foregroundStyle(Palette.textMuted)
                Spacer(minLength: Metrics.space2)
                Text(valueText)
                    .font(FieldConsoleType.monoStrong.font)
                    .foregroundStyle(Palette.text)
            }

            track
                .frame(height: trackHeight)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(fieldName)
                .accessibilityValue(valueText)
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: adjust(by: step)
                    case .decrement: adjust(by: -step)
                    @unknown default: break
                    }
                }
        }
    }

    private var track: some View {
        GeometryReader { proxy in
            let width = max(proxy.size.width, 1)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Palette.surfaceSunken)
                    .overlay(
                        Capsule().strokeBorder(Palette.border, lineWidth: Metrics.hairline)
                    )
                Capsule()
                    .fill(Palette.interactionQuiet)
                    .frame(width: width * fraction)
                Circle()
                    .fill(Palette.interaction)
                    .frame(width: knobSize, height: knobSize)
                    .offset(x: (width - knobSize) * fraction)
            }
            .animation(Motion.quick(reduceMotion), value: value)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { gesture in
                        set(fromX: gesture.location.x, width: width)
                    }
            )
        }
    }

    private var fraction: Double {
        let span = range.upperBound - range.lowerBound
        guard span > 0 else { return 0 }
        return min(max((value - range.lowerBound) / span, 0), 1)
    }

    private func set(fromX x: Double, width: Double) {
        let span = range.upperBound - range.lowerBound
        let raw = range.lowerBound + (x / width) * span
        // Snapped to the step so a long drag cannot leave a value like
        // 0.6500000000000001, which would then be shown and stored.
        let snapped = (raw / step).rounded() * step
        value = min(max(snapped, range.lowerBound), range.upperBound)
    }

    private func adjust(by delta: Double) {
        value = min(max(value + delta, range.lowerBound), range.upperBound)
    }
}
