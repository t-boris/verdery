import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureGardens

/// Coverage for every idempotency case `acceptInvitation` documents
/// (architecture/identity-and-authorization.md, section "10. Invitations")
/// that this client can distinguish. "Already a member" is deliberately
/// absent — see `AcceptInvitationViewModel`'s own doc comment for why the
/// contract folds it into an ordinary success rather than a separate state.
@Suite("Accept invitation view model")
@MainActor
struct AcceptInvitationViewModelTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func makeModel(
        token: String = "token-1",
        gateway: FakeCollaborationGateway,
        gardenGateway: FakeGardenGatewayForAccept
    ) throws -> AcceptInvitationViewModel {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        let store = GRDBGardenStore(dbQueue: dbQueue)

        return AcceptInvitationViewModel(
            token: token,
            acceptInvitation: AcceptGardenInvitation(gateway: gateway),
            getGarden: GetGarden(gateway: gardenGateway, localStore: store),
            strings: strings
        )
    }

    @Test("A fresh acceptance succeeds and resolves the joined garden's name")
    func acceptSucceeds() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptInvitationResult = .success(fakeGardenMember(gardenId: "garden-1"))
        let gardenGateway = FakeGardenGatewayForAccept()
        gardenGateway.gardenToReturn = testGarden(id: "garden-1", name: "Backyard")
        let model = try makeModel(gateway: gateway, gardenGateway: gardenGateway)

        await model.accept()

        guard case let .succeeded(gardenId, gardenName) = model.state else {
            Issue.record("Expected .succeeded")
            return
        }
        #expect(gardenId == "garden-1")
        #expect(gardenName == "Backyard")
        #expect(model.successMessage(gardenName: gardenName) == strings.string(.collaborationAcceptInvitationSuccess, parameters: ["garden": "Backyard"]))
    }

    @Test("An expired or revoked invitation reports the same honest message either way")
    func expiredOrRevoked() async throws {
        for code in ["collaboration.invitation.expired", "collaboration.invitation.revoked"] {
            let gateway = FakeCollaborationGateway()
            gateway.acceptInvitationResult = .failure(fakeServiceError(code: code, statusCode: 409))
            let model = try makeModel(gateway: gateway, gardenGateway: FakeGardenGatewayForAccept())

            await model.accept()

            guard case let .failed(message) = model.state else {
                Issue.record("Expected .failed for \(code)")
                continue
            }
            #expect(message == strings(.collaborationAcceptInvitationExpiredOrRevoked))
        }
    }

    @Test("An already-accepted invitation is reported distinctly")
    func alreadyAccepted() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptInvitationResult = .failure(fakeServiceError(code: "collaboration.invitation.already_accepted", statusCode: 409))
        let model = try makeModel(gateway: gateway, gardenGateway: FakeGardenGatewayForAccept())

        await model.accept()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.collaborationAcceptInvitationAlreadyAccepted))
    }

    @Test("An email-bound invitation the caller's verified address does not match is reported distinctly")
    func emailMismatch() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptInvitationResult = .failure(fakeServiceError(code: "collaboration.invitation.email_mismatch", statusCode: 403))
        let model = try makeModel(gateway: gateway, gardenGateway: FakeGardenGatewayForAccept())

        await model.accept()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.collaborationAcceptInvitationEmailMismatch))
    }

    @Test("An unknown token falls back to the generic failure message")
    func unknownToken() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptInvitationResult = .failure(fakeServiceError(code: "collaboration.invitation.not_found", statusCode: 404))
        let model = try makeModel(gateway: gateway, gardenGateway: FakeGardenGatewayForAccept())

        await model.accept()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.collaborationAcceptInvitationGenericFailure))
    }

    @Test("Connectivity failure is reported as a network problem, not the generic invitation failure")
    func transportFailure() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.acceptInvitationResult = .failure(APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "fake"))
        let model = try makeModel(gateway: gateway, gardenGateway: FakeGardenGatewayForAccept())

        await model.accept()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.networkUnreachable))
    }

    private func testGarden(id: String, name: String) -> Garden {
        Garden(
            id: id, name: name, lifecycleState: .active, callerRole: .editor,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }
}

/// Minimal `GardenGateway` stand-in, shared with `GardenSettingsViewModelTests`
/// — every operation returns `gardenToReturn`, or throws `errorToThrow` when
/// set (used to simulate `get`'s `garden.not_found` revocation response).
final class FakeGardenGatewayForAccept: GardenGateway, @unchecked Sendable {
    var gardenToReturn = Garden(
        id: "garden-1", name: "Fallback", lifecycleState: .active, callerRole: .editor,
        revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
    )
    var errorToThrow: Error?

    func list(cursor: String?) async throws -> GardenPage { GardenPage(items: [], nextCursor: nil) }
    func create(name: String, idempotencyKey: String) async throws -> Garden { gardenToReturn }

    func get(gardenId: String) async throws -> Garden {
        if let errorToThrow { throw errorToThrow }
        return gardenToReturn
    }

    func rename(gardenId: String, name: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden { gardenToReturn }
    func archive(gardenId: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden { gardenToReturn }
    func requestDeletion(gardenId: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden { gardenToReturn }
}
