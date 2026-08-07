/// The four shortcuts on a date dial.
///
/// Their own key set because two features now show the same dial, and the words
/// have to match: a "Tomorrow" chip on the task sheet and a date on the plant
/// sheet would be the same control saying two different things.
///
/// They were previously not localized at all — the dial rendered a formatted
/// date where a word belonged, so "Today" read as "7 Aug 2026" beside a chip
/// captioned with the same date.
public enum RelativeDayLocalizationKey: String, Sendable, CaseIterable {
    case relativeDayToday = "relativeDay.today"
    case relativeDayTomorrow = "relativeDay.tomorrow"
    case relativeDayThisWeekend = "relativeDay.thisWeekend"
    case relativeDayNextWeek = "relativeDay.nextWeek"
}
