import Foundation

/// One of the dates a person actually picks.
public struct RelativeDayOption: Identifiable, Sendable, Equatable {
    public enum Kind: String, Sendable, Equatable, CaseIterable {
        case today
        case tomorrow
        case thisWeekend
        case nextWeek
    }

    public let kind: Kind
    /// Start of that day, in the given calendar's time zone.
    public let date: Date

    public var id: Kind { kind }
}

/// The shortcuts that stand in front of a calendar.
///
/// Nine times in ten a due date is today, tomorrow, the weekend, or next week,
/// and every one of those was previously three interactions with a wheel. This
/// computes them; ``DateDial`` renders them.
///
/// Pure, and takes its `Calendar` and reference date as parameters rather than
/// reading the clock, which is the only reason any of it is testable: week
/// boundaries, month boundaries, a daylight-saving transition and a
/// Monday-first locale all produce different answers, and none of them can be
/// checked against a function that asks the system what time it is.
public enum RelativeDayOptions {
    /// - Parameters:
    ///   - now: the reference instant.
    ///   - calendar: carries the time zone AND the first weekday, which is
    ///     Sunday in `en_US` and Monday almost everywhere else — so "next
    ///     week" is a different day depending on who is reading.
    public static func options(from now: Date, calendar: Calendar) -> [RelativeDayOption] {
        let today = calendar.startOfDay(for: now)
        var options: [RelativeDayOption] = [.init(kind: .today, date: today)]

        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) {
            // `byAdding:` rather than adding 86 400 seconds: on the day a
            // daylight-saving transition lands, tomorrow is 23 or 25 hours
            // away, and only the calendar knows which.
            options.append(.init(kind: .tomorrow, date: calendar.startOfDay(for: tomorrow)))
        }

        // `nextWeekend` is locale-aware — which days count as the weekend is
        // not universal. Offered only when it is further out than tomorrow,
        // because a chip that duplicates the chip beside it is noise.
        if let weekend = calendar.nextWeekend(startingAfter: today) {
            let weekendStart = calendar.startOfDay(for: weekend.start)
            if let tomorrow = options.first(where: { $0.kind == .tomorrow })?.date,
                weekendStart > tomorrow
            {
                options.append(.init(kind: .thisWeekend, date: weekendStart))
            }
        }

        if let nextWeek = calendar.nextDate(
            after: today,
            matching: DateComponents(weekday: calendar.firstWeekday),
            matchingPolicy: .nextTime
        ) {
            let start = calendar.startOfDay(for: nextWeek)
            if !options.contains(where: { $0.date == start }) {
                options.append(.init(kind: .nextWeek, date: start))
            }
        }

        return options
    }

    /// The days the scrolling rail shows, starting today.
    ///
    /// Bounded rather than infinite: a rail a person can scroll forever is one
    /// they can get lost in, and a date beyond a season is better chosen from
    /// a month.
    public static func rail(
        from now: Date,
        calendar: Calendar,
        days: Int = 60
    ) -> [Date] {
        let today = calendar.startOfDay(for: now)
        return (0..<max(days, 1)).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: today)
        }
    }
}
