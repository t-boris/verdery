import Foundation

/// Where a notification points.
///
/// Resource identifiers only, never bearer access: the client authenticates and
/// authorizes *after* opening, and opens a safe fallback when the target is
/// unavailable rather than revealing that it exists.
///
/// An unrecognised kind is kept as ``unknown`` rather than dropped, because the
/// entry itself is still worth showing — the server's vocabulary is
/// deliberately open so a new kind never breaks a shipped client.
public enum NotificationDeepLink: Sendable, Equatable {
    case gardenToday(gardenId: String, recommendationCandidateId: String)
    case exportReady(exportRequestId: String)
    case unknown(kind: String)
}

/// One durable inbox entry.
///
/// It carries a stable template key plus structured parameters, **never
/// rendered text**, so the client renders in the recipient's own locale as late
/// as practical and falls back generically for a key it does not know.
///
/// The inbox is written when the intent is created — before, and independent
/// of, any push delivery attempt — so it stays correct when push fails or never
/// happens at all. That is why this application ships the inbox and treats push
/// as an accelerator rather than the channel.
public struct NotificationEntry: Sendable, Equatable, Identifiable {
    public let id: String
    /// Deliberately a plain string, not an enum: the vocabulary is
    /// server-owned and open, and an unknown type must render through the
    /// client's generic fallback rather than fail to decode.
    public let notificationType: String
    public let priority: NotificationPriority
    /// The garden this concerns; `nil` for account-level entries.
    public let gardenId: String?
    public let recommendationCandidateId: String?
    public let templateKey: String
    public let parameters: [String: JSONValue]
    public let deepLink: NotificationDeepLink
    public let readAt: Date?
    public let dismissedAt: Date?
    /// When it stops being actionable — the source recommendation's own
    /// validity-window end, where it has one.
    public let expiresAt: Date
    public let createdAt: Date

    public init(
        id: String,
        notificationType: String,
        priority: NotificationPriority,
        gardenId: String?,
        recommendationCandidateId: String?,
        templateKey: String,
        parameters: [String: JSONValue],
        deepLink: NotificationDeepLink,
        readAt: Date?,
        dismissedAt: Date?,
        expiresAt: Date,
        createdAt: Date
    ) {
        self.id = id
        self.notificationType = notificationType
        self.priority = priority
        self.gardenId = gardenId
        self.recommendationCandidateId = recommendationCandidateId
        self.templateKey = templateKey
        self.parameters = parameters
        self.deepLink = deepLink
        self.readAt = readAt
        self.dismissedAt = dismissedAt
        self.expiresAt = expiresAt
        self.createdAt = createdAt
    }

    public var isUnread: Bool { readAt == nil }
}

/// Two values, matching what push transports actually distinguish.
public enum NotificationPriority: String, Sendable, Equatable, Codable {
    case normal
    case high
}

public struct NotificationInbox: Sendable, Equatable {
    public let items: [NotificationEntry]
    public let nextCursor: String?

    public init(items: [NotificationEntry], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }

    /// What the tab badge counts.
    public var unreadCount: Int { items.filter(\.isUnread).count }
}
