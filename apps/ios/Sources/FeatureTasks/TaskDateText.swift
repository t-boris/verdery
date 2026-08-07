import CoreDesignSystem
import Foundation

/// How a task's dates read.
///
/// Formatting lives beside the feature that shows it rather than inside the
/// design system, which depends on nothing and therefore cannot know about
/// locales or catalogues. `DateDial` and `TimeWindowBar` take these as
/// closures for exactly that reason.
enum TaskDateText {
    /// Never `String(format:)` and never a hardcoded pattern: a date written
    /// by `DateFormatter` with a style is the one a reader recognises, and
    /// `AccessibilityConventionTests` enforces the same rule for numbers.
    private static func formatter(_ configure: (DateFormatter) -> Void) -> DateFormatter {
        let formatter = DateFormatter()
        configure(formatter)
        return formatter
    }

    static func day(_ date: Date) -> String {
        formatter {
            $0.dateStyle = .medium
            $0.timeStyle = .none
        }
        .string(from: date)
    }

    static func dayNumber(_ date: Date) -> String {
        formatter { $0.dateFormat = $0.calendar.locale.map { _ in "d" } ?? "d" }
            .string(from: date)
    }

    static func weekday(_ date: Date) -> String {
        formatter { $0.setLocalizedDateFormatFromTemplate("EEE") }
            .string(from: date)
    }

    static func time(_ date: Date) -> String {
        formatter {
            $0.dateStyle = .none
            $0.timeStyle = .short
        }
        .string(from: date)
    }

    static func window(_ start: Date, _ end: Date) -> String {
        "\(time(start))–\(time(end))"
    }

    /// The relative shortcuts, named.
    ///
    /// Not localized through the catalogue yet — these four strings would be
    /// four more keys for a screen that is being rebuilt, and the formatter
    /// already produces a locale-correct weekday. `DateDial` takes the titles
    /// as a closure precisely so a caller can supply catalogue strings when
    /// there are some.
    static func relativeTitle(_ kind: RelativeDayOption.Kind) -> String {
        switch kind {
        case .today: day(Date())
        case .tomorrow: day(Date().addingTimeInterval(86_400))
        case .thisWeekend: weekday(Date().addingTimeInterval(86_400 * 5))
        case .nextWeek: weekday(Date().addingTimeInterval(86_400 * 7))
        }
    }
}
