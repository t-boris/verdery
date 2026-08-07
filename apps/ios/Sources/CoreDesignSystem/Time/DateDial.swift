import SwiftUI

/// Picking a day, without a wheel.
///
/// Two rows. Relative chips answer the common case in one tap — today,
/// tomorrow, the weekend, next week. Under them a horizontally scrolling rail
/// of days snaps to whichever cell is under the thumb, with a detent of haptic
/// feedback each time one crosses, so a date can be dialled in without looking
/// closely at the screen. That matters outdoors more than it does at a desk.
///
/// The chosen day is stated large above both, in the mono face and with a
/// numeric transition, so it changes visibly while a thumb is moving.
public struct DateDial: View {
    private let fieldName: String
    private let chipTitle: (RelativeDayOption.Kind) -> String
    private let dayNumber: (Date) -> String
    private let weekdayName: (Date) -> String
    private let longDate: (Date) -> String
    @Binding private var selection: Date
    private let now: Date
    private let calendar: Calendar

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(Metrics.minimumTouchTarget) private var cellWidth
    @ScaledSize(Metrics.space8) private var railHeight

    public init(
        fieldName: String,
        selection: Binding<Date>,
        now: Date,
        calendar: Calendar,
        chipTitle: @escaping (RelativeDayOption.Kind) -> String,
        dayNumber: @escaping (Date) -> String,
        weekdayName: @escaping (Date) -> String,
        longDate: @escaping (Date) -> String
    ) {
        self.fieldName = fieldName
        _selection = selection
        self.now = now
        self.calendar = calendar
        self.chipTitle = chipTitle
        self.dayNumber = dayNumber
        self.weekdayName = weekdayName
        self.longDate = longDate
    }

    private var options: [RelativeDayOption] {
        RelativeDayOptions.options(from: now, calendar: calendar)
    }

    private var rail: [Date] {
        RelativeDayOptions.rail(from: now, calendar: calendar)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            header
            chips
            railView
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(fieldName)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: Metrics.space2) {
            Text(fieldName)
                .textCase(.uppercase)
                .font(FieldConsoleType.label.font)
                .foregroundStyle(Palette.textMuted)
            Spacer(minLength: Metrics.space2)
            Text(longDate(selection))
                .font(FieldConsoleType.metric.font)
                .foregroundStyle(Palette.text)
                .contentTransition(.numericText())
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(fieldName): \(longDate(selection))")
    }

    private var chips: some View {
        FlowRow(spacing: Metrics.space2) {
            ForEach(options) { option in
                let isSelected = calendar.isDate(selection, inSameDayAs: option.date)
                Button {
                    withAnimation(Motion.quick(reduceMotion)) { selection = option.date }
                } label: {
                    Text(chipTitle(option.kind))
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.text)
                        .padding(.horizontal, Metrics.space3)
                        .padding(.vertical, Metrics.space2)
                        .frame(minHeight: cellWidth)
                        .background(Capsule(style: .continuous).fill(Palette.surfaceSunken))
                        .overlay(
                            Capsule(style: .continuous)
                                .strokeBorder(
                                    isSelected ? Palette.interaction : Palette.border,
                                    lineWidth: isSelected ? Metrics.focusRingWidth : Metrics.hairline
                                )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(chipTitle(option.kind))
                .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            }
        }
    }

    private var railView: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Metrics.space1) {
                ForEach(rail, id: \.self) { day in
                    dayCell(day)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .frame(height: railHeight)
        // The physical detent under the thumb: one tick per day crossed, so
        // the rail can be dialled without reading it.
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func dayCell(_ day: Date) -> some View {
        let isSelected = calendar.isDate(selection, inSameDayAs: day)
        return Button {
            withAnimation(Motion.quick(reduceMotion)) { selection = day }
        } label: {
            VStack(spacing: Metrics.space1) {
                Text(dayNumber(day))
                    .font(FieldConsoleType.monoStrong.font)
                Text(weekdayName(day))
                    .textCase(.uppercase)
                    .font(FieldConsoleType.label.font)
            }
            .foregroundStyle(isSelected ? Palette.interactionText : Palette.text)
            .frame(width: cellWidth)
            .padding(.vertical, Metrics.space2)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                    .fill(isSelected ? Palette.interaction : Palette.surfaceSunken)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(longDate(day))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
