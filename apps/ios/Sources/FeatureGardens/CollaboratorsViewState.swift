import CoreDomain

/// Immutable display state for the Collaborators screen.
public enum CollaboratorsViewState: Equatable, Sendable {
    case loading
    case loaded(CollaboratorsSummary)
    case failed(message: String)
}

/// One roster entry, already localized.
///
/// `nameLabel` is always the same generic placeholder — see
/// ``GardenMember``'s own doc comment for why: the roster genuinely carries
/// no display name, so nothing here fabricates one.
public struct CollaboratorRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let role: GardenRole
    public let roleLabel: String
    public let nameLabel: String
}

/// One pending-invitation entry, already localized. Owner-only data — see
/// ``ListGardenInvitations``'s own doc comment for why an invitation's
/// intended email is shown here but never on ``CollaboratorRow``.
public struct PendingInvitationRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let role: CollaboratorRole
    public let roleLabel: String
    public let state: GardenInvitationState
    public let stateLabel: String
    public let emailLabel: String
}

public struct CollaboratorsSummary: Equatable, Sendable {
    public let members: [CollaboratorRow]
    /// Empty for a non-owner — `listGardenInvitations` is owner-only, and
    /// this screen does not call it at all when ``isOwner`` is `false`.
    public let invitations: [PendingInvitationRow]
    /// The garden's currently pending ownership transfer, if any — read
    /// fresh from `getGardenOwnershipTransfer` (P9A-OWNER-02) whenever
    /// ``isOwner``, so this state survives an app relaunch rather than only
    /// lasting as long as the session that requested it. Always `nil` for a
    /// non-owner, the same "owner-only data this screen simply does not
    /// fetch otherwise" reasoning as ``invitations``.
    public let outgoingTransfer: GardenOwnershipTransfer?
    public let isOwner: Bool
}

/// One confirmable owner-administration action, and which roster row it
/// targets.
///
/// `demote`/`transferOwnership` do not carry a resulting role: the
/// confirmation dialog itself offers one button per role
/// (`demoteOwner`/`transferOwnership` both need the owner to choose editor
/// or viewer at the moment of confirming, not before), so the view calls
/// the corresponding `confirm*(role:)` method directly rather than this
/// case needing to remember a choice made earlier.
public enum ConfirmableCollaborationAction: Equatable, Sendable, Identifiable {
    case revokeInvitation(invitationId: String)
    case changeRole(profileId: String, newRole: CollaboratorRole)
    case promote(profileId: String)
    case demote(profileId: String)
    case remove(profileId: String)
    case transferOwnership(profileId: String)
    case cancelTransfer

    public var id: String {
        switch self {
        case let .revokeInvitation(invitationId): "revoke-\(invitationId)"
        case let .changeRole(profileId, newRole): "changeRole-\(profileId)-\(newRole.rawValue)"
        case let .promote(profileId): "promote-\(profileId)"
        case let .demote(profileId): "demote-\(profileId)"
        case let .remove(profileId): "remove-\(profileId)"
        case let .transferOwnership(profileId): "transfer-\(profileId)"
        case .cancelTransfer: "cancelTransfer"
        }
    }
}
