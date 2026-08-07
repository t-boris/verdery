import CoreDesignSystem
import SwiftUI

/// The recipient-side ownership-transfer review sheet, opened from
/// ``IncomingOwnershipTransferBanner``.
public struct IncomingOwnershipTransferReviewView: View {
    @State private var model: IncomingOwnershipTransferReviewViewModel
    let onFinish: () -> Void

    public init(model: IncomingOwnershipTransferReviewViewModel, onFinish: @escaping () -> Void) {
        _model = State(wrappedValue: model)
        self.onFinish = onFinish
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    SurfaceCard(tone: .neutral) {
                        VStack(alignment: .leading, spacing: Metrics.space3) {
                            HStack(spacing: Metrics.space3) {
                                IconMedallion(symbol: CollaborationSymbols.ownershipTransfer, label: model.title, tone: .neutral, isLarge: true)
                                Text(model.title)
                                    .font(FieldConsoleType.title.font)
                                    .foregroundStyle(Palette.text)
                            }
                            Text(model.message)
                                .font(FieldConsoleType.body.font)
                                .foregroundStyle(Palette.text)
                        }
                    }
                    .accessibilityIdentifier("collaborators.incomingTransfer.card")

                    if let resolvedMessage = model.resolvedMessage {
                        InlineMessage(resolvedMessage, tone: .neutral)
                            .accessibilityIdentifier("collaborators.incomingTransfer.resolved")

                        Button(model.notNowTitle, role: .cancel) { onFinish() }
                            .buttonStyle(SecondaryButtonStyle())
                            .accessibilityIdentifier("collaborators.incomingTransfer.close")
                    } else {
                        Button {
                            Task { await model.accept() }
                        } label: {
                            Label(model.acceptTitle, systemImage: "checkmark")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.isSubmitting)
                        .accessibilityIdentifier("collaborators.incomingTransfer.accept")

                        Button(model.declineTitle, role: .destructive) {
                            Task { await model.decline() }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(model.isSubmitting)
                        .accessibilityIdentifier("collaborators.incomingTransfer.decline")

                        Button(model.notNowTitle) { onFinish() }
                            .buttonStyle(.plain)
                            .foregroundStyle(Palette.textMuted)
                            .disabled(model.isSubmitting)
                            .accessibilityIdentifier("collaborators.incomingTransfer.notNow")
                    }
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
        }
    }
}
