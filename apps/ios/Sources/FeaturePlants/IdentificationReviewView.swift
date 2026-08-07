import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The review stack: one card, one photograph, one guess, two answers.
///
/// A stack rather than a list because the question is the same fifteen times
/// and the answer is one of two. A list would make somebody choose *which* to
/// answer before answering it, which is a decision nobody wanted to make.
///
/// The card is draggable, and the drag is what a thumb reaches for — but every
/// answer is also a labelled button underneath, and both are exposed as
/// accessibility actions. A gesture with no visible equivalent is a feature
/// only its author knows about.
public struct IdentificationReviewView: View {
    @State private var model: IdentificationReviewViewModel
    @State private var dragTranslation: CGSize = .zero
    /// Opening the whole plant. Absent where this screen has nowhere to push.
    private let openPlant: ((String) -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(320) private var cardHeight
    @ScaledSize(96) private var swipeThreshold

    public init(
        model: IdentificationReviewViewModel,
        openPlant: ((String) -> Void)? = nil
    ) {
        _model = State(wrappedValue: model)
        self.openPlant = openPlant
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
            LoadingStateView(model.title)
                .accessibilityIdentifier("review.loading")

        case .unreachable:
            // The photographs are already saved, and the sentence says so
            // rather than implying anything was lost.
            FailureStateView(
                message: model.offlineMessage,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("review.offline")

        case .empty:
            EmptyStateView(
                symbol: "camera",
                title: model.emptyTitle,
                message: model.emptyMessage
            )
            .accessibilityIdentifier("review.empty")

        case .done:
            // A finished stack and a garden that never had one are different
            // facts, and get different sentences.
            EmptyStateView(
                symbol: "checkmark.seal.fill",
                title: model.doneTitle,
                message: model.doneMessage
            )
            .accessibilityIdentifier("review.done")

        case .reviewing:
            if let item = model.currentItem {
                stack(item)
            } else {
                EmptyStateView(
                    symbol: "checkmark.seal.fill",
                    title: model.doneTitle,
                    message: model.doneMessage
                )
                .accessibilityIdentifier("review.done")
            }
        }
    }

    private func stack(_ item: IdentificationReviewItem) -> some View {
        VStack(spacing: Metrics.space4) {
            HStack {
                Text(model.remainingText)
                    .font(FieldConsoleType.monoStrong.font)
                    .foregroundStyle(Palette.textMuted)
                Spacer(minLength: 0)
            }

            card(item)

            answers(item)

            if let message = model.failureMessage {
                InlineMessage(message)
                    .accessibilityIdentifier("review.failure")
            }

            Text(model.explanation)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)
        }
        .padding(Metrics.space4)
    }

    private func card(_ item: IdentificationReviewItem) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                if let name = item.suggestedName, !name.isEmpty {
                    Text(name)
                        .font(FieldConsoleType.title.font)
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.leading)

                    // A bar and a number. The bar is read at a glance; the
                    // number is what somebody quotes back when it is wrong.
                    ConfidenceBar(
                        fraction: item.confidence,
                        label: model.confidenceText(item)
                    )
                } else {
                    Text(model.noSuggestionText)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.textMuted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: cardHeight, alignment: .topLeading)
        }
        .offset(x: dragTranslation.width)
        .rotationEffect(.degrees(dragTranslation.width / 40))
        .animation(Motion.quick(reduceMotion), value: dragTranslation)
        .gesture(
            DragGesture()
                .onChanged { dragTranslation = $0.translation }
                .onEnded { value in
                    let distance = value.translation.width
                    dragTranslation = .zero
                    // Right is yes and left is no, matching the buttons'
                    // left-to-right order underneath — the card and the
                    // controls must not disagree about which side means what.
                    if distance > swipeThreshold {
                        Task { await model.confirm(item) }
                    } else if distance < -swipeThreshold {
                        model.skip(item)
                    }
                }
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(item.suggestedName ?? model.noSuggestionText)
        .accessibilityValue(model.confidenceText(item))
        .accessibilityAction(named: model.confirmTitle) {
            Task { await model.confirm(item) }
        }
        .accessibilityAction(named: model.skipTitle) { model.skip(item) }
        .accessibilityIdentifier("review.card")
    }

    private func answers(_ item: IdentificationReviewItem) -> some View {
        VStack(spacing: Metrics.space2) {
            HStack(spacing: Metrics.space3) {
                Button(model.skipTitle) { model.skip(item) }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("review.skip")

                if item.isConfirmable {
                    Button(model.confirmTitle) {
                        Task { await model.confirm(item) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isSubmitting)
                    .accessibilityIdentifier("review.confirm")
                }
            }

            if let openPlant {
                Button(model.openTitle) {
                    // Looking is not answering: the card is still here when
                    // they come back.
                    model.markOpened(item)
                    openPlant(item.plantId)
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("review.open")
            }
        }
    }
}
