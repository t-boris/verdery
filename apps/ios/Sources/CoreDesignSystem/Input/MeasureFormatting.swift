import Foundation

/// Reading and writing a measured number the way the reader writes it.
///
/// Separated from the control that shows it because this is where a real bug
/// lives. `MapObjectPropertyView` keeps metres as `String` and round-trips
/// them through `Double(_:)`, which accepts only a full stop. A Russian
/// reader typing `3,5` on the decimal pad — the separator their keyboard
/// offers — produced `nil`, and the edit was silently dropped.
///
/// Both directions take a `Locale` explicitly rather than reading the current
/// one, so the round trip can be asserted in more than the developer's own
/// language.
public enum MeasureFormatting {
    /// Accepts either separator regardless of locale.
    ///
    /// The formatter is asked first, so the reader's own convention always
    /// wins. The fallback exists because a value can arrive from somewhere
    /// that is not a keyboard — a pasted string, a value stored under a
    /// different locale, a plan read in another region — and refusing a number
    /// this function can plainly understand helps nobody.
    public static func parse(_ text: String, locale: Locale) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }

        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        if let number = formatter.number(from: trimmed) {
            return number.doubleValue
        }

        let normalized = trimmed.replacingOccurrences(of: ",", with: ".")
        return Double(normalized)
    }

    /// Writes a number with the reader's own separator.
    ///
    /// Never `String(format:)`, which is POSIX and would print a full stop to
    /// a reader who writes a comma — a rule
    /// `Tests/ArchitectureTests/AccessibilityConventionTests.swift` enforces
    /// over the whole source tree.
    public static func format(
        _ value: Double,
        fractionDigits: Int = 2,
        locale: Locale
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = false
        return formatter.string(from: NSNumber(value: value)) ?? ""
    }

    /// One nudge of a drag across the numeral.
    ///
    /// Rounded to the step so a long drag cannot accumulate a value like
    /// 1.7999999999999998, which would then be shown, stored, and compared.
    public static func nudged(_ value: Double, by steps: Int, step: Double) -> Double {
        let raw = value + Double(steps) * step
        guard step > 0 else { return raw }
        return (raw / step).rounded() * step
    }
}
