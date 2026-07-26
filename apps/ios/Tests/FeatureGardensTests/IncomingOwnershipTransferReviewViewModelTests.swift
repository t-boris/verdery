import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureGardens

/// Covers the recipient side of a pending ownership transfer, including the
/// no-`GET`-endpoint staleness cases `IncomingOwnershipTransferReviewViewModel`'s
/// own doc comment documents.
@Suite("Incoming ownership transfer review view model")
@MainActor
struct IncomingOwnershipTransferReviewViewModelTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func makeModel(
        gateway: FakeCollaborationGateway,
        gardenId: String = "garden-1",
        sessionState: CollaborationSessionState = CollaborationSessionState()
    ) -> IncomingOwnershipTransferReviewViewModel {
        IncomingOwnershipTransferReviewViewModel(
            gardenId: gardenId,
            gardenName: "Backyard",
            acceptTransfer: AcceptGardenOwnershipTransfer(gateway: gateway),
            declineTransfer: DeclineGardenOwnershipTransfer(gateway: gateway),
            sessionState: sessionState,
            strings: strings
        )
    }

    @Test("Accepting succeeds and clears this garden's incoming hint")
    func acceptSucceeds() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptOwnershipTransferResult = .success(fakeOwnershipTransfer(gardenId: "garden-1", state: .completed))
        let sessionState = CollaborationSessionState()
        sessionState.handleDeepLink(try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-1")))
        let model = makeModel(gateway: gateway, sessionState: sessionState)

        await model.accept()

        #expect(model.resolvedMessage == strings(.collaborationOwnershipTransferRecipientAcceptedMessage))
        #expect(!sessionState.hasIncomingTransferHint(gardenId: "garden-1"))
        #expect(gateway.acceptOwnershipTransferCalls == ["garden-1"])
    }

    @Test("Declining succeeds and clears this garden's incoming hint")
    func declineSucceeds() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.declineOwnershipTransferResult = .success(fakeOwnershipTransfer(gardenId: "garden-1", state: .cancelled))
        let sessionState = CollaborationSessionState()
        sessionState.handleDeepLink(try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-1")))
        let model = makeModel(gateway: gateway, sessionState: sessionState)

        await model.decline()

        #expect(model.resolvedMessage == strings(.collaborationOwnershipTransferRecipientDeclinedMessage))
        #expect(!sessionState.hasIncomingTransferHint(gardenId: "garden-1"))
    }

    @Test(
        "A transfer already resolved elsewhere reports the honest stale message and clears the hint",
        arguments: [
            "collaboration.ownership_transfer.not_found",
            "collaboration.membership.not_found",
            "collaboration.membership.target_not_owner",
            "collaboration.membership.target_already_owner",
        ]
    )
    func staleTransferCodes(_ code: String) async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptOwnershipTransferResult = .failure(fakeServiceError(code: code, statusCode: 404))
        let sessionState = CollaborationSessionState()
        sessionState.handleDeepLink(try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-1")))
        let model = makeModel(gateway: gateway, sessionState: sessionState)

        await model.accept()

        #expect(model.resolvedMessage == strings(.collaborationOwnershipTransferRecipientStaleMessage))
        #expect(!sessionState.hasIncomingTransferHint(gardenId: "garden-1"))
    }

    @Test("A transient failure keeps the hint — it is not proof the offer is gone")
    func transientFailureKeepsHint() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptOwnershipTransferResult = .failure(APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "fake"))
        let sessionState = CollaborationSessionState()
        sessionState.handleDeepLink(try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-1")))
        let model = makeModel(gateway: gateway, sessionState: sessionState)

        await model.accept()

        #expect(model.resolvedMessage == strings(.networkUnreachable))
        #expect(sessionState.hasIncomingTransferHint(gardenId: "garden-1"))
    }
}
