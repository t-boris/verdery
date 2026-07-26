import Foundation

/// The role vocabulary an invitation, a member-role change, or an ownership
/// transfer's own resulting role may name — never `owner`: ownership moves
/// only through the dedicated promote/demote/transfer flow.
///
/// A distinct type from ``GardenRole`` rather than a reuse of it, so the type
/// system itself keeps "owner" out of every picker and request this type
/// backs — the same guarantee `packages/api-contracts/openapi.yaml`'s
/// `InvitationIntendedRole` schema gives the wire contract
/// (`GardenRole`/`InvitationIntendedRole` are deliberately separate schemas
/// there too).
///
/// Source: architecture/identity-and-authorization.md, section "10. Invitations"
/// ("The initial ordinary invitation flow grants only editor or viewer").
public enum CollaboratorRole: String, Equatable, Sendable, CaseIterable {
    case editor
    case viewer

    /// The full role this assignable role corresponds to, for display
    /// alongside a ``GardenMember``'s own ``GardenRole``.
    public var gardenRole: GardenRole {
        switch self {
        case .editor: .editor
        case .viewer: .viewer
        }
    }
}

/// Mirrors `collaboration.membership.state`. `listGardenMembers` only ever
/// returns `active` entries; this value travels on every ``GardenMember``
/// regardless, so the shape stays stable if a later screen ever surfaces
/// non-active history.
public enum GardenMemberState: String, Equatable, Sendable, CaseIterable {
    case active
    case removed
}

/// One entry of a garden's member roster.
///
/// Carries `profileId` and `role` only — never a display name or an email
/// address. `packages/api-contracts/openapi.yaml`'s `GardenMember` schema
/// genuinely has no name field: email is the invitation-binding and
/// enumeration surface reserved to the owner alone
/// (`docs/development/garden-capability-matrix.md`, row H2), and this app has
/// no other endpoint that resolves a profile id to a display name. A screen
/// rendering this type therefore shows a generic placeholder for "who," never
/// a fabricated one.
///
/// Source: packages/api-contracts/openapi.yaml, `GardenMember`.
public struct GardenMember: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let profileId: String
    public let role: GardenRole
    public let state: GardenMemberState
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        profileId: String,
        role: GardenRole,
        state: GardenMemberState,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.profileId = profileId
        self.role = role
        self.state = state
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors `collaboration.invitation.state`.
public enum GardenInvitationState: String, Equatable, Sendable, CaseIterable {
    case pending
    case accepted
    case revoked
    case expired
}

/// A garden invitation as the owner who created it sees it: intended role,
/// intended email (present only when the invitation is email-bound), and
/// current state.
///
/// Source: packages/api-contracts/openapi.yaml, `Invitation`.
public struct GardenInvitation: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let inviterProfileId: String
    public let intendedRole: CollaboratorRole
    public let intendedEmail: String?
    public let state: GardenInvitationState
    public let createdAt: Date
    public let expiresAt: Date
    public let acceptedAt: Date?
    public let revokedAt: Date?
    public let resultingMembershipId: String?

    public init(
        id: String,
        gardenId: String,
        inviterProfileId: String,
        intendedRole: CollaboratorRole,
        intendedEmail: String?,
        state: GardenInvitationState,
        createdAt: Date,
        expiresAt: Date,
        acceptedAt: Date?,
        revokedAt: Date?,
        resultingMembershipId: String?
    ) {
        self.id = id
        self.gardenId = gardenId
        self.inviterProfileId = inviterProfileId
        self.intendedRole = intendedRole
        self.intendedEmail = intendedEmail
        self.state = state
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.acceptedAt = acceptedAt
        self.revokedAt = revokedAt
        self.resultingMembershipId = resultingMembershipId
    }
}

/// A freshly created invitation plus its one-time raw token.
///
/// The server stores only the token's hash — no endpoint can ever return it
/// again, which is why this is a distinct type from ``GardenInvitation``
/// rather than an optional field on it: nothing after the moment of creation
/// can ever construct one.
///
/// Source: packages/api-contracts/openapi.yaml, `CreateInvitationResult`.
public struct CreatedGardenInvitation: Equatable, Sendable {
    public let invitation: GardenInvitation
    public let token: String

    public init(invitation: GardenInvitation, token: String) {
        self.invitation = invitation
        self.token = token
    }
}

/// Mirrors `collaboration.ownership_transfer.state`. `pending` is the
/// ordinary, externally observable in-between state until the named
/// recipient accepts or declines it, or the initiator cancels it.
public enum GardenOwnershipTransferState: String, Equatable, Sendable, CaseIterable {
    case pending
    case completed
    case cancelled
}

/// A requested, in-flight, or resolved transfer of garden ownership.
///
/// `fromResultingRole` is the role the OUTGOING owner (`fromProfileId`) holds
/// once this transfer completes — never `owner` itself, since transferring
/// away ownership is the entire point of the command.
///
/// Source: packages/api-contracts/openapi.yaml, `OwnershipTransfer`;
/// architecture/identity-and-authorization.md, section "11. Ownership Transfer".
public struct GardenOwnershipTransfer: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let fromProfileId: String
    public let toProfileId: String
    public let fromResultingRole: CollaboratorRole
    public let state: GardenOwnershipTransferState
    public let requestedAt: Date
    public let completedAt: Date?
    public let cancelledAt: Date?
    public let cancellationReason: String?

    public init(
        id: String,
        gardenId: String,
        fromProfileId: String,
        toProfileId: String,
        fromResultingRole: CollaboratorRole,
        state: GardenOwnershipTransferState,
        requestedAt: Date,
        completedAt: Date?,
        cancelledAt: Date?,
        cancellationReason: String?
    ) {
        self.id = id
        self.gardenId = gardenId
        self.fromProfileId = fromProfileId
        self.toProfileId = toProfileId
        self.fromResultingRole = fromResultingRole
        self.state = state
        self.requestedAt = requestedAt
        self.completedAt = completedAt
        self.cancelledAt = cancelledAt
        self.cancellationReason = cancellationReason
    }
}

/// One entry of `listIncomingOwnershipTransfers` (P9A-OWNER-02): a pending
/// transfer addressed to the signed-in profile, plus the destination
/// garden's own current name.
///
/// A distinct type from ``GardenOwnershipTransfer`` rather than an optional
/// field on it, the same reasoning ``CreatedGardenInvitation`` already
/// applies to `token`: `gardenName` only ever accompanies this ONE read
/// (`GET /ownership-transfers/incoming`'s own `IncomingOwnershipTransfer`
/// schema), never `getGardenOwnershipTransfer`'s plain `OwnershipTransfer`,
/// so it does not belong on the shared type at all.
///
/// Source: packages/api-contracts/openapi.yaml, `IncomingOwnershipTransfer`.
public struct IncomingGardenOwnershipTransfer: Equatable, Sendable, Identifiable {
    public let transfer: GardenOwnershipTransfer
    /// The destination garden's current name, as of when this list was read.
    public let gardenName: String

    public var id: String { transfer.id }

    public init(transfer: GardenOwnershipTransfer, gardenName: String) {
        self.transfer = transfer
        self.gardenName = gardenName
    }
}
