import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// The durable notification inbox.
///
/// It lives beside Today because that is what the inbox is mostly about: the
/// only two entries this server produces are a new care recommendation, whose
/// deep link opens Today, and a finished export. A module of its own would be
/// two screens with no domain behind them.
///
/// Push permission is never a precondition here. The inbox is written when the
/// intent is created, before and independent of any delivery attempt, so this
/// screen is correct for somebody who refused push and for somebody who has no
/// signal at the moment a suggestion appears.
@MainActor
@Observable
public final class NotificationInboxViewModel {
    public enum State: Equatable {
        case loading
        case loaded([NotificationEntry])
        /// Structurally online-only, so this is the ordinary offline state
        /// rather than a fault.
        case unreachable
    }

    public private(set) var state: State = .loading
    public private(set) var nextCursor: String?
    public private(set) var isLoadingMore = false
    public private(set) var actionErrorMessage: String?

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

    // MARK: - Loading

    public func load() async {
        do {
            let inbox = try await gateway.listNotifications(cursor: nil, limit: nil)
            state = .loaded(inbox.items)
            nextCursor = inbox.nextCursor
        } catch {
            state = .unreachable
        }
    }

    /// Appends the next page. Offered only while a cursor exists, so the
    /// control disappears rather than becoming a button that does nothing.
    public func loadMore() async {
        guard let cursor = nextCursor, case let .loaded(existing) = state else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await gateway.listNotifications(cursor: cursor, limit: nil)
            state = .loaded(existing + page.items)
            nextCursor = page.nextCursor
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }

    // MARK: - Commands

    /// Marks read and keeps the entry listed, which is what the server does:
    /// a read entry stays until it expires or is dismissed, so opening one does
    /// not make it vanish from under the reader.
    public func markRead(_ entry: NotificationEntry) async {
        guard entry.isUnread else { return }
        do {
            try await gateway.markNotificationRead(notificationId: entry.id)
            replace(entry.id) { current in
                NotificationEntry(
                    id: current.id,
                    notificationType: current.notificationType,
                    priority: current.priority,
                    gardenId: current.gardenId,
                    recommendationCandidateId: current.recommendationCandidateId,
                    templateKey: current.templateKey,
                    parameters: current.parameters,
                    deepLink: current.deepLink,
                    readAt: Date(),
                    dismissedAt: current.dismissedAt,
                    expiresAt: current.expiresAt,
                    createdAt: current.createdAt
                )
            }
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }

    public func dismiss(_ entry: NotificationEntry) async {
        do {
            try await gateway.dismissNotification(notificationId: entry.id)
            if case let .loaded(items) = state {
                state = .loaded(items.filter { $0.id != entry.id })
            }
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }

    private func replace(_ id: String, _ transform: (NotificationEntry) -> NotificationEntry) {
        guard case let .loaded(items) = state else { return }
        state = .loaded(items.map { $0.id == id ? transform($0) : $0 })
    }

    // MARK: - Text

    public var title: String { strings(.notificationsTitle) }
    public var emptyTitle: String { strings(.notificationsEmptyTitle) }
    public var emptyMessage: String { strings(.notificationsEmptyMessage) }
    public var offlineMessage: String { strings(.notificationsOffline) }
    public var retryTitle: String { strings(.notificationsRetry) }
    public var markReadTitle: String { strings(.notificationsMarkRead) }
    public var dismissTitle: String { strings(.notificationsDismiss) }
    public var loadMoreTitle: String { strings(.notificationsLoadMore) }

    public var unreadCount: Int {
        guard case let .loaded(items) = state else { return 0 }
        return items.filter(\.isUnread).count
    }

    public func title(for entry: NotificationEntry) -> String { presentation.title(for: entry) }
    public func body(for entry: NotificationEntry) -> String { presentation.body(for: entry) }
    public func symbol(for entry: NotificationEntry) -> String { presentation.symbol(for: entry) }
    public func expiryText(for entry: NotificationEntry) -> String {
        presentation.expiryText(entry)
    }

    /// One element, one sentence — the rule `TodayItemPresentation` already
    /// applies to its own rows.
    public func accessibilityLabel(for entry: NotificationEntry) -> String {
        "\(presentation.title(for: entry)). \(presentation.body(for: entry))"
    }
}
