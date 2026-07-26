import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for one garden's Collaborators screen: member roster (every
/// role), invitations and role administration (owner-only), and ownership
/// transfer (owner-only, request/cancel side — see
/// `IncomingOwnershipTransferReviewViewModel` for the recipient side).
///
/// `isOwner` is passed in already known, the same usability-not-security
/// choice `GardenSettingsViewModel`'s own doc comment already states: the
/// server enforces every owner-only capability independently, so hiding a
/// control here only avoids showing an action that would just fail.
///
/// Source: implementation-plan.md work package P9A-IOS-01;
/// docs/development/garden-capability-matrix.md, section "4.8 Membership".
@MainActor
@Observable
public final class CollaboratorsViewModel {
    public private(set) var state: CollaboratorsViewState = .loading
    // `internal(set)`, not `private(set)`: `CollaboratorsViewModel+Actions.swift`
    // (a same-type extension in another file, split out purely to keep this
    // file under this repository's 600-line rule) mutates all three — see
    // `FeatureTasks.TasksListViewModel`'s identical `state` comment for why
    // `private(set)` (file-scoped, not type-scoped) would not compile there.
    public internal(set) var actionErrorMessage: String?
    public internal(set) var isSubmittingAction = false
    public internal(set) var pendingAction: ConfirmableCollaborationAction?

    public var inviteRole: CollaboratorRole = .editor
    public var inviteEmail: String = ""
    public private(set) var isSubmittingInvite = false
    public private(set) var inviteErrorMessage: String?
    /// Set once `createInvitation` succeeds — the ONLY moment this screen
    /// ever holds the raw token. Cleared by ``dismissCreatedInvitation()``.
    public private(set) var createdInvitation: CreatedGardenInvitation?

    public let gardenId: String
    public let isOwner: Bool

    let listMembers: ListGardenMembers
    let createInvitation: CreateGardenInvitation
    let listInvitations: ListGardenInvitations
    let revokeInvitation: RevokeGardenInvitation
    let changeMemberRole: ChangeGardenMemberRole
    let removeMember: RemoveGardenMember
    let promoteMember: PromoteGardenMember
    let demoteOwner: DemoteGardenOwner
    let requestTransfer: RequestGardenOwnershipTransfer
    let cancelOwnershipTransfer: CancelGardenOwnershipTransfer
    let fetchOwnershipTransfer: FetchGardenOwnershipTransfer
    let strings: LocalizedStrings

    public init(
        gardenId: String,
        isOwner: Bool,
        listMembers: ListGardenMembers,
        createInvitation: CreateGardenInvitation,
        listInvitations: ListGardenInvitations,
        revokeInvitation: RevokeGardenInvitation,
        changeMemberRole: ChangeGardenMemberRole,
        removeMember: RemoveGardenMember,
        promoteMember: PromoteGardenMember,
        demoteOwner: DemoteGardenOwner,
        requestTransfer: RequestGardenOwnershipTransfer,
        cancelOwnershipTransfer: CancelGardenOwnershipTransfer,
        fetchOwnershipTransfer: FetchGardenOwnershipTransfer,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.isOwner = isOwner
        self.listMembers = listMembers
        self.createInvitation = createInvitation
        self.listInvitations = listInvitations
        self.revokeInvitation = revokeInvitation
        self.changeMemberRole = changeMemberRole
        self.removeMember = removeMember
        self.promoteMember = promoteMember
        self.demoteOwner = demoteOwner
        self.requestTransfer = requestTransfer
        self.cancelOwnershipTransfer = cancelOwnershipTransfer
        self.fetchOwnershipTransfer = fetchOwnershipTransfer
        self.strings = strings
    }

    // MARK: Labels

