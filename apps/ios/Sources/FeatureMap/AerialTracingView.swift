import CoreDesignSystem
import CoreDomain
import SwiftUI

/// What the photograph shows, for a person to accept or leave.
public struct AerialTracingView: View {
    @State private var model: AerialTracingViewModel
    private let accept: ([AerialTracingProposal]) -> Void
    private let close: () -> Void

    public init(
        model: AerialTracingViewModel,
        accept: @escaping ([AerialTracingProposal]) -> Void,
        close: @escaping () -> Void
    ) {
        _model = State(wrappedValue: model)
        self.accept = accept
        self.close = close
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    SurfaceCard {
                        Text(model.explanation)
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.text)
                    }
                    content
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle, action: close)
                }
            }
            .task { await model.run() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .tracing:
            LoadingStateView(model.tracingMessage)
                .accessibilityIdentifier("aerial.tracing")

        case .needsGeoreference:
            // The one failure the reader can resolve themselves.
            InlineMessage(model.needsGeoreferenceMessage, tone: .warning)
                .accessibilityIdentifier("aerial.needsGeoreference")

        case let .failed(message):
            FailureStateView(message: message, retryTitle: nil, retry: nil)
                .accessibilityIdentifier("aerial.failure")

        case let .reviewing(tracing) where tracing.proposals.isEmpty:
            EmptyStateView(symbol: "photo", title: model.title, message: model.emptyMessage)
                .accessibilityIdentifier("aerial.empty")

        case let .reviewing(tracing):
            VStack(alignment: .leading, spacing: Metrics.space3) {
                ForEach(tracing.proposals) { proposal in
                    row(proposal)
                }

                Button(model.acceptTitle) { accept(model.accepted) }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!model.canAccept)
                    .accessibilityIdentifier("aerial.accept")

                // The provider's own statement about what the imagery can and
                // cannot support, rendered verbatim. Paraphrasing it would be
                // this application making that claim instead of quoting it.
                Text(tracing.disclaimer)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
                    .accessibilityIdentifier("aerial.disclaimer")
            }
        }
    }

    private func row(_ proposal: AerialTracingProposal) -> some View {
        Button {
            model.toggle(proposal)
        } label: {
            SurfaceCard {
                HStack(spacing: Metrics.space3) {
                    Image(
                        systemName: model.isAccepted(proposal)
                            ? "checkmark.square.fill" : "square"
                    )
                    .foregroundStyle(
                        model.isAccepted(proposal) ? Palette.interaction : Palette.border
                    )

                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(model.label(proposal))
                            .font(FieldConsoleType.bodyStrong.font)
                            .foregroundStyle(Palette.text)
                        // Named, not coloured: "Seen" and "Guessed" are
                        // different claims about the same photograph, and a
                        // reviewer needs the word rather than a hue.
                        Chip(
                            symbol: proposal.evidence == .visible ? "eye" : "questionmark.circle",
                            label: model.evidenceName(proposal.evidence),
                            tone: proposal.evidence == .visible ? .positive : .warning
                        )
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.isAccepted(proposal) ? [.isSelected] : [])
        .accessibilityIdentifier("aerial.proposal.\(proposal.id)")
    }
}
