import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for administering the owner set itself (P9A-OWNER-01): promote,
/// demote, and the request/cancel/accept/decline ownership-transfer flow.
///
/// Split from `CollaborationUseCases.swift` purely to keep each file well
/// under this repository's 600-line rule — see that file's own doc comment
/// for the shared "online, gateway-backed, idempotency key generated here"
/// posture, which applies unchanged to every use case below.
///
/// Source: implementation-plan.md work package P9A-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Collaboration`.
public struct PromoteGardenMember: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, RECENT AUTH required — both enforced server-side. The
    /// target must hold ACTIVE `editor`/`viewer` membership.
    public func callAsFunction(gardenId: String, profileId: String) async throws -> GardenMember {
        try await gateway.promoteMember(gardenId: gardenId, profileId: profileId, idempotencyKey: UUIDv7.generate())
    }
}

public struct DemoteGardenOwner: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, RECENT AUTH required. Refused when the target is the
    /// garden's last active owner.
    public func callAsFunction(gardenId: String, profileId: String, role: CollaboratorRole) async throws -> GardenMember {
        try await gateway.demoteOwner(gardenId: gardenId, profileId: profileId, role: role, idempotencyKey: UUIDv7.generate())
    }
}

public struct RequestGardenOwnershipTransfer: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, RECENT AUTH required. Only REQUESTS — nobody's role
    /// changes until the named recipient accepts (or declines/the initiator
    /// cancels).
    public func callAsFunction(
        gardenId: String,
        toProfileId: String,
        resultingRole: CollaboratorRole
    ) async throws -> GardenOwnershipTransfer {
        try await gateway.transferOwnership(
            gardenId: gardenId,
            toProfileId: toProfileId,
            resultingRole: resultingRole,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct CancelGardenOwnershipTransfer: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only. The initiator's own withdrawal of their still-pending
    /// request.
    public func callAsFunction(gardenId: String) async throws -> GardenOwnershipTransfer {
        try await gateway.cancelOwnershipTransfer(gardenId: gardenId, idempotencyKey: UUIDv7.generate())
    }
}

public struct AcceptGardenOwnershipTransfer: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Called by the transfer's named recipient. NOT recent-auth-gated —
    /// accepting an offer addressed to oneself is the same risk category as
    /// accepting an invitation, unlike every other operation this feature
    /// exposes to an owner.
    public func callAsFunction(gardenId: String) async throws -> GardenOwnershipTransfer {
        try await gateway.acceptOwnershipTransfer(gardenId: gardenId, idempotencyKey: UUIDv7.generate())
    }
}

public struct DeclineGardenOwnershipTransfer: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Called by the transfer's named recipient — the symmetric refusal to
    /// ``AcceptGardenOwnershipTransfer``.
    public func callAsFunction(gardenId: String) async throws -> GardenOwnershipTransfer {
        try await gateway.declineOwnershipTransfer(gardenId: gardenId, idempotencyKey: UUIDv7.generate())
    }
}

/// Reads the garden's currently pending ownership transfer (P9A-OWNER-02) —
/// readable by the current owner or the transfer's own named recipient.
///
/// Translates the gateway's `collaboration.ownership_transfer.not_found`
/// `404` into `nil` rather than letting every call site re-derive that same
/// status-code-plus-code check independently: "nothing is pending" is a
/// legitimate, ordinary answer to this read, not a failure, the same
/// "absent means `nil`, not thrown" shape a repository-style lookup already
/// has everywhere else in this app. Any OTHER failure (transport, a
/// different service code, a contract mismatch) still propagates —
/// this only narrows the one specific case that means absence.
public struct FetchGardenOwnershipTransfer: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> GardenOwnershipTransfer? {
        do {
            return try await gateway.fetchGardenOwnershipTransfer(gardenId: gardenId)
        } catch let error as APIGatewayError {
            guard case let .service(body, statusCode, _) = error,
                  statusCode == 404, body.code == CollaborationErrorCode.transferNotFound
            else {
                throw error
            }
            return nil
        }
    }
}

/// Reads every pending ownership transfer addressed to the caller, across
/// every garden (P9A-OWNER-02) — profile-scoped, not garden-scoped. Always
/// succeeds with an empty array when nothing is pending.
public struct FetchIncomingGardenOwnershipTransfers: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction() async throws -> [IncomingGardenOwnershipTransfer] {
        try await gateway.fetchIncomingOwnershipTransfers()
    }
}
