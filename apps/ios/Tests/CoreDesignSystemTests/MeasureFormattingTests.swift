import CoreDesignSystem
import Foundation
import Testing

/// Reading and writing a measurement in the reader's own convention.
///
/// This guards a real defect rather than a hypothetical one: metres are kept
/// as `String` in the map's property editor and parsed with `Double(_:)`, which
/// accepts only a full stop. A Russian reader typing `3,5` — the separator
/// their own decimal pad offers — produced `nil`, and the edit vanished with
/// no error and no explanation.
@Suite("Measurement formatting")
struct MeasureFormattingTests {
    private let en = Locale(identifier: "en_US")
    private let ru = Locale(identifier: "ru_RU")

    @Test("reads the separator the reader's keyboard actually offers")
    func parsesLocaleSeparator() {
        #expect(MeasureFormatting.parse("3.5", locale: en) == 3.5)
        #expect(MeasureFormatting.parse("3,5", locale: ru) == 3.5)
    }

    /// A value can arrive from somewhere that is not a keyboard — a paste, a
    /// record stored under another locale, a plan read in another region — and
    /// refusing a number that is plainly readable helps nobody.
    @Test("still reads the other separator, whichever locale is in force")
    func parsesForeignSeparator() {
        #expect(MeasureFormatting.parse("3,5", locale: en) == 3.5)
        #expect(MeasureFormatting.parse("3.5", locale: ru) == 3.5)
    }

    @Test("refuses what is not a number rather than guessing")
    func rejectsNonNumbers() {
        #expect(MeasureFormatting.parse("", locale: en) == nil)
        #expect(MeasureFormatting.parse("   ", locale: en) == nil)
        #expect(MeasureFormatting.parse("wide", locale: en) == nil)
    }

    @Test("writes with the reader's separator, never a POSIX one")
    func formatsForTheReader() {
        #expect(MeasureFormatting.format(3.5, fractionDigits: 2, locale: en) == "3.5")
        #expect(MeasureFormatting.format(3.5, fractionDigits: 2, locale: ru) == "3,5")
    }

    /// The round trip is the property that matters: what a reader sees, typed
    /// back in, must be the same number.
    @Test("round-trips in both languages")
    func roundTrips() {
        for locale in [en, ru] {
            for value in [0.0, 0.05, 1.8, 24.65, 999.99] {
                let written = MeasureFormatting.format(value, fractionDigits: 2, locale: locale)
                let read = MeasureFormatting.parse(written, locale: locale)
                #expect(read == value, "\(value) did not survive \(locale.identifier)")
            }
        }
    }

    /// A long drag applies many single steps. Without rounding to the step,
    /// repeated addition of 0.1 reaches 1.7999999999999998 — which would then
    /// be displayed, stored, and compared against a revision.
    @Test("keeps a dragged value on the step")
    func nudgingStaysOnTheStep() {
        var value = 0.0
        for _ in 0..<18 {
            value = MeasureFormatting.nudged(value, by: 1, step: 0.1)
        }
        #expect(MeasureFormatting.format(value, fractionDigits: 2, locale: en) == "1.8")
        #expect(MeasureFormatting.nudged(1.8, by: -3, step: 0.1) == 1.5)
    }
}
