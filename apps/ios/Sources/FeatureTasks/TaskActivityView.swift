import CoreDesignSystem
import SwiftUI

/// A task's shared activity history (P9A-TASK-01, row B17) — a simple,
/// honest timeline over exactly what `GET .../tasks/{taskId}/activity`
/// returns: who did what, oldest first, and (for the entries that actually
/// carry one) the due date that command set. Nothing here is inferred or
/// embellished beyond that response — see `TaskCollaborationLocalization
/// .row(for:roster:strings:)`'s own doc comment for the exact rule.
///
/// Reached from the list row's context menu, the same "no separate task-
/// detail screen exists, so this does not invent one" reasoning
/// `TaskAssignSheetView`'s own doc comment gives.
struct TaskActivityView: View {
    let state: TaskActivityViewState
    let title: String
    let loadingMessage: String
    let emptyMessage: String
    let closeTitle: String
    let onAppear: () async -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .inlineNavigationTitle()
                .screenBackground()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(closeTitle, action: onClose)
                            .accessibilityIdentifier("tasks.activity.close")
                    }
                }
                .task { await onAppear() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            LoadingStateView(loadingMessage)
                .accessibilityIdentifier("tasks.activity.loading")

        case let .loaded(rows) where rows.isEmpty:
            EmptyStateView(symbol: TaskSymbols.activity, title: title, message: emptyMessage)
                .accessibilityIdentifier("tasks.activity.empty")

        case let .loaded(rows):
            List(rows) { row in
                rowView(row)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            .listStyle(.plain)

        case let .failed(message):
            FailureStateView(message: message)
                .accessibilityIdentifier("tasks.activity.failure")
        }
    }

    private func rowView(_ row: TaskActivityRow) -> some View {
        SurfaceCard {
            HStack(alignment: .top, spacing: Metrics.space3) {
                IconMedallion(symbol: row.symbol, label: row.text)

                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(row.text)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.text)

                    if let dueDateCaption = row.dueDateCaption {
                        Text(dueDateCaption)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.textMuted)
                    }

                    Text(row.recordedAtText)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("tasks.activity.row.\(row.id)")
    }
}
