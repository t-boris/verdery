import CoreDesignSystem
import SwiftUI

/// The garden's Context quality screen (P9D-UX-01): one row per
/// `GardenContextKind`, reached from `GardenSettingsView`'s configuration
/// section via `GardenContextQualityRoute` — mirroring the same
/// `navigationCard` pattern `GardenCollaboratorsRoute`/`GardenPlanUploadRoute`
/// already use.
///
/// Loading/error/offline handling mirrors `TodayView`'s own state-handling
/// structure, per this package's own "do not invent a new one" instruction.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `GardenContext`.
public struct ContextQualityView: View {
    @State private var model: ContextQualityViewModel

    public init(model: ContextQualityViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("contextQuality.loading")

        case .offline:
            EmptyStateView(
                symbol: "wifi.slash",
                title: model.title,
                message: model.offlineMessage,
                actionTitle: model.retryTitle,
                actionSymbol: "arrow.clockwise",
                action: { Task { await model.load() } }
            )
            .accessibilityIdentifier("contextQuality.offline")

        case let .failed(message):
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("contextQuality.failure")

        case let .loaded(presentation):
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    Text(model.descriptionText)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)

                    VStack(spacing: Metrics.space3) {
                        ForEach(presentation.rows) { row in
                            ContextQualityRowView(model: model, row: row)
                        }
                    }
                }
                .padding(Metrics.space4)
            }
            .refreshable { await model.load() }
        }
    }
}
