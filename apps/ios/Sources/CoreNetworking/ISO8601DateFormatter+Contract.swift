import Foundation

/// The two RFC 3339 shapes the API can emit. `ISO8601DateFormatter` cannot
/// parse both forms with one set of options, so decoding tries the common
/// case (with milliseconds) first and falls back to the other.
///
/// Computed, not a stored `static let`: `ISO8601DateFormatter` is not
/// `Sendable`, so a shared stored instance is a Swift 6 concurrency error.
/// Constructing one per decode is cheap relative to the network round trip
/// it decodes the response of.
extension ISO8601DateFormatter {
    static var withFractionalSeconds: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    static var withoutFractionalSeconds: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }
}
