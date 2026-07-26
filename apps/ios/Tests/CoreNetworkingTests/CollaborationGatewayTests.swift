import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers request construction (method, path, idempotency header, body) and
/// response decoding for every operation `URLSessionCollaborationGateway`
/// implements (P9A-API-01, P9A-OWNER-01). App-Check/Authorization header
/// wiring is already proven generically by `GardenGatewayTests` against the
/// same shared `HTTPTransport` — not re-proven per gateway here.
@Suite("Collaboration gateway")
struct CollaborationGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionCollaborationGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionCollaborationGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeCollaborationAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private func firstRequest(_ identifier: String) throws -> URLRequest {
        try #require(StubURLProtocol.requests(forSession: identifier).first)
    }

    private static let member = #"""
    {"id":"member-1","gardenId":"garden-1","profileId":"profile-1","role":"editor","state":"active",
     "createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z"}
    """#

    private static let invitation = #"""
    {"id":"invitation-1","gardenId":"garden-1","inviterProfileId":"profile-owner","intendedRole":"editor",
     "state":"pending","createdAt":"2024-01-01T00:00:00.000Z","expiresAt":"2024-01-08T00:00:00.000Z"}
    """#

    private static let createdInvitation = #"""
    {"id":"invitation-1","gardenId":"garden-1","inviterProfileId":"profile-owner","intendedRole":"editor",
     "state":"pending","createdAt":"2024-01-01T00:00:00.000Z","expiresAt":"2024-01-08T00:00:00.000Z",
     "token":"raw-token-value-at-least-32-chars"}
    """#

    private static let transfer = #"""
    {"id":"transfer-1","gardenId":"garden-1","fromProfileId":"profile-owner","toProfileId":"profile-1",
     "fromResultingRole":"editor","state":"pending","authenticatedAt":"2024-01-01T00:00:00.000Z",
     "requestedAt":"2024-01-01T00:00:00.000Z"}
    """#

    private static let incomingTransfer = #"""
    {"id":"transfer-2","gardenId":"garden-9","fromProfileId":"profile-owner","toProfileId":"profile-1",
     "fromResultingRole":"viewer","state":"pending","authenticatedAt":"2024-01-01T00:00:00.000Z",
     "requestedAt":"2024-01-01T00:00:00.000Z","gardenName":"Riverside Garden"}
    """#

    @Test("createInvitation POSTs with the idempotency header and decodes the one-time token")
    func createInvitation() async throws {
        let identifier = "create-invitation"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.createdInvitation))

        let created = try await gateway.createInvitation(
            gardenId: "garden-1", intendedRole: .editor, intendedEmail: nil, idempotencyKey: "key-1"
        )

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/invitations")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.idempotencyKeyHeader) == "key-1")
        #expect(created.token == "raw-token-value-at-least-32-chars")
        #expect(created.invitation.intendedRole == .editor)
    }

    @Test("listInvitations GETs the garden's invitations")
    func listInvitations() async throws {
        let identifier = "list-invitations"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items":[\#(Self.invitation)]}"#))

        let invitations = try await gateway.listInvitations(gardenId: "garden-1")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/gardens/garden-1/invitations")
        #expect(invitations.count == 1)
        #expect(invitations.first?.state == .pending)
    }

    @Test("revokeInvitation POSTs to the revoke path")
    func revokeInvitation() async throws {
        let identifier = "revoke-invitation"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.invitation))

        _ = try await gateway.revokeInvitation(gardenId: "garden-1", invitationId: "invitation-1", idempotencyKey: "key-2")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/invitations/invitation-1/revoke")
    }

    @Test("acceptInvitation POSTs to the top-level path with the raw token in the body")
    func acceptInvitation() async throws {
        let identifier = "accept-invitation"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.member))

        let member = try await gateway.acceptInvitation(token: "raw-token", idempotencyKey: "key-3")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/invitations/accept")
        #expect(member.profileId == "profile-1")
        #expect(member.role == .editor)
    }

    @Test("listMembers GETs the garden's member roster")
    func listMembers() async throws {
        let identifier = "list-members"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items":[\#(Self.member)]}"#))

        let members = try await gateway.listMembers(gardenId: "garden-1")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/gardens/garden-1/members")
        #expect(members.count == 1)
    }

    @Test("changeMemberRole PATCHes the member's path with the requested role")
    func changeMemberRole() async throws {
        let identifier = "change-role"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.member))

        _ = try await gateway.changeMemberRole(gardenId: "garden-1", profileId: "profile-1", role: .viewer, idempotencyKey: "key-4")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url?.path == "/v1/gardens/garden-1/members/profile-1")
    }

    @Test("removeMember sends DELETE to the member's path")
    func removeMember() async throws {
        let identifier = "remove-member"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.member))

        _ = try await gateway.removeMember(gardenId: "garden-1", profileId: "profile-1", idempotencyKey: "key-5")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path == "/v1/gardens/garden-1/members/profile-1")
    }

    @Test("promoteMember POSTs to the promote path")
    func promoteMember() async throws {
        let identifier = "promote-member"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.member))

        _ = try await gateway.promoteMember(gardenId: "garden-1", profileId: "profile-1", idempotencyKey: "key-6")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/members/profile-1/promote")
    }

    @Test("demoteOwner POSTs to the demote path with the resulting role")
    func demoteOwner() async throws {
        let identifier = "demote-owner"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.member))

        _ = try await gateway.demoteOwner(gardenId: "garden-1", profileId: "profile-1", role: .editor, idempotencyKey: "key-7")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/members/profile-1/demote")
    }

    @Test("transferOwnership POSTs the target and resulting role, and decodes a pending transfer")
    func transferOwnership() async throws {
        let identifier = "transfer-ownership"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.transfer))

        let transfer = try await gateway.transferOwnership(
            gardenId: "garden-1", toProfileId: "profile-1", resultingRole: .editor, idempotencyKey: "key-8"
        )

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/ownership-transfer")
        #expect(transfer.state == .pending)
        #expect(transfer.toProfileId == "profile-1")
    }

    @Test("cancelOwnershipTransfer sends DELETE to the ownership-transfer path")
    func cancelOwnershipTransfer() async throws {
        let identifier = "cancel-transfer"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.transfer))

        _ = try await gateway.cancelOwnershipTransfer(gardenId: "garden-1", idempotencyKey: "key-9")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path == "/v1/gardens/garden-1/ownership-transfer")
    }

    @Test("acceptOwnershipTransfer POSTs to the accept path")
    func acceptOwnershipTransfer() async throws {
        let identifier = "accept-transfer"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.transfer))

        _ = try await gateway.acceptOwnershipTransfer(gardenId: "garden-1", idempotencyKey: "key-10")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/ownership-transfer/accept")
    }

    @Test("declineOwnershipTransfer POSTs to the decline path")
    func declineOwnershipTransfer() async throws {
        let identifier = "decline-transfer"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.transfer))

        _ = try await gateway.declineOwnershipTransfer(gardenId: "garden-1", idempotencyKey: "key-11")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/gardens/garden-1/ownership-transfer/decline")
    }

    @Test("fetchGardenOwnershipTransfer GETs the garden-scoped path")
    func fetchGardenOwnershipTransfer() async throws {
        let identifier = "fetch-garden-transfer"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.transfer))

        let transfer = try await gateway.fetchGardenOwnershipTransfer(gardenId: "garden-1")

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/gardens/garden-1/ownership-transfer")
        #expect(transfer.state == .pending)
        #expect(transfer.toProfileId == "profile-1")
    }

    @Test("fetchGardenOwnershipTransfer throws the contract's not-found error when nothing is pending")
    func fetchGardenOwnershipTransferNotFound() async throws {
        let identifier = "fetch-garden-transfer-404"
        defer { StubURLProtocol.unregister(identifier) }
        let body = #"{"error":{"code":"collaboration.ownership_transfer.not_found","message":"Not found.","correlationId":"corr-1","retryable":false}}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(404, body))

        await #expect(throws: APIGatewayError.self) {
            _ = try await gateway.fetchGardenOwnershipTransfer(gardenId: "garden-1")
        }
    }

    @Test("fetchIncomingOwnershipTransfers GETs the top-level path and decodes the garden name")
    func fetchIncomingOwnershipTransfers() async throws {
        let identifier = "fetch-incoming-transfers"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items":[\#(Self.incomingTransfer)]}"#))

        let transfers = try await gateway.fetchIncomingOwnershipTransfers()

        let request = try firstRequest(identifier)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/ownership-transfers/incoming")
        #expect(transfers.count == 1)
        #expect(transfers.first?.gardenName == "Riverside Garden")
        #expect(transfers.first?.transfer.gardenId == "garden-9")
    }
}

private struct FixedCorrelationIdentifierProvider: CorrelationIdentifierProvider {
    let value: String

    func next() -> CorrelationIdentifier {
        CorrelationIdentifier(value: value)
    }
}

private struct FakeCollaborationAuthTokenProvider: AuthTokenProvider {
    let token: String?

    func currentIdToken() async throws -> String? { token }
}
