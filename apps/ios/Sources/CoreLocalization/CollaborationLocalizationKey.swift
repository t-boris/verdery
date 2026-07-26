/// Keys the Collaborators screen, the invite/ownership-transfer flows, and
/// the accept-invitation deep-link screen resolve against the localization
/// catalogue (P9A-IOS-01).
///
/// A second enum rather than more cases in ``LocalizationKey``, for the exact
/// structural reason ``ProfileLocalizationKey`` already gives: an enum's
/// cases cannot be declared in an extension, and `LocalizationKey.swift` is
/// already at this repository's 600-line ceiling. See that type's own doc
/// comment for the full rationale — it applies here unchanged.
public enum CollaborationLocalizationKey: String, Sendable, CaseIterable {
    // MARK: Collaborators screen

    case collaborationTitle = "collaboration.title"
    case collaborationSectionMembers = "collaboration.section.members"
    case collaborationMemberGeneric = "collaboration.member.generic"
    case collaborationSectionPendingInvitations = "collaboration.section.pendingInvitations"
    case collaborationPendingInvitationsEmpty = "collaboration.pendingInvitations.empty"

    // MARK: Invite

    case collaborationInviteButton = "collaboration.invite.button"
    case collaborationInviteTitle = "collaboration.invite.title"
    case collaborationInviteRoleLabel = "collaboration.invite.roleLabel"
    case collaborationInviteEmailLabel = "collaboration.invite.emailLabel"
    case collaborationInviteEmailHint = "collaboration.invite.emailHint"
    case collaborationInviteSubmit = "collaboration.invite.submit"
    case collaborationInviteTokenTitle = "collaboration.invite.tokenTitle"
    case collaborationInviteTokenWarning = "collaboration.invite.tokenWarning"
    case collaborationInviteShare = "collaboration.invite.share"
    case collaborationInviteShareMessage = "collaboration.invite.shareMessage"
    case collaborationInviteDone = "collaboration.invite.done"

    // MARK: Pending invitations

    case collaborationInvitationStatePending = "collaboration.invitation.state.pending"
    case collaborationInvitationStateAccepted = "collaboration.invitation.state.accepted"
    case collaborationInvitationStateRevoked = "collaboration.invitation.state.revoked"
    case collaborationInvitationStateExpired = "collaboration.invitation.state.expired"
    case collaborationInvitationNoEmail = "collaboration.invitation.noEmail"
    case collaborationInvitationRevoke = "collaboration.invitation.revoke"
    case collaborationInvitationRevokeConfirm = "collaboration.invitation.revoke.confirm"

    // MARK: Member role administration

    case collaborationMemberActionChangeRole = "collaboration.member.action.changeRole"
    case collaborationMemberActionPromote = "collaboration.member.action.promote"
    case collaborationMemberActionDemote = "collaboration.member.action.demote"
    case collaborationMemberActionRemove = "collaboration.member.action.remove"
    case collaborationMemberConfirmChangeRole = "collaboration.member.confirm.changeRole"
    case collaborationMemberConfirmPromote = "collaboration.member.confirm.promote"
    case collaborationMemberConfirmDemote = "collaboration.member.confirm.demote"
    case collaborationMemberConfirmRemove = "collaboration.member.confirm.remove"

    // MARK: Ownership transfer — owner side

