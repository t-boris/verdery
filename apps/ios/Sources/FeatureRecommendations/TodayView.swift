import SwiftUI

/// A garden's Today screen: the small prioritized recommendation set, each
/// row carrying the proposed action, target, reason, urgency, care
/// category, validity window, priority score, and the confidence factor's
/// uncertainty line. Rows push ``TodayItemDetailView``, where the full
/// priority breakdown, the evidence, and the controls live.
///
/// The degraded states this view renders are the ones
/// ``TodayViewModel``'s own doc comment decides: a named offline state, a
/// staleness notice over a kept last-fetched set, the established failure
/// surface, and an honest empty state.
public struct TodayView: View {
    @State private var model: TodayViewModel

    public init(model: TodayViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
            .navigationDestination(for: TodayItemDetailRoute.self) { route in
                TodayItemDetailView(model: model, itemId: route.itemId)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView(model.loadingMessage)
                .accessibilityIdentifier("today.loading")

        case .offline:
            unavailableView(message: model.offlineMessage, identifier: "today.offline")

        case let .failed(message):
            unavailableView(message: message, identifier: "today.failure")

        case let .loaded(items) where items.isEmpty:
            List {
                staleNoticeSection
                Section {
                    Text(model.emptyMessage)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.empty")
                }
            }
            .refreshable { await model.load() }

        case let .loaded(items):
            List {
                staleNoticeSection
                Section {
                    ForEach(items) { item in
                        NavigationLink(value: TodayItemDetailRoute(itemId: item.id)) {
                            rowView(item)
                        }
                        // One element, one sentence: see
                        // `TodayItemPresentation.accessibilityLabel`.
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(item.accessibilityLabel)
                        .accessibilityIdentifier("today.row.\(item.id)")
                    }
                }
            }
            .refreshable { await model.load() }
        }
    }

    private func unavailableView(message: String, identifier: String) -> some View {
        VStack(spacing: 12) {
            Text(message)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier(identifier)
            Button(model.retryTitle) { Task { await model.load() } }
        }
        .padding()
    }

    @ViewBuilder
    private var staleNoticeSection: some View {
        if let notice = model.staleNoticeText {
            Section {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    // Orange alone carries the meaning visually; the trait is
                    // what carries it to VoiceOver.
                    .accessibilityAddTraits(.isStaticText)
                    .accessibilityIdentifier("today.staleNotice")
            }
        }
    }

    private func rowView(_ item: TodayItemPresentation) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.actionTitle).font(.headline)
            Text(item.targetLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(item.explanation)
                .font(.footnote)
                .foregroundStyle(.secondary)
            HStack {
                Text(item.urgencyLabel)
                Text("·").accessibilityHidden(true)
                Text(item.careCategory)
                Text("·").accessibilityHidden(true)
                Text(item.priorityScoreText)
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            if let windowText = item.windowText {
                Text(windowText).font(.caption).foregroundStyle(.secondary)
            }
            if let uncertaintyText = item.uncertaintyText {
                Text(uncertaintyText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("today.row.\(item.id).uncertainty")
            }
            if item.isElevatedRisk {
                Text(item.safetyTierLabel)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("today.row.\(item.id).elevatedRisk")
            }
        }
        .padding(.vertical, 2)
    }
}
