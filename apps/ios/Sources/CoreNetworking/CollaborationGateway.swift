import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the operational collaboration operations:
/// invitations and member-roster administration (P9A-API-01).
///
/// Features depend on this protocol, never on URLSession or on a generated
/// client, so a feature test needs no network and no server — the same
/// reason ``GardenGateway`` exists.
///
/// Owner administration of the owner set itself (promote/demote/transfer,
/// P9A-OWNER-01) is declared in this same protocol rather than a sibling one:
/// both are the one `Collaboration` tag in the contract, and every operation
/// shares the same authenticated-garden-member shape this gateway already
/// exists to wrap. The `URLSessionCollaborationGateway` implementation splits
/// across two files (see `CollaborationGateway+OwnershipAdministration.swift`)
/// purely to stay under this repository's 600-line-per-file rule — Swift
/// lets a type satisfy a protocol's requirements across more than one
/// extension in the same module, so this stays one protocol, and a fake
/// conforming to it in a test needs only one declaration.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Collaboration`.
public protocol CollaborationGateway: Sendable {
    /// Owner-only. `intendedEmail` omitted (`nil`) creates an unbound
    /// invitation shareable with anyone who receives the link.
    func createInvitation(
        gardenId: String,
        intendedRole: CollaboratorRole,
        intendedEmail: String?,
        idempotencyKey: String
    ) async throws -> CreatedGardenInvitation

    /// Owner-only. Every invitation regardless of state, newest first.
    func listInvitations(gardenId: String) async throws -> [GardenInvitation]

    /// Owner-only. Idempotent — revoking an already-resolved invitation
    /// returns its current state unchanged rather than an error.
    func revokeInvitation(gardenId: String, invitationId: String, idempotencyKey: String) async throws -> GardenInvitation

    /// Grants the AUTHENTICATED caller (identified by session, not by the
    /// token alone) the invitation's intended role.
    func acceptInvitation(token: String, idempotencyKey: String) async throws -> GardenMember

    /// Every active role may read this — see `garden-capability-matrix.md`,
    /// row H2 / decision S1.
    func listMembers(gardenId: String) async throws -> [GardenMember]