    case collaborationOwnershipTransferTitle = "collaboration.ownershipTransfer.title"
    case collaborationOwnershipTransferButton = "collaboration.ownershipTransfer.button"
    case collaborationOwnershipTransferTargetLabel = "collaboration.ownershipTransfer.targetLabel"
    case collaborationOwnershipTransferResultingRoleLabel = "collaboration.ownershipTransfer.resultingRoleLabel"
    case collaborationOwnershipTransferSubmit = "collaboration.ownershipTransfer.submit"
    case collaborationOwnershipTransferConfirm = "collaboration.ownershipTransfer.confirm"
    case collaborationOwnershipTransferPending = "collaboration.ownershipTransfer.pending"
    case collaborationOwnershipTransferCancel = "collaboration.ownershipTransfer.cancel"
    case collaborationOwnershipTransferCancelConfirm = "collaboration.ownershipTransfer.cancel.confirm"
    case collaborationOwnershipTransferShare = "collaboration.ownershipTransfer.share"
    case collaborationOwnershipTransferShareMessage = "collaboration.ownershipTransfer.shareMessage"
    case collaborationOwnershipTransferNoEligibleMembers = "collaboration.ownershipTransfer.noEligibleMembers"

    // MARK: Ownership transfer — recipient side (banner + review sheet)

    case collaborationOwnershipTransferRecipientBanner = "collaboration.ownershipTransfer.recipient.banner"
    case collaborationOwnershipTransferRecipientReview = "collaboration.ownershipTransfer.recipient.review"
    case collaborationOwnershipTransferRecipientTitle = "collaboration.ownershipTransfer.recipient.title"
    case collaborationOwnershipTransferRecipientMessage = "collaboration.ownershipTransfer.recipient.message"
    case collaborationOwnershipTransferRecipientAccept = "collaboration.ownershipTransfer.recipient.accept"
    case collaborationOwnershipTransferRecipientDecline = "collaboration.ownershipTransfer.recipient.decline"
    case collaborationOwnershipTransferRecipientNotNow = "collaboration.ownershipTransfer.recipient.notNow"
    case collaborationOwnershipTransferRecipientAcceptedMessage = "collaboration.ownershipTransfer.recipient.acceptedMessage"
    case collaborationOwnershipTransferRecipientDeclinedMessage = "collaboration.ownershipTransfer.recipient.declinedMessage"
    case collaborationOwnershipTransferRecipientStaleMessage = "collaboration.ownershipTransfer.recipient.staleMessage"

    // MARK: Accept-invitation deep-link screen

    case collaborationAcceptInvitationTitle = "collaboration.acceptInvitation.title"
    case collaborationAcceptInvitationLoading = "collaboration.acceptInvitation.loading"
    case collaborationAcceptInvitationSuccess = "collaboration.acceptInvitation.success"
    case collaborationAcceptInvitationOpenGarden = "collaboration.acceptInvitation.openGarden"
    case collaborationAcceptInvitationExpiredOrRevoked = "collaboration.acceptInvitation.expiredOrRevoked"
    case collaborationAcceptInvitationAlreadyAccepted = "collaboration.acceptInvitation.alreadyAccepted"
    case collaborationAcceptInvitationEmailMismatch = "collaboration.acceptInvitation.emailMismatch"
    case collaborationAcceptInvitationGenericFailure = "collaboration.acceptInvitation.genericFailure"
    case collaborationAcceptInvitationClose = "collaboration.acceptInvitation.close"

    // MARK: Shared error mapping

    case collaborationErrorRecentAuthRequired = "collaboration.error.recentAuthRequired"
    case collaborationErrorLastOwnerRequired = "collaboration.error.lastOwnerRequired"
    case collaborationErrorTargetNotOwner = "collaboration.error.targetNotOwner"
    case collaborationErrorTargetAlreadyOwner = "collaboration.error.targetAlreadyOwner"
    case collaborationErrorOwnerRoleNotAllowed = "collaboration.error.ownerRoleNotAllowed"
    case collaborationErrorInvitationAlreadyPending = "collaboration.error.invitationAlreadyPending"
    case collaborationErrorTransferAlreadyPending = "collaboration.error.transferAlreadyPending"
    case collaborationErrorNotFound = "collaboration.error.notFound"

    // MARK: Revoked-access recovery

    case collaborationRevokedAccessMessage = "collaboration.revokedAccess.message"
    case collaborationRevokedAccessBackToGardens = "collaboration.revokedAccess.backToGardens"
}
