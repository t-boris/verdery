import CoreDomain
import CoreObservability
import Foundation

/// The durable notification inbox, the preferences that govern it, and this
/// device's push channel.
///
/// The inbox is the user-facing record and is written when the intent is
/// created — before, and independent of, any push attempt. Push is an
/// accelerator; the inbox is the channel. That is why every operation here
/// works with push permission denied, and why the screens built on it never
/// ask for permission in order to function.
public protocol NotificationGateway: Sendable {
    /// Live entries only, newest first. Reading also closes the caller's own
    /// expired intents server-side, so repeating it is safe and self-cleaning.
    func listNotifications(cursor: String?, limit: Int?) async throws -> NotificationInbox
    func markNotificationRead(notificationId: String) async throws
    func dismissNotification(notificationId: String) async throws

    func getNotificationPreferences() async throws -> NotificationPreferences
    /// Replaces the whole document. `expectedRevision` becomes `If-Match`.
    func updateNotificationPreferences(
        _ preferences: NotificationPreferences,
        expectedRevision: Int
    ) async throws -> NotificationPreferences

    /// Register or refresh this installation's push channel. Registering
    /// reactivates a channel a provider verdict had disabled.
    func registerNotificationDevice(
        installationId: String,
        fcmToken: String
    ) async throws -> NotificationDevice
    /// Signing out, or revoking push. Idempotent.
    func removeNotificationDevice(installationId: String) async throws
}

// MARK: - Transport

struct NotificationDeepLinkTransport: Decodable {
    let kind: String
    let gardenId: String?
    let recommendationCandidateId: String?
    let exportRequestId: String?

    /// An unrecognised kind is preserved rather than rejected: the server's
    /// vocabulary is deliberately open, and an entry a shipped client cannot
    /// route is still an entry worth showing.
    var domainValue: NotificationDeepLink {
        switch kind {
        case "gardenToday":
            guard let gardenId, let recommendationCandidateId else {
                return .unknown(kind: kind)
            }
            return .gardenToday(
                gardenId: gardenId,
                recommendationCandidateId: recommendationCandidateId
            )
        case "exportReady":
            guard let exportRequestId else { return .unknown(kind: kind) }
            return .exportReady(exportRequestId: exportRequestId)
        default:
            return .unknown(kind: kind)
        }
    }
}

struct NotificationTransport: Decodable {
    let id: String
    let notificationType: String
    let priority: String
    let gardenId: String?
    let recommendationCandidateId: String?
    let templateKey: String
    let parameters: JSONValue
    let deepLink: NotificationDeepLinkTransport
    let readAt: Date?
    let dismissedAt: Date?
    let expiresAt: Date
    let createdAt: Date

    var domainValue: NotificationEntry {
        NotificationEntry(
            id: id,
            notificationType: notificationType,
            priority: NotificationPriority(rawValue: priority) ?? .normal,
            gardenId: gardenId,
            recommendationCandidateId: recommendationCandidateId,
            templateKey: templateKey,
            parameters: parameters.fields,
            deepLink: deepLink.domainValue,
            readAt: readAt,
            dismissedAt: dismissedAt,
            expiresAt: expiresAt,
            createdAt: createdAt
        )
    }
}

struct NotificationListTransport: Decodable {
    let items: [NotificationTransport]
    let nextCursor: String?

    var domainValue: NotificationInbox {
        NotificationInbox(items: items.map(\.domainValue), nextCursor: nextCursor)
    }
}

struct QuietHoursTransport: Codable {
    let startMinute: Int
    let endMinute: Int
    let timeZone: String?

    var domainValue: NotificationQuietHours {
        NotificationQuietHours(
            startMinute: startMinute,
            endMinute: endMinute,
            timeZone: timeZone
        )
    }

    init(_ quietHours: NotificationQuietHours) {
        self.startMinute = quietHours.startMinute
        self.endMinute = quietHours.endMinute
        self.timeZone = quietHours.timeZone
    }
}

struct PreferenceEntryTransport: Codable {
    let notificationType: String
    let gardenId: String?
    let inAppEnabled: Bool
    let pushEnabled: Bool

