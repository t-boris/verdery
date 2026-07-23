import Foundation
import Testing

@testable import CoreDomain

@Suite("Calendar date")
struct CalendarDateTests {
    @Test("A date round-trips through string(from:) and date(from:) to the same calendar day")
    func roundTrips() {
        var components = DateComponents()
        components.year = 2026
        components.month = 7
        components.day = 21
        let calendar = Calendar(identifier: .iso8601)
        let date = calendar.date(from: components)!

        let text = CalendarDate.string(from: date)
        #expect(text == "2026-07-21")

        let roundTripped = CalendarDate.date(from: text)
        #expect(roundTripped.map(CalendarDate.string(from:)) == text)
    }

    @Test("An invalid string fails to parse rather than producing a garbage date")
    func invalidStringFailsToParse() {
        #expect(CalendarDate.date(from: "not-a-date") == nil)
        #expect(CalendarDate.date(from: "") == nil)
    }

    @Test("A single-digit month and day are zero-padded")
    func zeroPadsSingleDigits() {
        var components = DateComponents()
        components.year = 2026
        components.month = 1
        components.day = 5
        let calendar = Calendar(identifier: .iso8601)
        let date = calendar.date(from: components)!

        #expect(CalendarDate.string(from: date) == "2026-01-05")
    }
}
