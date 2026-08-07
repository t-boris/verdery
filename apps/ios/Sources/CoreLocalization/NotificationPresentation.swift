import CoreDomain
import Foundation

/// Rendering a notification in the reader's own language, as late as practical.
///
/// The server sends a stable template key plus structured parameters and
/// **never rendered text**, precisely so this decision happens here: the
/// recipient's locale is known on the device and was not known when the intent
/// was written, possibly days earlier and certainly on another machine.
///
/// An unknown template key renders through the generic pair rather than showing
/// a raw key. The type vocabulary is deliberately open so a new server type
/// never breaks a shipped client, and "something arrived that this version does
/// not know how to name" is a far better outcome than either a crash or a line
/// of machine text.
public struct NotificationPresentation: Sendable {
    private let strings: LocalizedStrings
    private let locale: Locale

    public init(strings: LocalizedStrings, locale: Locale = .autoupdatingCurrent) {
        self.strings = strings
        self.locale = locale
    }

    public func title(for entry: NotificationEntry) -> String {
        switch entry.templateKey {
        case "care_recommendation.created.v1":
            strings(.templateCareRecommendationTitle)
        case "export_ready.completed.v1":
            strings(.templateExportReadyTitle)
        default:
            strings(.templateGenericTitle)
        }
    }

    public func body(for entry: NotificationEntry) -> String {
        switch entry.templateKey {
        case "care_recommendation.created.v1":
            strings.string(
                .templateCareRecommendationBody,
                parameters: ["urgency": urgencyWord(entry)]
            )
        case "export_ready.completed.v1":
            strings(.templateExportReadyBody)
        default:
            strings(.templateGenericBody)
        }
    }

    /// The recommendation's own urgency, as a word.
    ///
    /// Read from the structured parameters rather than from the entry's
    /// delivery `priority`: priority is what the push transport distinguishes
    /// (two values), urgency is what the gardener decides on (four). An unknown
    /// or absent value falls back to "normal" rather than overstating.
    private func urgencyWord(_ entry: NotificationEntry) -> String {
        switch entry.parameters["urgency"] {
        case .string("urgent"): strings(.notificationsUrgencyUrgent)
        case .string("high"): strings(.notificationsUrgencyHigh)
        case .string("low"): strings(.notificationsUrgencyLow)
        default: strings(.notificationsUrgencyNormal)
        }
    }

    public func symbol(for entry: NotificationEntry) -> String {
        switch entry.templateKey {
        case "care_recommendation.created.v1": "lightbulb"
        case "export_ready.completed.v1": "arrow.down.circle"
        default: "bell"
        }
    }

    public func expiryText(_ entry: NotificationEntry) -> String {
        strings.string(
            .notificationsExpires,
            parameters: ["time": instantText(entry.expiresAt)]
        )
    }

    public func typeName(_ notificationType: String) -> String {
        switch notificationType {
        case "care_recommendation": strings(.notificationPreferencesTypeCare)
        case "export_ready": strings(.notificationPreferencesTypeExport)
        // A type this version does not know still gets a row, labelled with
        // what the server called it — better than hiding a setting somebody
        // may need to reach.
        default: notificationType
        }
    }

    /// A quiet window as two clock times in the reader's own format.
    ///
    /// Minutes after local midnight, so a wrapping window (22:00 to 07:00) is
    /// rendered as written rather than "corrected" into an empty range.
    public func quietWindowText(_ quietHours: NotificationQuietHours) -> String {
        strings.string(
            .notificationPreferencesQuietWindow,
            parameters: [
                "start": clockText(quietHours.startMinute),
                "end": clockText(quietHours.endMinute),
            ]
        )
    }

    public func clockText(_ minuteOfDay: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("jm")
        var components = DateComponents()
        components.year = 2000
        components.month = 1
        components.day = 1
        components.hour = minuteOfDay / 60
        components.minute = minuteOfDay % 60
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        guard let date = calendar.date(from: components) else { return String(minuteOfDay) }
        return formatter.string(from: date)
    }

    public func instantText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
