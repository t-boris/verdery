import Foundation

/// How a date reads on a dial or a window bar.
///
/// It lives here, in the module that depends on nothing, because it needs no
/// catalogue: every one of these is `DateFormatter` with a style or a localized
/// template, which produces the form a reader of that locale recognises. The
/// *words* — "Today", "This weekend" — are catalogue strings and stay with the
/// features, which is why ``DateDial`` takes its chip titles as a closure.
///
/// Hoisted out of `FeatureTasks`, where it was first written, the moment a
/// second feature needed the same four formatters: a duplicated date format is
/// how two screens end up disagreeing about what "6 Aug" means.
public enum CalendarText {
    /// Never `String(format:)` and never a hardcoded pattern.
    /// `AccessibilityConventionTests` enforces the same rule for numbers, and
    /// for the same reason: a pattern written by hand is a pattern that is
    /// wrong in some locale nobody tested.
    private static func formatter(_ configure: (DateFormatter) -> Void) -> DateFormatter {
        let formatter = DateFormatter()
        configure(formatter)
        return formatter
    }

    public static func day(_ date: Date) -> String {
        formatter {
            $0.dateStyle = .medium
            $0.timeStyle = .none
        }
        .string(from: date)
    }

    public static func dayNumber(_ date: Date) -> String {
        formatter { $0.setLocalizedDateFormatFromTemplate("d") }.string(from: date)
    }

    public static func weekday(_ date: Date) -> String {
        formatter { $0.setLocalizedDateFormatFromTemplate("EEE") }.string(from: date)
    }

    public static func time(_ date: Date) -> String {
        formatter {
            $0.dateStyle = .none
            $0.timeStyle = .short
        }
        .string(from: date)
    }

    /// An en dash, not a hyphen: this is a range, and the two are different
    /// marks that a reader distinguishes without being able to say why.
    public static func window(_ start: Date, _ end: Date) -> String {
        "\(time(start))–\(time(end))"
    }
}
