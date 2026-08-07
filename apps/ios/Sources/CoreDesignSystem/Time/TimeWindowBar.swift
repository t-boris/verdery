import SwiftUI

/// A span of the day, set by dragging it.
///
/// Replaces the pairs of `DatePicker`s that asked for a start and an end
/// separately — two wheels that could disagree, and that never showed the
/// window as a shape. Here the day is a bar, the window is a segment on it,
/// and moving or resizing it is one gesture.
///
/// Presets below cover most of what anyone means: a job is usually "the
/// morning" rather than 07:12 to 11:34.
public struct TimeWindowBar: View {
    private let fieldName: String
    @Binding private var start: Date
    @Binding private var end: Date
    private let calendar: Calendar
    private let timeText: (Date) -> String
    private let presets: [Preset]

    /// One named part of the day.
    public struct Preset: Identifiable, Sendable {
        public let label: String
        public let symbol: String
        public let startHour: Int
        public let endHour: Int

        public var id: String { label }

        public init(label: String, symbol: String, startHour: Int, endHour: Int) {
            self.label = label
            self.symbol = symbol
            self.startHour = startHour
            self.endHour = endHour
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(Metrics.space6, relativeTo: .body) private var barHeight
    @ScaledSize(Metrics.minimumTouchTarget) private var minimumTarget

    /// Quarter-hour detents. Finer than anybody schedules gardening to, and
    /// coarse enough that a thumb can land on one.
    private static let stepMinutes = 15

    public init(
        fieldName: String,
        start: Binding<Date>,
        end: Binding<Date>,
        calendar: Calendar,
        timeText: @escaping (Date) -> String,
        presets: [Preset] = []
    ) {
        self.fieldName = fieldName
        _start = start
        _end = end
        self.calendar = calendar
        self.timeText = timeText
        self.presets = presets
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            HStack {
                Text(fieldName)
                    .textCase(.uppercase)
                    .font(FieldConsoleType.label.font)
                    .foregroundStyle(Palette.textMuted)
                Spacer(minLength: Metrics.space2)
                Text("\(timeText(start))–\(timeText(end))")
                    .font(FieldConsoleType.monoStrong.font)
                    .foregroundStyle(Palette.text)
                    .contentTransition(.numericText())
            }

            bar

            if !presets.isEmpty {
                FlowRow(spacing: Metrics.space2) {
                    ForEach(presets) { preset in
                        presetChip(preset)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(fieldName)
    }

    private var bar: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let startFraction = fraction(of: start)
            let endFraction = max(fraction(of: end), startFraction)

            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surfaceSunken)

                Capsule()
                    .fill(Palette.interaction)
                    .frame(width: max((endFraction - startFraction) * width, Metrics.space2))
                    .offset(x: startFraction * width)
                    // Dragging the segment body moves the whole window,
                    // keeping its length — which is what "an hour later" means.
                    .gesture(
                        DragGesture()
                            .onChanged { gesture in
                                shift(byFraction: gesture.translation.width / width)
                            }
                    )
            }
            .frame(height: barHeight)
        }
        .frame(height: barHeight)
        // The drag is invisible to VoiceOver, so the same adjustment is
        // offered as an increment the rotor can reach.
        .accessibilityElement()
        .accessibilityLabel(fieldName)
        .accessibilityValue("\(timeText(start))–\(timeText(end))")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: shift(byMinutes: Self.stepMinutes)
            case .decrement: shift(byMinutes: -Self.stepMinutes)
            @unknown default: break
            }
        }
    }

    private func presetChip(_ preset: Preset) -> some View {
        Button {
            withAnimation(Motion.quick(reduceMotion)) { apply(preset) }
        } label: {
            HStack(spacing: Metrics.space1) {
                Image(systemName: preset.symbol).imageScale(.small)
                Text(preset.label)
            }
            .font(FieldConsoleType.secondary.font)
            .foregroundStyle(Palette.text)
            .padding(.horizontal, Metrics.space3)
            .padding(.vertical, Metrics.space2)
            .frame(minHeight: minimumTarget)
            .background(Capsule().fill(Palette.surfaceSunken))
            .overlay(Capsule().strokeBorder(Palette.border, lineWidth: Metrics.hairline))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(preset.label)
    }

    // MARK: - Arithmetic

    /// Where in the day a moment falls, 0 to 1.
    private func fraction(of date: Date) -> Double {
        let midnight = calendar.startOfDay(for: date)
        let seconds = date.timeIntervalSince(midnight)
        return min(max(seconds / 86_400, 0), 1)
    }

    private func apply(_ preset: Preset) {
        let midnight = calendar.startOfDay(for: start)
        start =
            calendar.date(byAdding: .hour, value: preset.startHour, to: midnight) ?? start
        end = calendar.date(byAdding: .hour, value: preset.endHour, to: midnight) ?? end
    }

    private func shift(byFraction fraction: Double) {
        shift(byMinutes: Int((fraction * 24 * 60).rounded()))
    }

    /// Moves both ends together, snapped to the step and clamped to the day,
    /// so a window can never invert or wrap past midnight into yesterday.
    private func shift(byMinutes minutes: Int) {
        let snapped = (Double(minutes) / Double(Self.stepMinutes)).rounded()
            * Double(Self.stepMinutes)
        guard snapped != 0 else { return }

        let midnight = calendar.startOfDay(for: start)
        let length = end.timeIntervalSince(start)
        let proposed = start.addingTimeInterval(snapped * 60)
        let earliest = midnight
        let latest = midnight.addingTimeInterval(86_400 - length)

        start = min(max(proposed, earliest), latest)
        end = start.addingTimeInterval(length)
    }
}
