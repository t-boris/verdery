import CoreDesignSystem
import SwiftUI

/// The accept-invitation screen: the landing page a `verdery://invite?token=`
/// deep link opens into, presented full-screen from `AppComposition.RootView`
/// while `CollaborationSessionState.pendingInvitationToken` is set.
public struct AcceptInvitationView: View {
    @State private var model: AcceptInvitationViewModel
    let onOpenGarden: (String, String) -> Void
    let onClose: () -> Void

    public init(
        model: AcceptInvitationViewModel,
        onOpenGarden: @escaping (String, String) -> Void,
        onClose: @escaping () -> Void
    ) {
        _model = State(wrappedValue: model)
        self.onOpenGarden = onOpenGarden
        self.onClose = onClose
    }

    public var body: some View {
        NavigationStack {
            content
                .navigationTitle(model.title)
                .inlineNavigationTitle()
                .screenBackground()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(model.closeTitle) { onClose() }
                    }
                }
                .task { await model.accept() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .accepting:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("collaborators.acceptInvitation.loading")

        case let .succeeded(gardenId, gardenName):
            VStack(spacing: Metrics.space5) {
                IconMedallion(symbol: "checkmark.seal.fill", label: model.title, tone: .positive, isLarge: true)
                Text(model.successMessage(gardenName: gardenName))
                    .font(FieldConsoleType.title.font)
                    .foregroundStyle(Palette.text)
                    .multilineTextAlignment(.center)

                Button(model.openGardenTitle) {
                    onOpenGarden(gardenId, gardenName)
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("collaborators.acceptInvitation.openGarden")
            }
            .padding(Metrics.space5)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("collaborators.acceptInvitation.succeeded")

        case let .failed(message):
            FailureStateView(message: message)
                .accessibilityIdentifier("collaborators.acceptInvitation.failed")
        }
    }
}