    public var title: String { strings(.collaborationTitle) }
    public var membersSectionTitle: String { strings(.collaborationSectionMembers) }
    public var pendingInvitationsSectionTitle: String { strings(.collaborationSectionPendingInvitations) }
    public var pendingInvitationsEmptyMessage: String { strings(.collaborationPendingInvitationsEmpty) }
    public var inviteButtonTitle: String { strings(.collaborationInviteButton) }
    public var inviteTitle: String { strings(.collaborationInviteTitle) }
    public var inviteRoleLabel: String { strings(.collaborationInviteRoleLabel) }
    public var inviteEmailLabel: String { strings(.collaborationInviteEmailLabel) }
    public var inviteEmailHint: String { strings(.collaborationInviteEmailHint) }
    public var inviteSubmitTitle: String { strings(.collaborationInviteSubmit) }
    public var inviteTokenTitle: String { strings(.collaborationInviteTokenTitle) }
    public var inviteTokenWarning: String { strings(.collaborationInviteTokenWarning) }
    public var inviteShareTitle: String { strings(.collaborationInviteShare) }
    public var inviteDoneTitle: String { strings(.collaborationInviteDone) }
    public var revokeInvitationTitle: String { strings(.collaborationInvitationRevoke) }
    public var revokeInvitationConfirmMessage: String { strings(.collaborationInvitationRevokeConfirm) }
    public var changeRoleActionTitle: String { strings(.collaborationMemberActionChangeRole) }
    public var promoteActionTitle: String { strings(.collaborationMemberActionPromote) }
    public var demoteActionTitle: String { strings(.collaborationMemberActionDemote) }
    public var removeActionTitle: String { strings(.collaborationMemberActionRemove) }
    public var promoteConfirmMessage: String { strings(.collaborationMemberConfirmPromote) }
    public var demoteConfirmMessage: String { strings(.collaborationMemberConfirmDemote) }
    public var removeConfirmMessage: String { strings(.collaborationMemberConfirmRemove) }
    public var transferConfirmMessage: String { strings(.collaborationOwnershipTransferConfirm) }
    public var ownershipTransferTitle: String { strings(.collaborationOwnershipTransferTitle) }
    public var ownershipTransferButtonTitle: String { strings(.collaborationOwnershipTransferButton) }
    public var ownershipTransferPendingLabel: String { strings(.collaborationOwnershipTransferPending) }
    public var ownershipTransferCancelTitle: String { strings(.collaborationOwnershipTransferCancel) }
    public var ownershipTransferCancelConfirmMessage: String { strings(.collaborationOwnershipTransferCancelConfirm) }
    public var ownershipTransferShareTitle: String { strings(.collaborationOwnershipTransferShare) }
    public var ownershipTransferNoEligibleMembersMessage: String { strings(.collaborationOwnershipTransferNoEligibleMembers) }
    public var cancelTitle: String { strings(.gardensCreateCancel) }
    public var retryTitle: String { strings(.gardensRetry) }

    public func changeRoleConfirmMessage(newRole: CollaboratorRole) -> String {
        strings.string(.collaborationMemberConfirmChangeRole, parameters: ["role": roleLabel(for: newRole.gardenRole)])
    }

    /// Every member currently eligible to receive ownership — active,
    /// non-owner — so the ownership-transfer row action can be offered only
    /// where the server would not immediately refuse it with `404`.
    public var eligibleTransferTargets: [CollaboratorRow] {
        guard case let .loaded(summary) = state else { return [] }
        return summary.members.filter { $0.role != .owner }
    }

    /// The garden's currently pending ownership transfer, if any — read
    /// fresh from the server by `load()`/`reload()` (P9A-OWNER-02), so this
    /// survives an app relaunch rather than lasting only as long as the
    /// session that requested it.
    public var outgoingTransfer: GardenOwnershipTransfer? {
        guard case let .loaded(summary) = state else { return nil }
        return summary.outgoingTransfer
    }

    /// A `verdery://ownership-transfer` deep link for the outgoing transfer's
    /// recipient to share back to — constructed client-side, the same way
    /// ``createdInvitationShareURL`` is: there is no server-issued link for
    /// either flow.
    public var outgoingTransferShareURL: URL? {
        var components = URLComponents()
        components.scheme = CollaborationSessionState.scheme
        components.host = "ownership-transfer"
        components.queryItems = [URLQueryItem(name: "gardenId", value: gardenId)]
        return components.url
    }

    public func outgoingTransferShareMessage(link: URL) -> String {
        strings.string(.collaborationOwnershipTransferShareMessage, parameters: ["link": link.absoluteString])
    }

    // MARK: Loading

