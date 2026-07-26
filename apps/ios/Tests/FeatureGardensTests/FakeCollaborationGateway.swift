import CoreDomain
import CoreNetworking
import Foundation

@testable import FeatureGardens

/// In-memory, non-networked stand-in for `CollaborationGateway` — every
/// operation is independently configurable to either return a value or throw,
/// and every call is recorded, so a test can assert both the outcome
/// `CollaboratorsViewModel`/`AcceptInvitationViewModel`/
/// `IncomingOwnershipTransferReviewViewModel` produce AND the exact arguments
/// each use case actually sent.
final class FakeCollaborationGateway: CollaborationGateway, @unchecked Sendable {
    var members: [GardenMember] = []
    var invitations: [GardenInvitation] = []
    var createInvitationResult: Result<CreatedGardenInvitation, Error> = .failure(unconfiguredError)
    var revokeInvitationResult: Result<GardenInvitation, Error> = .failure(unconfiguredError)
    var acceptInvitationResult: Result<GardenMember, Error> = .failure(unconfiguredError)
    var changeMemberRoleResult: Result<GardenMember, Error> = .failure(unconfiguredError)
    var removeMemberResult: Result<GardenMember, Error> = .failure(unconfiguredError)
    var promoteMemberResult: Result<GardenMember, Error> = .failure(unconfiguredError)
    var demoteOwnerResult: Result<GardenMember, Error> = .failure(unconfiguredError)
    var transferOwnershipResult: Result<GardenOwnershipTransfer, Error> = .failure(unconfiguredError)
    var cancelOwnershipTransferResult: Result<GardenOwnershipTransfer, Error> = .failure(unconfiguredError)
    var acceptOwnershipTransferResult: Result<GardenOwnershipTransfer, Error> = .failure(unconfiguredError)
    var declineOwnershipTransferResult: Result<GardenOwnershipTransfer, Error> = .failure(unconfiguredError)
    /// Defaults to the contract's own "nothing pending" `404`, not the
    /// generic unconfigured-error every write operation above defaults to:
    /// this is a read, and most `CollaboratorsViewModel` tests that exercise
    /// unrelated behavior call `load()`/`reload()` (via `isOwner: true`)
    /// without caring about ownership transfer at all — the same reason
    /// `members`/`invitations` below default to empty rather than failing.
    var fetchGardenOwnershipTransferResult: Result<GardenOwnershipTransfer, Error> = .failure(
        fakeServiceError(code: CollaborationErrorCode.transferNotFound, statusCode: 404)
    )
    var fetchIncomingOwnershipTransfersResult: Result<[IncomingGardenOwnershipTransfer], Error> = .success([])

    private(set) var listMembersCalls: [String] = []
    private(set) var createInvitationCalls: [(gardenId: String, role: CollaboratorRole, email: String?)] = []
    private(set) var revokeInvitationCalls: [(gardenId: String, invitationId: String)] = []
    private(set) var changeMemberRoleCalls: [(gardenId: String, profileId: String, role: CollaboratorRole)] = []
    private(set) var removeMemberCalls: [(gardenId: String, profileId: String)] = []
    private(set) var promoteMemberCalls: [(gardenId: String, profileId: String)] = []
    private(set) var demoteOwnerCalls: [(gardenId: String, profileId: String, role: CollaboratorRole)] = []
    private(set) var transferOwnershipCalls: [(gardenId: String, toProfileId: String, resultingRole: CollaboratorRole)] = []
    private(set) var cancelOwnershipTransferCalls: [String] = []
    private(set) var acceptOwnershipTransferCalls: [String] = []
    private(set) var declineOwnershipTransferCalls: [String] = []
    private(set) var fetchGardenOwnershipTransferCalls: [String] = []
    private(set) var fetchIncomingOwnershipTransfersCallCount = 0

    private struct UnconfiguredError: Error {}
    private static let unconfiguredError: Error = UnconfiguredError()

    func listMembers(gardenId: String) async throws -> [GardenMember] {
        listMembersCalls.append(gardenId)
        return members
    }

    func createInvitation(
        gardenId: String,
        intendedRole: CollaboratorRole,
        intendedEmail: String?,
        idempotencyKey: String
    ) async throws -> CreatedGardenInvitation {
        createInvitationCalls.append((gardenId, intendedRole, intendedEmail))
        return try createInvitationResult.get()
    }

    func listInvitations(gardenId: String) async throws -> [GardenInvitation] {
        invitations
    }

    func revokeInvitation(gardenId: String, invitationId: String, idempotencyKey: String) async throws -> GardenInvitation {
        revokeInvitationCalls.append((gardenId, invitationId))
        return try revokeInvitationResult.get()
    }

