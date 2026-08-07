import Foundation

/// A daily do-not-push window in the recipient's own local time, as minutes
/// after local midnight.
///
/// The window may wrap midnight (`start` greater than `end` — 22:00 to 07:00 is
/// 1320 to 420). Equal bounds are rejected by the server on purpose: an
/// always-quiet day is expressed by switching the push channel off, not by a
/// degenerate window that reads as either "always" or "never" depending on who
/// implements it.
public struct NotificationQuietHours: Sendable, Equatable {
    public let startMinute: Int
    public let endMinute: Int
    /// An IANA identifier. `nil` means the profile's own time zone applies.
    public let timeZone: String?

    public init(startMinute: Int, endMinute: Int, timeZone: String?) {
        self.startMinute = startMinute
        self.endMinute = endMinute
        self.timeZone = timeZone
    }

    /// True when the window crosses midnight, which is the ordinary case for a
    /// sleeping window and the one a naive `start...end` range gets wrong.
    public var wrapsMidnight: Bool { startMinute > endMinute }

    /// Rejected by the server, and refused here before a request is spent.
    public var isDegenerate: Bool { startMinute == endMinute }
}

/// One explicit per-type toggle.
///
/// `gardenId == nil` is the caller's global setting for the type; a non-nil one
/// overrides the global setting for that garden alone. A combination with no
/// entry defaults to every channel enabled — which is why the absence of a row
/// is meaningful and a client must not invent empty rows to fill a form.
public struct NotificationPreferenceEntry: Sendable, Equatable, Identifiable {
    public let notificationType: String
    public let gardenId: String?
    public let inAppEnabled: Bool
    public let pushEnabled: Bool

    public init(
        notificationType: String,
        gardenId: String?,
        inAppEnabled: Bool,
        pushEnabled: Bool
    ) {
        self.notificationType = notificationType
        self.gardenId = gardenId
        self.inAppEnabled = inAppEnabled
        self.pushEnabled = pushEnabled
    }

    public var id: String { "\(notificationType)|\(gardenId ?? "")" }

    public func withChannels(inApp: Bool, push: Bool) -> NotificationPreferenceEntry {
        NotificationPreferenceEntry(
            notificationType: notificationType,
            gardenId: gardenId,
            inAppEnabled: inApp,
            pushEnabled: push
        )
    }
}

/// The whole preferences document, replaced as a whole.
///
/// `quietHours: nil` clears quiet hours and an entry absent from `entries` is
/// removed, reverting that combination to the default. Stating the whole
/// document rather than patching it is what makes "no entry means enabled"
/// unambiguous on both sides.
public struct NotificationPreferences: Sendable, Equatable {
    /// `0` for a caller who has never written preferences. Feeds the next
    /// write's `If-Match`.
    public let revision: Int
    public let quietHours: NotificationQuietHours?
    public let entries: [NotificationPreferenceEntry]

    public init(
        revision: Int,
        quietHours: NotificationQuietHours?,
        entries: [NotificationPreferenceEntry]
    ) {
        self.revision = revision
        self.quietHours = quietHours
        self.entries = entries
    }

    /// The effective setting for a type, honouring the garden override.
    ///
    /// Absence means enabled, everywhere. A client that treated a missing row
    /// as "off" would silently mute a recipient who never chose to be muted.
    public func setting(
        for notificationType: String,
        gardenId: String?
    ) -> NotificationPreferenceEntry {
        let override = entries.first {
            $0.notificationType == notificationType && $0.gardenId == gardenId
        }
        let global = entries.first {
            $0.notificationType == notificationType && $0.gardenId == nil
        }
        return override
            ?? global
            ?? NotificationPreferenceEntry(
                notificationType: notificationType,
                gardenId: gardenId,
                inAppEnabled: true,
                pushEnabled: true
            )
    }

    /// Replaces one type/garden combination, keeping every other row intact.
    public func replacing(_ entry: NotificationPreferenceEntry) -> NotificationPreferences {
        var updated = entries.filter { $0.id != entry.id }
        updated.append(entry)
        return NotificationPreferences(
            revision: revision,
            quietHours: quietHours,
            entries: updated.sorted { $0.id < $1.id }
        )
    }

    public func withQuietHours(_ quietHours: NotificationQuietHours?) -> NotificationPreferences {
        NotificationPreferences(revision: revision, quietHours: quietHours, entries: entries)
    }
}

public enum NotificationDeviceStatus: String, Sendable, Equatable, Codable {
    case active
    /// A provider invalid-token verdict, recorded until the next refresh.
    case disabled
}

/// One registered push channel — this device's own record.
///
/// Deliberately carries no token: tokens are secrets, stored for delivery only,
/// never echoed back and never logged.
public struct NotificationDevice: Sendable, Equatable {
    public let installationId: String
    public let platform: String
    public let status: NotificationDeviceStatus
    public let lastSeenAt: Date
    public let registeredAt: Date

    public init(
        installationId: String,
        platform: String,
        status: NotificationDeviceStatus,
        lastSeenAt: Date,
        registeredAt: Date
    ) {
        self.installationId = installationId
        self.platform = platform
        self.status = status
        self.lastSeenAt = lastSeenAt
        self.registeredAt = registeredAt
    }
}
