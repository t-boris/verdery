import Foundation

/// Converts between a `Date` (what SwiftUI's `DatePicker` needs) and the
/// plain calendar-date string (`"yyyy-MM-dd"`) the contract's
/// `Plant.acquisitionDate` and `GardenTask.dueDate` fields carry — see
/// `Plant`'s doc comment for why those fields are `String`, not `Date`, at
/// the domain layer. Shared by `FeaturePlants` and `FeatureTasks`, neither of
/// which may depend on the other, so this lives in `CoreDomain` instead of
/// being duplicated in both.
public enum CalendarDate {
    public static func string(from date: Date) -> String {
        formatter.string(from: date)
    }

    public static func date(from string: String) -> Date? {
        formatter.date(from: string)
    }

    /// Not a stored `static let`: `DateFormatter` is not `Sendable`, so a
    /// shared stored instance is a Swift 6 concurrency error — the same
    /// reason `ISO8601DateFormatter+Contract.swift` computes its formatters
    /// rather than storing them.
    private static var formatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}
