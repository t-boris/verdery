import CoreDomain
import SwiftUI

/// One conflict's compare/resolve sheet — `openForManualReview`'s own
/// presentation (`SyncConflictsViewModel`'s own doc comment): a structured
/// side-by-side of the two raw payloads, per architecture/offline-
/// synchronization.md, section "15. Local Conflict Recovery". A real visual
/// geometry diff is explicitly out of scope for this stage (P5-CONFLICT-01's
/// own scope note) — this shows the same JSON text `CoreDomain.SyncConflict
/// .localRepresentation`/`.serverRepresentation` already durably store.
struct SyncConflictDetailView: View {
    let model: SyncConflictsViewModel
    let conflict: SyncConflict
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section(model.conflictCodeLabel) {
                Text(conflict.conflictCode)
            }

            Section(model.localRepresentationLabel) {
                Text(conflict.localRepresentation)
                    .font(.system(.caption, design: .monospaced))
                    .accessibilityIdentifier("syncConflicts.detail.local")
            }

            Section(model.serverRepresentationLabel) {
                Text(conflict.serverRepresentation)
                    .font(.system(.caption, design: .monospaced))
                    .accessibilityIdentifier("syncConflicts.detail.server")
            }

            // One button per offered action — never every
            // `ConflictRecoveryAction` case, and never `.openForManualReview`
            // itself (this sheet already IS that action; see
            // `SyncConflictsViewModel.title(for:)`'s own doc comment).
            Section {
                ForEach(conflict.suggestedRecoveryActions.filter { $0 != .openForManualReview }, id: \.self) { action in
                    Button(model.title(for: action)) {
                        Task { await model.resolve(conflict, action: action) }
                    }
                    .disabled(model.isResolving)
                    .accessibilityIdentifier("syncConflicts.detail.action.\(action.rawValue)")
                }
            }

            if let message = model.resolutionErrorMessage {
                Section {
                    Text(message).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(conflict.conflictCode)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(model.closeTitle) { dismiss() }
            }
        }
    }
}
