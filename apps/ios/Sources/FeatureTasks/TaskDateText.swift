import CoreDesignSystem
import CoreLocalization
import Foundation

/// How a task's dates read.
///
/// The formatters themselves moved to `CoreDesignSystem.CalendarText` when a
/// second feature needed the same four — a duplicated date format is how two
/// screens end up disagreeing about what "6 Aug" means. What stays here is the
/// part that genuinely belongs to a feature: the catalogue words.
enum TaskDateText {
    static func day(_ date: Date) -> String { CalendarText.day(date) }
    static func dayNumber(_ date: Date) -> String { CalendarText.dayNumber(date) }
    static func weekday(_ date: Date) -> String { CalendarText.weekday(date) }
    static func time(_ date: Date) -> String { CalendarText.time(date) }
    static func window(_ start: Date, _ end: Date) -> String {
        CalendarText.window(start, end)
    }

    /// The relative shortcuts, as words rather than as dates. They used to be
    /// rendered with the date formatter, so "Today" appeared as the very date
    /// the chip beneath it already carried.
    static func relativeTitle(
        _ kind: RelativeDayOption.Kind,
        strings: LocalizedStrings
    ) -> String {
        switch kind {
        case .today: strings(.relativeDayToday)
        case .tomorrow: strings(.relativeDayTomorrow)
        case .thisWeekend: strings(.relativeDayThisWeekend)
        case .nextWeek: strings(.relativeDayNextWeek)
        }
    }
}