    func acceptInvitation(token: String, idempotencyKey: String) async throws -> GardenMember {
        try acceptInvitationResult.get()
    }

    func changeMemberRole(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember {
        changeMemberRoleCalls.append((gardenId, profileId, role))
        return try changeMemberRoleResult.get()
    }

    func removeMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember {
        removeMemberCalls.append((gardenId, profileId))
        return try removeMemberResult.get()
    }

    func promoteMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember {
        promoteMemberCalls.append((gardenId, profileId))
        return try promoteMemberResult.get()
    }

    func demoteOwner(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember {
        demoteOwnerCalls.append((gardenId, profileId, role))
        return try demoteOwnerResult.get()
    }

    func transferOwnership(
        gardenId: String,
        toProfileId: String,
        resultingRole: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenOwnershipTransfer {
        transferOwnershipCalls.append((gardenId, toProfileId, resultingRole))
        return try transferOwnershipResult.get()
    }

    func cancelOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        cancelOwnershipTransferCalls.append(gardenId)
        return try cancelOwnershipTransferResult.get()
    }

    func acceptOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        acceptOwnershipTransferCalls.append(gardenId)
        return try acceptOwnershipTransferResult.get()
    }

    func declineOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        declineOwnershipTransferCalls.append(gardenId)
        return try declineOwnershipTransferResult.get()
    }

    func fetchGardenOwnershipTransfer(gardenId: String) async throws -> GardenOwnershipTransfer {
        fetchGardenOwnershipTransferCalls.append(gardenId)
        return try fetchGardenOwnershipTransferResult.get()
    }

    func fetchIncomingOwnershipTransfers() async throws -> [IncomingGardenOwnershipTransfer] {
        fetchIncomingOwnershipTransfersCallCount += 1
        return try fetchIncomingOwnershipTransfersResult.get()
    }
}

/// Builds the exact `APIGatewayError.service` shape a real collaboration
/// endpoint failure carries, for tests that need to drive a specific
/// `CollaborationErrorMapping`/`AcceptInvitationViewModel` branch.
func fakeServiceError(code: String, statusCode: Int = 422, retryable: Bool = false) -> APIGatewayError {
    .service(
        APIErrorBody(code: code, message: "fake", correlationId: "fake-correlation", retryable: retryable),
        statusCode: statusCode,
        retryAfterSeconds: nil
    )
}

func fakeGardenMember(
    id: String = "member-1",
    gardenId: String = "garden-1",
    profileId: String = "profile-1",
    role: GardenRole = .editor,
    state: GardenMemberState = .active
) -> GardenMember {
    GardenMember(
        id: id, gardenId: gardenId, profileId: profileId, role: role, state: state,
        createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
    )
}

func fakeGardenInvitation(
    id: String = "invitation-1",
    gardenId: String = "garden-1",
    intendedRole: CollaboratorRole = .editor,
    intendedEmail: String? = nil,
    state: GardenInvitationState = .pending
) -> GardenInvitation {
    GardenInvitation(
        id: id, gardenId: gardenId, inviterProfileId: "profile-owner", intendedRole: intendedRole,
        intendedEmail: intendedEmail, state: state, createdAt: Date(timeIntervalSince1970: 0),
        expiresAt: Date(timeIntervalSince1970: 100), acceptedAt: nil, revokedAt: nil, resultingMembershipId: nil
    )
}

func fakeOwnershipTransfer(
    id: String = "transfer-1",
    gardenId: String = "garden-1",
    fromProfileId: String = "profile-owner",
    toProfileId: String = "profile-1",
    fromResultingRole: CollaboratorRole = .editor,
    state: GardenOwnershipTransferState = .pending
) -> GardenOwnershipTransfer {
    GardenOwnershipTransfer(
        id: id, gardenId: gardenId, fromProfileId: fromProfileId, toProfileId: toProfileId,
        fromResultingRole: fromResultingRole, state: state, requestedAt: Date(timeIntervalSince1970: 0),
        completedAt: nil, cancelledAt: nil, cancellationReason: nil
    )
}

func fakeIncomingOwnershipTransfer(
    id: String = "transfer-1",
    gardenId: String = "garden-1",
    gardenName: String = "Backyard",
    fromProfileId: String = "profile-owner",
    toProfileId: String = "profile-1",
    fromResultingRole: CollaboratorRole = .editor
) -> IncomingGardenOwnershipTransfer {
    IncomingGardenOwnershipTransfer(
        transfer: fakeOwnershipTransfer(
            id: id, gardenId: gardenId, fromProfileId: fromProfileId, toProfileId: toProfileId,
            fromResultingRole: fromResultingRole, state: .pending
        ),
        gardenName: gardenName
    )
}
