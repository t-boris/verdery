import CoreDomain
import CoreDesignSystem
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
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space4) {
                SectionEyebrow(symbol: "exclamationmark.arrow.triangle.2.circlepath",
                               title: model.conflictCodeLabel)
                SurfaceCard(tone: .warning) {
                    Text(conflict.conflictCode)
                        .font(FieldConsoleType.monoStrong.font)
                        .foregroundStyle(Palette.text)
                }

                // Mine and the server's, side by side rather than in two
                // separate `Section`s a reader has to hold in their head.
                // Still raw JSON: a geometry diff is a real screen and this is
                // not it, but showing both at once is what makes a choice
                // possible at all.
                representation(model.localRepresentationLabel,
                               conflict.localRepresentation,
                               identifier: "syncConflicts.detail.local")
                representation(model.serverRepresentationLabel,
                               conflict.serverRepresentation,
                               identifier: "syncConflicts.detail.server")

                // One button per offered action — never every
                // `ConflictRecoveryAction` case, and never
                // `.openForManualReview` itself (this sheet already IS that
                // action; see `SyncConflictsViewModel.title(for:)`).
                ForEach(
                    conflict.suggestedRecoveryActions.filter { $0 != .openForManualReview },
                    id: \.self
                ) { action in
                    Button(model.title(for: action)) {
                        Task { await model.resolve(conflict, action: action) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.isResolving)
                    .accessibilityIdentifier("syncConflicts.detail.action.\(action.rawValue)")
                }

                if let message = model.resolutionErrorMessage {
                    InlineMessage(message, tone: .negative)
                }
            }
            .padding(Metrics.space4)
        }
        .navigationTitle(conflict.conflictCode)
        .inlineNavigationTitle()
        .screenBackground()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(model.closeTitle) { dismiss() }
            }
        }
    }

    private func representation(
        _ title: String,
        _ text: String,
        identifier: String
    ) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "curlybraces", title: title)
            SurfaceCard {
                Text(text)
                    .font(FieldConsoleType.mono.font)
                    .foregroundStyle(Palette.text)
                    .accessibilityIdentifier(identifier)
            }
        }
    }
}
