import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for garden invitations and the member roster (P9A-API-01).
///
/// Every one of these is ONLINE, gateway-backed — the same deliberate,
/// documented posture `FeatureRecommendations.TodayUseCases` establishes for
/// the Today surface: none of this is a synced record family (invitations
/// and membership rows are not part of the offline sync push/pull
/// protocol), so there is no local read model to project against and no
/// offline command to queue. The idempotency key is generated here, inside
/// each use case's `callAsFunction` — the same responsibility split
/// `TodayUseCases`/`SubmitMapCommand` already use: the gateway shapes the
/// request, the use case supplies what varies per attempt.
///
/// Owner administration of the owner set itself (promote/demote/transfer,
/// P9A-OWNER-01) is declared in `OwnershipAdministrationUseCases.swift`
/// instead, purely to keep each file well under this repository's 600-line
/// rule.
///
/// Source: implementation-plan.md work package P9A-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Collaboration`.
public struct ListGardenMembers: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Every active role may call this — see `garden-capability-matrix.md`,
    /// row H2 / decision S1.
    public func callAsFunction(gardenId: String) async throws -> [GardenMember] {
        try await gateway.listMembers(gardenId: gardenId)
    }
}

public struct CreateGardenInvitation: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, enforced server-side. `intendedEmail` is trimmed and
    /// passed through as `nil` when blank — an unbound invitation shareable
    /// with anyone who receives the link.
    public func callAsFunction(
        gardenId: String,
        intendedRole: CollaboratorRole,
        intendedEmail: String
    ) async throws -> CreatedGardenInvitation {
        let trimmedEmail = intendedEmail.trimmingCharacters(in: .whitespacesAndNewlines)

        return try await gateway.createInvitation(
            gardenId: gardenId,
            intendedRole: intendedRole,
            intendedEmail: trimmedEmail.isEmpty ? nil : trimmedEmail,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct ListGardenInvitations: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, enforced server-side. Every invitation regardless of
    /// state, newest first.
    public func callAsFunction(gardenId: String) async throws -> [GardenInvitation] {
        try await gateway.listInvitations(gardenId: gardenId)
    }
}

public struct RevokeGardenInvitation: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, enforced server-side. Idempotent — revoking an
    /// already-resolved invitation returns its current state unchanged.
    public func callAsFunction(gardenId: String, invitationId: String) async throws -> GardenInvitation {
        try await gateway.revokeInvitation(gardenId: gardenId, invitationId: invitationId, idempotencyKey: UUIDv7.generate())
    }
}

/// Not garden-scoped: this is the top-level `/invitations/accept` operation,
/// identified by the raw token plus the caller's own authenticated session —
/// the entry point a `verdery://invite?token=` deep link resolves into.
public struct AcceptGardenInvitation: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(token: String) async throws -> GardenMember {
        try await gateway.acceptInvitation(token: token, idempotencyKey: UUIDv7.generate())
    }
}

public struct ChangeGardenMemberRole: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// Owner-only, enforced server-side. Moves a non-owner member between
    /// `editor` and `viewer` only.
    public func callAsFunction(gardenId: String, profileId: String, role: CollaboratorRole) async throws -> GardenMember {
        try await gateway.changeMemberRole(gardenId: gardenId, profileId: profileId, role: role, idempotencyKey: UUIDv7.generate())
    }
}

public struct RemoveGardenMember: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    /// A caller may always remove THEMSELVES; removing anyone else requires
    /// the owner-only capability, enforced server-side either way. Refused
    /// with `422` when it would leave the garden with no active owner.
    public func callAsFunction(gardenId: String, profileId: String) async throws -> GardenMember {
        try await gateway.removeMember(gardenId: gardenId, profileId: profileId, idempotencyKey: UUIDv7.generate())
    }
}
