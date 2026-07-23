import CoreDomain
import SwiftUI

/// One garden's open sync conflicts — reachable from `GardenSettingsView`
/// via `GardenSyncConflictsRoute` (`FeatureGardens`). Always reachable, not
/// gated behind any live engine status — see `SyncConflictsViewModel`'s own
/// doc comment for why the durable conflict list, not
/// `SyncEngineStatus.requiresAttention`, is this screen's source of truth;
/// an empty list here is a normal, expected state, not an error.
public struct SyncConflictsView: View {
    @State private var model: SyncConflictsViewModel

    public init(model: SyncConflictsViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
            .sheet(item: Binding(get: { model.selectedConflict }, set: { if $0 == nil { model.dismissDetail() } })) { conflict in
                NavigationStack {
                    SyncConflictDetailView(model: model, conflict: conflict)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .accessibilityIdentifier("syncConflicts.loading")

        case let .loaded(conflicts):
            if conflicts.isEmpty {
                Text(model.emptyMessage)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("syncConflicts.empty")
            } else {
                List(conflicts) { conflict in
                    Button {
                        model.select(conflict)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(conflict.conflictCode)
                                .font(.headline)
                            Text(conflict.recordType)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("syncConflicts.row.\(conflict.id)")
                }
                .accessibilityIdentifier("syncConflicts.list")
            }

        case let .failed(message):
            Text(message)
                .accessibilityIdentifier("syncConflicts.failure")
        }
    }
}