    var domainValue: NotificationPreferenceEntry {
        NotificationPreferenceEntry(
            notificationType: notificationType,
            gardenId: gardenId,
            inAppEnabled: inAppEnabled,
            pushEnabled: pushEnabled
        )
    }

    init(_ entry: NotificationPreferenceEntry) {
        self.notificationType = entry.notificationType
        self.gardenId = entry.gardenId
        self.inAppEnabled = entry.inAppEnabled
        self.pushEnabled = entry.pushEnabled
    }
}

struct PreferencesDocumentTransport: Decodable {
    let revision: Int
    let quietHours: QuietHoursTransport?
    let entries: [PreferenceEntryTransport]

    var domainValue: NotificationPreferences {
        NotificationPreferences(
            revision: revision,
            quietHours: quietHours?.domainValue,
            entries: entries.map(\.domainValue)
        )
    }
}

struct UpdatePreferencesTransport: Encodable {
    let quietHours: QuietHoursTransport?
    let entries: [PreferenceEntryTransport]
}

struct RegisterDeviceTransport: Encodable {
    let platform: String
    let fcmToken: String
}

struct NotificationDeviceTransport: Decodable {
    let installationId: String
    let platform: String
    let status: String
    let lastSeenAt: Date
    let registeredAt: Date

    var domainValue: NotificationDevice {
        NotificationDevice(
            installationId: installationId,
            platform: platform,
            status: NotificationDeviceStatus(rawValue: status) ?? .active,
            lastSeenAt: lastSeenAt,
            registeredAt: registeredAt
        )
    }
}

// MARK: - URLSession

public struct URLSessionNotificationGateway: NotificationGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func listNotifications(cursor: String?, limit: Int?) async throws -> NotificationInbox {
        var query: [String] = []
        if let cursor { query.append("cursor=\(cursor)") }
        if let limit { query.append("limit=\(limit)") }
        let suffix = query.isEmpty ? "" : "?\(query.joined(separator: "&"))"
        let response: NotificationListTransport = try await transport.get(
            operationPath: "notifications\(suffix)",
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }

    public func markNotificationRead(notificationId: String) async throws {
        try await transport.sendNoContent(
            method: "POST",
            operationPath: "notifications/\(notificationId)/read"
        )
    }

    public func dismissNotification(notificationId: String) async throws {
        try await transport.sendNoContent(
            method: "POST",
            operationPath: "notifications/\(notificationId)/dismiss"
        )
    }

    public func getNotificationPreferences() async throws -> NotificationPreferences {
        let response: PreferencesDocumentTransport = try await transport.get(
            operationPath: "notification-preferences",
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }

    public func updateNotificationPreferences(
        _ preferences: NotificationPreferences,
        expectedRevision: Int
    ) async throws -> NotificationPreferences {
        let response: PreferencesDocumentTransport = try await transport.send(
            method: "PUT",
            operationPath: "notification-preferences",
            body: UpdatePreferencesTransport(
                quietHours: preferences.quietHours.map(QuietHoursTransport.init),
                entries: preferences.entries.map(PreferenceEntryTransport.init)
            ),
            headers: [APIConfiguration.ifMatchHeader: String(expectedRevision)],
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }

    public func registerNotificationDevice(
        installationId: String,
        fcmToken: String
    ) async throws -> NotificationDevice {
        let response: NotificationDeviceTransport = try await transport.send(
            method: "PUT",
            operationPath: "notification-devices/\(installationId)",
            // The token is a secret: it goes up and is never read back, never
            // logged, and never stored anywhere on this device but Firebase's
            // own keychain entry.
            body: RegisterDeviceTransport(platform: "ios", fcmToken: fcmToken),
            acceptedStatusCodes: [200, 201]
        )
        return response.domainValue
    }

    public func removeNotificationDevice(installationId: String) async throws {
        try await transport.sendNoContent(
            method: "DELETE",
            operationPath: "notification-devices/\(installationId)"
        )
    }
}
