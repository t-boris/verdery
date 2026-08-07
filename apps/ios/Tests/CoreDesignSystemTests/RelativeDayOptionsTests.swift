import CoreDesignSystem
import Foundation
import Testing

/// The date shortcuts, across the boundaries that break naive arithmetic.
///
/// Every one of these is a case where "add 86 400 seconds" or "Saturday is
/// weekday 7" gives the wrong answer for some reader somewhere, and none of
/// them is reachable by a function that asks the system what time it is —
/// which is why `RelativeDayOptions` takes its clock and calendar as
/// parameters.
@Suite("Relative day options")
struct RelativeDayOptionsTests {
    private func calendar(
        _ identifier: String,
        timeZone: String = "America/Chicago"
    ) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: identifier)
        calendar.timeZone = TimeZone(identifier: timeZone) ?? .gmt
        calendar.firstWeekday = identifier.hasPrefix("ru") ? 2 : 1
        return calendar
    }

    private func date(_ iso: String, in calendar: Calendar) -> Date {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: iso) ?? .distantPast
    }

    @Test("always offers today and tomorrow, in that order")
    func todayAndTomorrowComeFirst() {
        let calendar = calendar("en_US")
        let options = RelativeDayOptions.options(
            from: date("2026-08-11 09:00", in: calendar), calendar: calendar
        )
        #expect(options.first?.kind == .today)
        #expect(options.dropFirst().first?.kind == .tomorrow)
    }

    /// A chip that means the same day as the chip beside it is noise, so the
    /// weekend disappears on the days it would duplicate.
    @Test("drops the weekend chip when the weekend is already today or tomorrow")
    func weekendIsOmittedWhenRedundant() {
        let calendar = calendar("en_US")
        // Friday: Saturday is tomorrow, so "this weekend" says nothing new.
        let friday = RelativeDayOptions.options(
            from: date("2026-08-14 09:00", in: calendar), calendar: calendar
        )
        #expect(!friday.contains { $0.kind == .thisWeekend })

        // Tuesday: the weekend is genuinely further out.
        let tuesday = RelativeDayOptions.options(
            from: date("2026-08-11 09:00", in: calendar), calendar: calendar
        )
        #expect(tuesday.contains { $0.kind == .thisWeekend })
    }

    /// "Next week" starts on a different day depending on who is reading:
    /// Sunday in the United States, Monday almost everywhere else.
    @Test("starts next week on the reader's own first weekday")
    func nextWeekFollowsTheLocale() {
        for (identifier, expectedWeekday) in [("en_US", 1), ("ru_RU", 2)] {
            let calendar = calendar(identifier)
            let options = RelativeDayOptions.options(
                from: date("2026-08-11 09:00", in: calendar), calendar: calendar
            )
            guard let nextWeek = options.first(where: { $0.kind == .nextWeek }) else {
                Issue.record("\(identifier) offered no next-week option")
                continue
            }
            #expect(calendar.component(.weekday, from: nextWeek.date) == expectedWeekday)
        }
    }

    /// The day a clock springs forward is 23 hours long. Adding a day's worth
    /// of seconds lands at 23:00 the previous evening, and `startOfDay` then
    /// silently returns the wrong date.
    @Test("crosses a daylight-saving transition without losing a day")
    func survivesDaylightSaving() {
        let calendar = calendar("en_US")
        // US clocks move forward on 8 March 2026.
        let options = RelativeDayOptions.options(
            from: date("2026-03-07 09:00", in: calendar), calendar: calendar
        )
        let today = options.first { $0.kind == .today }?.date
        let tomorrow = options.first { $0.kind == .tomorrow }?.date
        #expect(calendar.component(.day, from: today ?? .distantPast) == 7)
        #expect(calendar.component(.day, from: tomorrow ?? .distantPast) == 8)
    }

    @Test("crosses a month boundary")
    func survivesMonthBoundary() {
        let calendar = calendar("en_US")
        let options = RelativeDayOptions.options(
            from: date("2026-08-31 09:00", in: calendar), calendar: calendar
        )
        let tomorrow = options.first { $0.kind == .tomorrow }?.date
        #expect(calendar.component(.month, from: tomorrow ?? .distantPast) == 9)
        #expect(calendar.component(.day, from: tomorrow ?? .distantPast) == 1)
    }

    /// Bounded on purpose: a rail that scrolls forever is one a reader can get
    /// lost in, and a date a season away belongs in a month view.
    @Test("offers a bounded rail of consecutive days from today")
    func railIsBoundedAndConsecutive() {
        let calendar = calendar("en_US")
        let days = RelativeDayOptions.rail(
            from: date("2026-08-11 09:00", in: calendar), calendar: calendar, days: 5
        )
        #expect(days.count == 5)
        for (index, day) in days.enumerated() {
            let expected = calendar.date(byAdding: .day, value: index, to: days[0])
            #expect(day == expected)
        }
    }
}
