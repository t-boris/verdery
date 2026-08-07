import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The account-deletion screen.
///
/// Deliberately plain and slow to complete. Everything else in this redesign
/// removes friction; this is the one place that adds it, because the action is
/// irreversible after a deadline and there is no undo afterwards.
public struct DeleteAccountView: View {
    @State private var model: DeleteAccountViewModel
    private let close: () -> Void

    public init(model: DeleteAccountViewModel, close: @escaping () -> Void) {
        _model = State(wrappedValue: model)
        self.close = close
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    content
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle, action: close)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading, .submitting:
            LoadingStateView(model.title)
                .accessibilityIdentifier("account.delete.loading")

        case .idle:
            requestForm

        case let .pending(deletion):
            pendingView(deletion)

        case let .done(deletion):
            EmptyStateView(
                symbol: "checkmark.circle",
                title: model.pendingTitle,
                message: model.deadlineText(deletion)
            )
            .accessibilityIdentifier("account.delete.done")

        case let .failed(message):
            VStack(alignment: .leading, spacing: Metrics.space3) {
                InlineMessage(message, tone: .negative)
                    .accessibilityIdentifier("account.delete.failure")
                requestForm
            }
        }
    }

    private var requestForm: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            // Names what is destroyed rather than saying "your account": an
            // account here means every garden, plant, observation and
            // photograph, and somebody agreeing to this should be agreeing to
            // that.
            SurfaceCard {
                Text(model.explanation)
                    .font(FieldConsoleType.body.font)
                    .foregroundStyle(Palette.text)
            }

            ComposerField(
                symbol: "exclamationmark.triangle",
                accessibilityName: model.confirmationPrompt,
                placeholder: model.confirmationWord,
                commitLabel: model.deleteButtonTitle,
                text: $model.confirmationText,
                commit: {}
            )
            .accessibilityIdentifier("account.delete.confirmField")

            Button(model.deleteButtonTitle) {
                Task { await model.requestDeletion() }
            }
            .buttonStyle(SecondaryButtonStyle(tone: .negative))
            .disabled(!model.isDeleteEnabled)
            .accessibilityIdentifier("account.delete.submit")
        }
    }

    private func pendingView(_ deletion: AccountDeletion) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            SurfaceCard(tone: .warning) {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text(model.pendingTitle)
                        .font(FieldConsoleType.heading.font)
                        .foregroundStyle(Palette.text)
                    // Apple accepts a disclosed grace period and rejects an
                    // undisclosed one, and somebody who changed their mind
                    // needs to know how long they have.
                    Text(model.deadlineText(deletion))
                        .font(FieldConsoleType.mono.font)
                        .foregroundStyle(Palette.textMuted)
                }
            }

            ForEach(deletion.gardens, id: \.gardenId) { garden in
                SurfaceCard {
                    Text(model.gardenSummary(garden))
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.text)
                }
            }

            if deletion.isReversible {
                Button(model.restoreButtonTitle) {
                    Task { await model.restore() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("account.delete.restore")
            }
        }
    }
}
