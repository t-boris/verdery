import CoreDesignSystem
import SwiftUI

/// A garden's Today screen: the small prioritized recommendation set.
///
/// Each item is a card, not a list row. The card leads with the care
/// category's symbol on a tinted medallion, states the proposed action in the
/// display face, and reduces everything that used to be a stack of grey
/// sentences — urgency, category, score, window, uncertainty, safety tier — to
/// a wrapping row of chips. That is roughly a third of the height of the old
/// row and readable without reading: urgency is a flame or a tortoise, a
/// watering job is a droplet, an elevated-risk item carries a shield.
///
/// The score, which was a sentence fragment, is now a figure on the card's
/// trailing edge in monospaced digits, so a column of cards ranks visibly.
///
/// The degraded states are the ones ``TodayViewModel`` decides: a named
/// offline state, a staleness notice over a kept last-fetched set, the
/// established failure surface, and an honest empty state.
public struct TodayView: View {
    @State private var model: TodayViewModel

    public init(model: TodayViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .screenBackground()
            .task { await model.load() }
            .navigationDestination(for: TodayItemDetailRoute.self) { route in
                TodayItemDetailView(model: model, itemId: route.itemId)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("today.loading")

        case .offline:
            EmptyStateView(
                symbol: "wifi.slash",
                title: model.title,
                message: model.offlineMessage,
                actionTitle: model.retryTitle,
                actionSymbol: "arrow.clockwise",
                action: { Task { await model.load() } }
            )
            .accessibilityIdentifier("today.offline")

        case let .failed(message):
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("today.failure")

        case let .loaded(items) where items.isEmpty:
            ScrollView {
                VStack(spacing: Metrics.space4) {
                    staleNotice
                    seasonalPlanCard
                    EmptyStateView(
                        symbol: "checkmark.seal.fill",
                        title: model.title,
                        message: model.emptyMessage
                    )
                    .accessibilityIdentifier("today.empty")
                }
                .padding(Metrics.space4)
            }
            .refreshable { await model.load() }

        case let .loaded(items):
            ScrollView {
                LazyVStack(spacing: Metrics.space3) {
                    staleNotice
                    seasonalPlanCard
                    ForEach(items) { item in
                        NavigationLink(value: TodayItemDetailRoute(itemId: item.id)) {
                            card(item)
                        }
                        .buttonStyle(.plain)
                        // One element, one sentence: see
                        // `TodayItemPresentation.accessibilityLabel`.
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(item.accessibilityLabel)
                        .accessibilityIdentifier("today.row.\(item.id)")
                    }
                }
                .padding(Metrics.space4)
            }
            .refreshable { await model.load() }
        }
    }

    @ViewBuilder
    private var staleNotice: some View {
        if let notice = model.staleNoticeText {
            // Tone plus symbol, never tone alone — `InlineMessage` names its
            // own glyph, which is what carries the warning to a reader who
            // cannot distinguish the colour.
            InlineMessage(notice, tone: .warning)
                .padding(Metrics.space2)
                .background(
                    RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                        .fill(Tone.warning.quietFill)
                )
                .accessibilityIdentifier("today.staleNotice")
        }
    }

    /// A prominent card near the top of Today's own list, pushing the
    /// Seasonal plan screen onto Today's existing `NavigationStack` — this
    /// package's own resolved navigation placement decision (tasks/todo.md,
    /// "iOS navigation placement decision"): not a sixth tab, not a route
    /// inside `GardenSettingsSheet`. Shown in every `.loaded` state
    /// (including the empty one) — this is a standing entry point to a
    /// planning surface, not conditioned on today's own candidate set.
    private var seasonalPlanCard: some View {
        NavigationLink(value: TodaySeasonalPlanRoute(gardenId: model.gardenId)) {
            SurfaceCard {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(symbol: "leaf.fill", label: model.seasonalPlanCardTitle)
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(model.seasonalPlanCardTitle)
                            .font(Typography.body)
                            .foregroundStyle(Palette.text)
                        Text(model.seasonalPlanCardSubtitle)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("today.seasonalPlanCard")
    }

    private func card(_ item: TodayItemPresentation) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                HStack(alignment: .top, spacing: Metrics.space3) {
                    IconMedallion(
                        symbol: TodaySymbols.careCategory(item.careCategory),
                        label: item.careCategory,
                        tone: TodaySymbols.urgencyTone(item.urgency)
                    )

                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(item.actionTitle)
                            .font(Typography.heading)
                            .foregroundStyle(Palette.text)
                        Label(item.targetLabel, systemImage: TodaySymbols.target)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 0)

                    Text(item.priorityScoreText)
                        .font(Typography.metric)
                        .foregroundStyle(TodaySymbols.urgencyTone(item.urgency).foreground)
                }

                Text(item.explanation)
                    .font(Typography.detail)
                    .foregroundStyle(Palette.textMuted)
                    .lineLimit(3)

                chips(item)
            }
        }
    }

    /// Everything that used to be a paragraph of grey sentences, as a wrapping
    /// row of chips. `ViewThatFits` keeps it on one line when it fits and
    /// drops the least essential chip when it does not, rather than truncating
    /// mid-word.
    private func chips(_ item: TodayItemPresentation) -> some View {
        HStack(spacing: Metrics.space2) {
            Chip(
                symbol: TodaySymbols.urgency(item.urgency),
                label: item.urgencyLabel,
                tone: TodaySymbols.urgencyTone(item.urgency)
            )

            if item.isElevatedRisk {
                Chip(
                    symbol: TodaySymbols.elevatedRisk,
                    label: item.safetyTierLabel,
                    tone: .negative
                )
                .accessibilityIdentifier("today.row.\(item.id).elevatedRisk")
            }

            if let windowText = item.windowText {
                Chip(symbol: TodaySymbols.window, label: windowText, tone: .neutral)
            }

            if let uncertaintyText = item.uncertaintyText {
                Chip(symbol: TodaySymbols.uncertainty, label: uncertaintyText, tone: .neutral)
                    .accessibilityIdentifier("today.row.\(item.id).uncertainty")
            }

            Spacer(minLength: 0)
        }
        .lineLimit(1)
    }
}
