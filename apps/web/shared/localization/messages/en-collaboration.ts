/**
 * English messages for garden collaboration administration (P9A-WEB-01):
 * the member roster, invitations, role administration, and ownership
 * transfer.
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-today.ts` and `en-accessibility.ts` already document.
 * Also carries the `CollaborationErrorCode` message keys `error-message.ts`
 * maps to, for the same reason `tasks.fromRecommendation` lives in
 * `en-today.ts` despite its own prefix: message keys are one flat namespace
 * regardless of which module file declares them.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * implementation-plan.md work package P9A-WEB-01.
 */
export const englishCollaborationMessages = {
  'error.membershipNotFound': 'This member could not be found.',
  'error.lastOwnerRequired': 'This action would leave the garden with no owner.',
  'error.ownerRoleNotAllowed': 'Use promote or demote to change ownership, not this action.',
  'error.invitationNotFound': 'This invitation link is not valid.',
  'error.invitationAlreadyPending':
    'An invitation is already pending for that email. Revoke it before sending another.',
  'error.invitationExpired': 'This invitation has expired.',
  'error.invitationRevoked': 'This invitation was revoked.',
  'error.invitationAlreadyAccepted': 'This invitation was already used.',
  'error.invitationEmailMismatch':
    'This invitation is addressed to a different email address than the one on this account.',
  'error.collaborationRecentAuthenticationRequired':
    'Sign in again to confirm this action, then retry.',
  'error.targetNotOwner': 'This member does not currently hold ownership.',
  'error.targetAlreadyOwner': 'This member is already an owner.',
  'error.ownershipTransferAlreadyPending':
    'A transfer is already pending for this garden. Cancel it before requesting another.',
  'error.ownershipTransferNotFound': 'No pending ownership transfer was found.',

  'collaborators.title': 'Collaborators',
  'collaborators.membersTitle': 'Members',
  'collaborators.loading': 'Loading members.',
  'collaborators.retry': 'Try again',
  'collaborators.noDisplayName':
    'Members are shown by account ID — this app has no display name for them yet.',
  'collaborators.changeRoleLabel': 'Role',
  'collaborators.changeRoleSave': 'Save role',
  'collaborators.changeRoleConfirm': "Change this member's role to {role}?",
  'collaborators.promote': 'Promote to co-owner',
  'collaborators.promoteConfirm': 'Make this member a co-owner of this garden?',
  'collaborators.demote': 'Demote from owner',
  'collaborators.demoteConfirm': 'Remove this member as an owner? They will become {role}.',
  'collaborators.demoteRoleLabel': 'New role',
  'collaborators.remove': 'Remove',
  'collaborators.removeConfirm': 'Remove this member from the garden?',

  'invitations.inviteTitle': 'Invite someone',
  'invitations.roleLabel': 'Role',
  'invitations.emailLabel': 'Email (optional)',
  'invitations.emailHint':
    'Leave blank to create a link anyone can use. Add an email to require that exact, verified address to accept.',
  'invitations.submit': 'Create invitation',
  'invitations.createdTitle': 'Invitation created',
  'invitations.createdDescription':
    'Copy this link now and share it out of band — it will never be shown again.',
  'invitations.linkLabel': 'Invitation link',
  'invitations.copy': 'Copy link',
  'invitations.copied': 'Copied.',
  'invitations.copyFailed':
    'Could not copy automatically — select the link above and copy it manually.',
  'invitations.done': 'Done',
  'invitations.pendingTitle': 'Pending invitations',
  'invitations.loading': 'Loading invitations.',
  'invitations.retry': 'Try again',
  'invitations.empty': 'No invitations yet.',
  'invitations.noEmail': 'Anyone with the link',
  'invitations.revoke': 'Revoke',
  'invitations.revokeConfirm': 'Revoke this invitation? Its link will stop working.',
  'invitations.state.pending': 'Pending',
  'invitations.state.accepted': 'Accepted',
  'invitations.state.revoked': 'Revoked',
  'invitations.state.expired': 'Expired',

  'invite.title': 'Joining a garden',
  'invite.working': 'Accepting your invitation.',
  'invite.missingToken': 'This link is missing its invitation token.',
  'invite.successTitle': "You're in",
  'invite.successDescription': 'You now have {role} access to this garden.',
  'invite.goToGarden': 'Open the garden',
  'invite.signInFirst': 'Sign in, then this invitation will finish automatically.',

  'ownership.requestTitle': 'Transfer ownership',
  'ownership.requestDescription':
    'Ownership moves only once the recipient accepts. You remain the owner, with full rights, until then.',
  'ownership.targetLabel': 'New owner',
  'ownership.targetPlaceholder': 'Choose a member',
  'ownership.noEligibleMembers':
    'Invite another member before transferring ownership — a transfer can only go to an existing editor or viewer.',
  'ownership.resultingRoleLabel': 'Your role afterward',
  'ownership.submit': 'Request transfer',
  'ownership.loading': 'Loading the ownership transfer.',
  'ownership.retry': 'Try again',
  'ownership.pendingTitle': 'Pending transfer',
  'ownership.pendingDescription':
    'You offered ownership of this garden. You will become {role} once it is accepted. Nothing changes until then.',
  'ownership.cancel': 'Cancel this transfer',
  'ownership.cancelConfirm': 'Cancel this pending ownership transfer?',
  'ownership.respondTitle': 'Respond to an ownership transfer',
  'ownership.respondDescription': '{fromProfileId} wants to make you the owner of this garden.',
  'ownership.accept': 'Accept ownership',
  'ownership.acceptConfirm': 'Accept ownership of this garden? You will become its owner.',
  'ownership.acceptedNotice': 'You are now the owner of this garden.',
  'ownership.decline': 'Decline',
  'ownership.declinedNotice': 'You declined the ownership transfer.',
  'ownership.noneForYou': 'This ownership offer is no longer available.',
  'ownership.incomingListTitle': 'Incoming ownership offers',
};
