import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The notification inbox.
///
/// Icon-only verbs at the row's trailing edge rather than swipe actions.
/// `.swipeActions` is a `List` affordance and this screen is a `ScrollView` —
/// the design system bans `List` as a container — so a swipe here would be a
/// gesture that silently does nothing. A visible control that works beats an
/// invisible one that does not.
public struct NotificationInboxView: View {
    @State private var model: NotificationInboxViewModel
    /// Following where an entry points. `nil` on a screen with nowhere to go,
    /// in which case rows are readable but not tappable.
    private let open: ((NotificationDeepLink) -> Void)?

    public init(
        model: NotificationInboxViewModel,
        open: ((NotificationDeepLink) -> Void)? = nil
    ) {
        _model = State(wrappedValue: model)
        self.open = open
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
            .refreshable { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.title)
                .accessibilityIdentifier("notifications.loading")

        case .unreachable:
            FailureStateView(
                message: model.offlineMessage,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("notifications.offline")

        case let .loaded(items) where items.isEmpty:
            EmptyStateView(
                symbol: "bell.slash",
                title: model.emptyTitle,
                message: model.emptyMessage
            )
            .accessibilityIdentifier("notifications.empty")

        case let .loaded(items):
            ScrollView {
                LazyVStack(spacing: Metrics.space3) {
                    ForEach(items) { entry in
                        row(entry)
                    }
                    if model.nextCursor != nil {
                        Button(model.loadMoreTitle) {
                            Task { await model.loadMore() }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("notifications.loadMore")
                    }
                    if let message = model.actionErrorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("notifications.failure")
                    }
                }
                .padding(Metrics.space4)
            }
        }
    }

    @ViewBuilder
    private func row(_ entry: NotificationEntry) -> some View {
        let card = SurfaceCard {
            HStack(alignment: .top, spacing: Metrics.space3) {
                IconMedallion(
                    symbol: model.symbol(for: entry),
                    label: model.title(for: entry),
                    // Unread carries the interaction colour because unread is
                    // the thing you can still act on. Read is furniture.
                    tone: entry.isUnread ? .warning : .neutral
                )

                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(model.title(for: entry))
                        .font(FieldConsoleType.bodyStrong.font)
                        .foregroundStyle(Palette.text)
                    Text(model.body(for: entry))
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                        .multilineTextAlignment(.leading)
                    Text(model.expiryText(for: entry))
                        .font(FieldConsoleType.mono.font)
                        .foregroundStyle(Palette.textMuted)
                }
                Spacer(minLength: 0)

                VStack(spacing: Metrics.space1) {
                    if entry.isUnread {
                        CompactActionButton(
                            symbol: "envelope.open",
                            title: model.markReadTitle,
                            tone: .neutral
                        ) {
                            Task { await model.markRead(entry) }
                        }
                    }
                    CompactActionButton(
                        symbol: "xmark",
                        title: model.dismissTitle,
                        tone: .neutral
                    ) {
                        Task { await model.dismiss(entry) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        Group {
            if let open {
                Button {
                    // Reading and following are one gesture: opening an entry
                    // IS having read it, and asking for a second tap to say so
                    // is bookkeeping the reader did not ask for.
                    Task { await model.markRead(entry) }
                    open(entry.deepLink)
                } label: { card }
                .buttonStyle(.plain)
            } else {
                card
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityLabel(for: entry))
        .accessibilityIdentifier("notifications.row.\(entry.id)")
        .accessibilityAction(named: model.markReadTitle) {
            Task { await model.markRead(entry) }
        }
        .accessibilityAction(named: model.dismissTitle) {
            Task { await model.dismiss(entry) }
        }
    }
}
