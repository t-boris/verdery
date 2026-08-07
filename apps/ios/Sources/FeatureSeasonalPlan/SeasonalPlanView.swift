import CoreDesignSystem
import SwiftUI

/// A garden's Seasonal plan screen (P9D-UX-01): reviewed sow/transplant/
/// harvest windows (Calendar) and continuous bed-rotation status (Rotation)
/// — a forward-looking planning surface, distinct from Today's rule-fired
/// candidates. Pushed onto the Today tab's own `NavigationStack` from a card
/// near the top of `TodayView`'s own list; see this package's own iOS
/// navigation placement decision (tasks/todo.md) for why this is not a
/// sixth tab and not buried in garden settings.
///
/// Loading/error/offline/stale-set handling mirrors `TodayView`'s own
/// state-handling structure exactly, per this package's own "do not invent
/// a new one" instruction.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
public struct SeasonalPlanView: View {
    @State private var model: SeasonalPlanViewModel

    public init(model: SeasonalPlanViewModel) {
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
                .accessibilityIdentifier("seasonalPlan.loading")

        case .offline:
            EmptyStateView(
                symbol: "wifi.slash",
                title: model.title,
                message: model.offlineMessage,
                actionTitle: model.retryTitle,
                actionSymbol: "arrow.clockwise",
                action: { Task { await model.load() } }
            )
            .accessibilityIdentifier("seasonalPlan.offline")

        case let .failed(message):
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("seasonalPlan.failure")

        case let .loaded(presentation):
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    staleNotice
                    SeasonalCalendarSection(model: model, presentation: presentation)
                    RotationConflictsSection(model: model, presentation: presentation)
                }
                .padding(Metrics.space4)
            }
            .refreshable { await model.load() }
        }
    }

    @ViewBuilder
    private var staleNotice: some View {
        if let notice = model.staleNoticeText {
            // Tone plus symbol, never tone alone — the same reason
            // `TodayView.staleNotice` gives.
            InlineMessage(notice, tone: .warning)
                .padding(Metrics.space2)
                .background(
                    RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                        .fill(Tone.warning.quietFill)
                )
                .accessibilityIdentifier("seasonalPlan.staleNotice")
        }
    }
}
