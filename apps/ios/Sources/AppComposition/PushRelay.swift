import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation

#if canImport(UserNotifications)
    import UserNotifications
#endif

/// What this application does when a silent push arrives.
///
/// The server sends a **data-only** message — `contentAvailable: true` with a
/// notification id and a template key, and deliberately no `notification`
/// block. iOS therefore displays nothing on its own, which is the point: the
/// wording is chosen here, in the reader's own language, at the moment it is
/// shown. The intent was written days earlier on another machine that did not
/// know the recipient's locale.
///
/// So the relay does three things, in this order, and nothing else:
///
/// 1. Reads the inbox, which is the durable record the push merely announced.
/// 2. Finds the announced entry, renders it locally, and posts a local
///    notification carrying the deep link.
/// 3. Reports whether there was anything new, so the OS can learn how much
///    this application's background wake-ups are worth.
///
/// A push that arrives for an entry the inbox no longer has is not an error:
/// it was dismissed, expired, or read elsewhere between send and delivery, and
/// showing a banner for it would resurrect something already dealt with.
@MainActor
public struct PushRelay {
    private let gateway: any NotificationGateway
    private let strings: LocalizedStrings
    private let presentation: NotificationPresentation

    public init(
        gateway: any NotificationGateway,
        strings: LocalizedStrings,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.gateway = gateway
        self.strings = strings
        self.presentation = NotificationPresentation(strings: strings, locale: locale)
    }

    /// The key the delivery worker puts the inbox entry's id under.
    ///
    /// `nonisolated`, like the codec below: the tap handler that reads it is a
    /// `UNUserNotificationCenterDelegate` requirement, which is nonisolated.
    public nonisolated static let notificationIdKey = "notificationId"
    /// Where this relay stashes the deep link for the tap handler.
    public nonisolated static let deepLinkKey = "verderyDeepLink"

    public enum Outcome: Sendable, Equatable {
        case presented
        /// Nothing to show — already dealt with, or the payload was not ours.
        case nothingNew
        case failed
    }

    public func handle(userInfo: [AnyHashable: Any]) async -> Outcome {
        guard let notificationId = userInfo[Self.notificationIdKey] as? String else {
            return .nothingNew
        }

        do {
            let inbox = try await gateway.listNotifications(cursor: nil, limit: nil)
            guard let entry = inbox.items.first(where: { $0.id == notificationId }) else {
                return .nothingNew
            }
            await present(entry)
            return .presented
        } catch {
            return .failed
        }
    }

    /// Posts the banner, rendered now, in this reader's language.
    private func present(_ entry: NotificationEntry) async {
        #if canImport(UserNotifications) && !targetEnvironment(macCatalyst)
            let content = UNMutableNotificationContent()
            content.title = presentation.title(for: entry)
            content.body = presentation.body(for: entry)
            content.sound = entry.priority == .high ? .default : nil
            content.userInfo = [Self.deepLinkKey: Self.encode(entry.deepLink)]

            // Immediate delivery, and keyed by the entry's own id so a resent
            // push replaces its banner instead of stacking a second one.
            let request = UNNotificationRequest(
                identifier: entry.id,
                content: content,
                trigger: nil
            )
            try? await UNUserNotificationCenter.current().add(request)
        #endif
    }

    /// The deep link as a plain string, because `UNNotificationContent.userInfo`
    /// must be property-list types. Decoded by ``decode(_:)`` on the tap.
    nonisolated static func encode(_ deepLink: NotificationDeepLink) -> String {
        switch deepLink {
        case let .gardenToday(gardenId, recommendationCandidateId):
            "gardenToday:\(gardenId):\(recommendationCandidateId)"
        case let .exportReady(exportRequestId):
            "exportReady:\(exportRequestId)"
        case let .unknown(kind):
            "unknown:\(kind)"
        }
    }

    /// An unparsable or unknown link resolves to `nil`, and the caller opens
    /// the application's ordinary starting screen. Deep links carry resource
    /// ids and never bearer access, so falling back reveals nothing and loses
    /// nothing — the entry is still in the inbox.
    public nonisolated static func decode(_ encoded: String) -> NotificationDeepLink? {
        let parts = encoded.split(separator: ":", omittingEmptySubsequences: false)
        switch (parts.first.map(String.init), parts.count) {
        case ("gardenToday", 3):
            return .gardenToday(
                gardenId: String(parts[1]),
                recommendationCandidateId: String(parts[2])
            )
        case ("exportReady", 2):
            return .exportReady(exportRequestId: String(parts[1]))
        default:
            return nil
        }
    }
}
