import CoreDesignSystem
import Foundation

/// How Today writes a date.
///
/// Formatting belongs beside the feature rather than inside the design
/// system, which depends on nothing and therefore knows nothing about locales
/// — which is why `DateDial` takes these as closures.
enum TodayDateText {
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
        formatter { $0.setLocalizedDateFormatFromTemplate("d") }.string(from: date)
    }

    static func weekday(_ date: Date) -> String {
        formatter { $0.setLocalizedDateFormatFromTemplate("EEE") }.string(from: date)
    }

    static func relativeTitle(_ kind: RelativeDayOption.Kind) -> String {
        switch kind {
        case .today: day(Date())
        case .tomorrow: day(Date().addingTimeInterval(86_400))
        case .thisWeekend: weekday(Date().addingTimeInterval(86_400 * 5))
        case .nextWeek: weekday(Date().addingTimeInterval(86_400 * 7))
        }
    }
}
