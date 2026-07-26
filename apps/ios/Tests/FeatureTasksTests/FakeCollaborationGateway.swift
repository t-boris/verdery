import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for `CollaborationGateway`, scoped to
/// exactly what `FeatureTasks`'s own tests need: `listMembers(gardenId:)`,
/// the one method `ListGardenMembers` calls. Every other requirement is a
/// real, callable implementation (not a `fatalError` stub) so this stays a
/// safe, honest conformance — but none of them is exercised by any
/// `FeatureTasksTests` case today, since assignment/activity are the only
/// collaboration-shaped surfaces this feature owns.
final class FakeCollaborationGateway: CollaborationGateway, @unchecked Sendable {
    private var members: [String: GardenMember]

    init(members: [GardenMember] = []) {
        self.members = Dictionary(uniqueKeysWithValues: members.map { ($0.profileId, $0) })
    }

    func listMembers(gardenId: String) async throws -> [GardenMember] {
        Array(members.values).filter { $0.gardenId == gardenId }
    }

    func createInvitation(
        gardenId: String,
        intendedRole: CollaboratorRole,
        intendedEmail: String?,
        idempotencyKey: String
    ) async throws -> CreatedGardenInvitation {
        CreatedGardenInvitation(
            invitation: GardenInvitation(
                id: "invitation-1", gardenId: gardenId, inviterProfileId: "profile-1",
                intendedRole: intendedRole, intendedEmail: intendedEmail, state: .pending,
                createdAt: Date(timeIntervalSince1970: 0), expiresAt: Date(timeIntervalSince1970: 1),
                acceptedAt: nil, revokedAt: nil, resultingMembershipId: nil
            ),
            token: "token-1"
        )
    }

    func listInvitations(gardenId: String) async throws -> [GardenInvitation] { [] }

    func revokeInvitation(gardenId: String, invitationId: String, idempotencyKey: String) async throws -> GardenInvitation {
        GardenInvitation(
            id: invitationId, gardenId: gardenId, inviterProfileId: "profile-1", intendedRole: .editor,
            intendedEmail: nil, state: .revoked, createdAt: Date(timeIntervalSince1970: 0),
            expiresAt: Date(timeIntervalSince1970: 1), acceptedAt: nil, revokedAt: Date(timeIntervalSince1970: 2),
            resultingMembershipId: nil
        )
    }

    func acceptInvitation(token: String, idempotencyKey: String) async throws -> GardenMember {
        GardenMember(
            id: "member-1", gardenId: "garden-1", profileId: "profile-1", role: .editor, state: .active,
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    func changeMemberRole(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember {
        guard let existing = members[profileId] else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-not-found")
        }
        let updated = GardenMember(
            id: existing.id, gardenId: existing.gardenId, profileId: existing.profileId, role: role.gardenRole,
            state: existing.state, createdAt: existing.createdAt, updatedAt: Date(timeIntervalSince1970: 1)
        )
        members[profileId] = updated
        return updated
    }

    func removeMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember {
        guard let existing = members[profileId] else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-not-found")
        }
        members[profileId] = nil
        return existing
    }

    func promoteMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember {
        guard let existing = members[profileId] else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-not-found")
        }
        let updated = GardenMember(
            id: existing.id, gardenId: existing.gardenId, profileId: existing.profileId, role: .owner,
            state: existing.state, createdAt: existing.createdAt, updatedAt: Date(timeIntervalSince1970: 1)
        )
        members[profileId] = updated
        return updated
    }

    func demoteOwner(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember {
        guard let existing = members[profileId] else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-not-found")
        }
        let updated = GardenMember(
            id: existing.id, gardenId: existing.gardenId, profileId: existing.profileId, role: role.gardenRole,
            state: existing.state, createdAt: existing.createdAt, updatedAt: Date(timeIntervalSince1970: 1)
        )
        members[profileId] = updated
        return updated
    }

    func transferOwnership(
        gardenId: String,
        toProfileId: String,
        resultingRole: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenOwnershipTransfer {
        GardenOwnershipTransfer(
            id: "transfer-1", gardenId: gardenId, fromProfileId: "profile-1", toProfileId: toProfileId,
            fromResultingRole: resultingRole, state: .pending, requestedAt: Date(timeIntervalSince1970: 0),
            completedAt: nil, cancelledAt: nil, cancellationReason: nil
        )
    }

    func cancelOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        GardenOwnershipTransfer(
            id: "transfer-1", gardenId: gardenId, fromProfileId: "profile-1", toProfileId: "profile-2",
            fromResultingRole: .editor, state: .cancelled, requestedAt: Date(timeIntervalSince1970: 0),
            completedAt: nil, cancelledAt: Date(timeIntervalSince1970: 1), cancellationReason: nil
        )
    }

    func acceptOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        GardenOwnershipTransfer(
            id: "transfer-1", gardenId: gardenId, fromProfileId: "profile-1", toProfileId: "profile-2",
            fromResultingRole: .editor, state: .completed, requestedAt: Date(timeIntervalSince1970: 0),
            completedAt: Date(timeIntervalSince1970: 1), cancelledAt: nil, cancellationReason: nil
        )
    }

    func declineOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        GardenOwnershipTransfer(
            id: "transfer-1", gardenId: gardenId, fromProfileId: "profile-1", toProfileId: "profile-2",
            fromResultingRole: .editor, state: .cancelled, requestedAt: Date(timeIntervalSince1970: 0),
            completedAt: nil, cancelledAt: Date(timeIntervalSince1970: 1), cancellationReason: "declined"
        )
    }

    // MARK: Ownership-transfer reads (P9A-OWNER-02)
    //
    // Same "real, callable, but unexercised by any FeatureTasksTests case"
    // posture as every method above — this feature never reads either.

    func fetchGardenOwnershipTransfer(gardenId: String) async throws -> GardenOwnershipTransfer {
        GardenOwnershipTransfer(
            id: "transfer-1", gardenId: gardenId, fromProfileId: "profile-1", toProfileId: "profile-2",
            fromResultingRole: .editor, state: .pending, requestedAt: Date(timeIntervalSince1970: 0),
            completedAt: nil, cancelledAt: nil, cancellationReason: nil
        )
    }

    func fetchIncomingOwnershipTransfers() async throws -> [IncomingGardenOwnershipTransfer] { [] }
}