    public func load() async {
        state = .loading
        actionErrorMessage = nil

        do {
            let members = try await listMembers(gardenId: gardenId)
            let invitations = isOwner ? try await listInvitations(gardenId: gardenId) : []
            let outgoingTransfer = isOwner ? try await fetchOwnershipTransfer(gardenId: gardenId) : nil

            state = .loaded(
                CollaboratorsSummary(
                    members: members.map(row),
                    invitations: invitations.map(row),
                    outgoingTransfer: outgoingTransfer,
                    isOwner: isOwner
                )
            )
        } catch let error as APIGatewayError {
            state = .failed(message: CollaborationErrorMessage.generic(for: error, strings: strings))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    /// Refreshes the roster/invitations/outgoing transfer in place without
    /// dropping back to `.loading` — used after an action succeeds, so the
    /// screen does not flash empty between an admin action and its own
    /// confirmation.
    func reload() async {
        do {
            let members = try await listMembers(gardenId: gardenId)
            let invitations = isOwner ? try await listInvitations(gardenId: gardenId) : []
            let outgoingTransfer = isOwner ? try await fetchOwnershipTransfer(gardenId: gardenId) : nil

            state = .loaded(
                CollaboratorsSummary(
                    members: members.map(row),
                    invitations: invitations.map(row),
                    outgoingTransfer: outgoingTransfer,
                    isOwner: isOwner
                )
            )
        } catch let error as APIGatewayError {
            actionErrorMessage = CollaborationErrorMessage.generic(for: error, strings: strings)
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }

    // MARK: Invite

    public func submitInvite() async {
        isSubmittingInvite = true
        inviteErrorMessage = nil
        defer { isSubmittingInvite = false }

        do {
            createdInvitation = try await createInvitation(
                gardenId: gardenId,
                intendedRole: inviteRole,
                intendedEmail: inviteEmail
            )
            inviteEmail = ""
        } catch let error as APIGatewayError {
            inviteErrorMessage = CollaborationErrorMessage.generic(for: error, strings: strings)
        } catch {
            inviteErrorMessage = strings(.serverUnexpected)
        }
    }

    /// A `verdery://invite` deep link wrapping the one-time raw token — this
    /// app's own share format, mirrored by ``AppCompositionRoot
    /// .handleIncomingURL``/``CollaborationSessionState.handleDeepLink(_:)``
    /// on the receiving end.
    public var createdInvitationShareURL: URL? {
        guard let createdInvitation else { return nil }

        var components = URLComponents()
        components.scheme = CollaborationSessionState.scheme
        components.host = "invite"
        components.queryItems = [URLQueryItem(name: "token", value: createdInvitation.token)]
        return components.url
    }

    public func createdInvitationShareMessage(link: URL) -> String {
        strings.string(.collaborationInviteShareMessage, parameters: ["link": link.absoluteString])
    }

    public func dismissCreatedInvitation() async {
        createdInvitation = nil
        await reload()
    }

    // MARK: Confirmation flow

    public func requestConfirmation(_ action: ConfirmableCollaborationAction) {
        pendingAction = action
    }

    public func cancelPendingAction() {
        pendingAction = nil
    }

    // MARK: Row projections

    func row(_ member: GardenMember) -> CollaboratorRow {
        CollaboratorRow(
            id: member.profileId,
            role: member.role,
            roleLabel: roleLabel(for: member.role),
            nameLabel: strings(.collaborationMemberGeneric)
        )
    }

    func row(_ invitation: GardenInvitation) -> PendingInvitationRow {
        PendingInvitationRow(
            id: invitation.id,
            role: invitation.intendedRole,
            roleLabel: roleLabel(for: invitation.intendedRole.gardenRole),
            state: invitation.state,
            stateLabel: stateLabel(for: invitation.state),
            emailLabel: invitation.intendedEmail ?? strings(.collaborationInvitationNoEmail)
        )
    }

    func roleLabel(for role: GardenRole) -> String {
        switch role {
        case .owner: strings(.gardensRoleOwner)
        case .editor: strings(.gardensRoleEditor)
        case .viewer: strings(.gardensRoleViewer)
        }
    }

    private func stateLabel(for state: GardenInvitationState) -> String {
        switch state {
        case .pending: strings(.collaborationInvitationStatePending)
        case .accepted: strings(.collaborationInvitationStateAccepted)
        case .revoked: strings(.collaborationInvitationStateRevoked)
        case .expired: strings(.collaborationInvitationStateExpired)
        }
    }
}