    /// Owner-only. Moves a non-owner member between `editor` and `viewer`.
    func changeMemberRole(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember

    /// A caller may always remove THEMSELVES; removing anyone else requires
    /// the owner-only capability. Refused with `422` when it would leave the
    /// garden with no active owner.
    func removeMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember

    // MARK: Owner-set administration (P9A-OWNER-01)
    //
    // Implemented by `URLSessionCollaborationGateway` in
    // `CollaborationGateway+OwnershipAdministration.swift`, split out purely
    // to stay under this repository's 600-line-per-file rule — Swift lets a
    // type satisfy a protocol's requirements across more than one extension
    // in the same module, so this stays one protocol rather than two.

    /// Owner-only, RECENT AUTH required. The target must hold ACTIVE
    /// `editor`/`viewer` membership; promoting an already-`owner` target is a
    /// no-op, unchanged.
    func promoteMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember

    /// Owner-only, RECENT AUTH required. Refused when the target is the
    /// garden's last active owner.
    func demoteOwner(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember

    /// Owner-only, RECENT AUTH required. Only REQUESTS — nobody's role
    /// changes until the named recipient accepts.
    func transferOwnership(
        gardenId: String,
        toProfileId: String,
        resultingRole: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenOwnershipTransfer

    /// Owner-only. The initiator's own withdrawal of a still-pending request.
    func cancelOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer

    /// Called by the transfer's named recipient. NOT recent-auth-gated —
    /// accepting an offer addressed to oneself is the same risk category as
    /// `acceptInvitation`, unlike every other operation on this gateway.
    func acceptOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer

    /// Called by the transfer's named recipient — the symmetric refusal to
    /// ``acceptOwnershipTransfer``.
    func declineOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer

    // MARK: Ownership-transfer reads (P9A-OWNER-02)
    //
    // Close the one real gap the write-only surface above left: neither
    // party to a transfer could confirm it was still pending after a page
    // reload except by attempting a mutation and reading its `404` as
    // "nothing was pending" — see each operation's own doc comment.

    /// The garden's currently PENDING ownership transfer, if any.
    ///
    /// Readable by two parties: the current owner (checking a transfer they
    /// requested) or the transfer's own named recipient (checking an offer
    /// addressed to them). Throws with `collaboration.ownership_transfer
    /// .not_found` (`404`) both when nothing is pending for this garden AND
    /// when a transfer is pending but the caller is neither party — the same
    /// concealment `acceptOwnershipTransfer`/`declineOwnershipTransfer`
    /// already apply.
    func fetchGardenOwnershipTransfer(gardenId: String) async throws -> GardenOwnershipTransfer

    /// Every PENDING transfer, across every garden, addressed to the caller
    /// — profile-scoped, not garden-scoped, mirroring `listGardens`. Always
    /// succeeds with an empty list when nothing is pending, never a `404`;
    /// this is the read that lets a recipient discover an offer without
    /// already knowing which garden it concerns.
    func fetchIncomingOwnershipTransfers() async throws -> [IncomingGardenOwnershipTransfer]
}

/// URLSession-backed implementation of the collaboration operations.
///
/// See ``CollaborationGateway``'s own doc comment for why the owner-
/// administration half of this conformance (promote/demote/transfer/cancel/
/// accept/decline) lives in `CollaborationGateway+OwnershipAdministration.swift`
/// instead of here.
public struct URLSessionCollaborationGateway: CollaborationGateway {
    let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func createInvitation(
        gardenId: String,
        intendedRole: CollaboratorRole,
        intendedEmail: String?,
        idempotencyKey: String
    ) async throws -> CreatedGardenInvitation {
        let result: InvitationTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/invitations",
            body: CreateInvitationRequestTransport(intendedRole: intendedRole.rawValue, intendedEmail: intendedEmail),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )

        guard let created = result.createdDomainValue else {
            throw APIGatewayError.undecodableResponse(statusCode: 201, correlationId: "")
        }
        return created
    }

    public func listInvitations(gardenId: String) async throws -> [GardenInvitation] {
        let result: InvitationListResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/invitations",
            acceptedStatusCodes: [200]
        )

        return try result.items.map(domainInvitation)
    }

    public func revokeInvitation(
        gardenId: String,
        invitationId: String,
        idempotencyKey: String
    ) async throws -> GardenInvitation {
        let result: InvitationTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/invitations/\(invitationId)/revoke",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainInvitation(result)
    }

    public func acceptInvitation(token: String, idempotencyKey: String) async throws -> GardenMember {
        let result: GardenMemberTransport = try await transport.send(
            method: "POST",
            operationPath: "invitations/accept",
            body: AcceptInvitationRequestTransport(token: token),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainMember(result)
    }

    public func listMembers(gardenId: String) async throws -> [GardenMember] {
        let result: GardenMemberListResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/members",
            acceptedStatusCodes: [200]
        )

        return try result.items.map(domainMember)
    }

    public func changeMemberRole(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember {
        let result: GardenMemberTransport = try await transport.send(
            method: "PATCH",
            operationPath: "gardens/\(gardenId)/members/\(profileId)",
            body: ChangeGardenMemberRoleRequestTransport(role: role.rawValue),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainMember(result)
    }

    public func removeMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember {
        let result: GardenMemberTransport = try await transport.send(
            method: "DELETE",
            operationPath: "gardens/\(gardenId)/members/\(profileId)",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainMember(result)
    }

    func domainMember(_ transport: GardenMemberTransport) throws -> GardenMember {
        guard let member = transport.domainValue else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        return member
    }

    func domainInvitation(_ transport: InvitationTransport) throws -> GardenInvitation {
        guard let invitation = transport.domainValue else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        return invitation
    }
}
