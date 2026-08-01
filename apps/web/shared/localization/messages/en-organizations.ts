/**
 * English messages for the professional-service domain (P9B-WEB-01):
 * service organizations, organization membership, garden assignment, and
 * client engagement — plus the two garden-scoped read sections composed
 * onto the garden settings page.
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-collaboration.ts` already documents. Also carries
 * the `OrganizationErrorCode`/`ClientEngagementErrorCode` message keys
 * `error-message.ts` maps to, for the identical reason.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * implementation-plan.md work package P9B-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Organizations`.
 */
export const englishOrganizationsMessages = {
  'error.organizationNotFound': 'This organization could not be found.',
  'error.organizationProfileNotFound': 'No account exists at that profile ID.',
  'error.organizationMembershipNotFound': 'This organization member could not be found.',
  'error.organizationMembershipAlreadyExists':
    'This profile already has a membership record on this organization.',
  'error.organizationLastAdminRequired':
    'This action would leave the organization with no administrator.',
  'error.gardenAssignmentNotFound': 'This garden assignment could not be found.',
  'error.gardenAssignmentAlreadyActive':
    'This member already holds an active assignment on that garden.',
  'error.gardenAssignmentAssigneeNotMember':
    'Only an active member of this organization can be assigned to a garden.',
  'error.gardenAssignmentInvalidTransition':
    'This assignment already reached a different final state.',
  'error.clientEngagementNotFound': 'This client engagement could not be found.',
  'error.clientEngagementInvalidTransition':
    'This engagement does not allow that change from its current state.',

  'organizations.title': 'Organizations',
  'organizations.description': 'Every service organization you administer or work for.',
  'organizations.loading': 'Loading organizations.',
  'organizations.retry': 'Try again',
  'organizations.empty': 'You are not part of any organization yet. Create one below.',
  'organizations.createTitle': 'Create an organization',
  'organizations.createNameLabel': 'Organization name',
  'organizations.createSubmit': 'Create organization',
  'organizations.nameRequired': 'Enter a name up to 120 characters.',
  'organizations.detailTitle': 'Organization',
  'organizations.backToList': 'Back to organizations',
  'organizations.roleAdmin': 'Administrator',
  'organizations.roleProfessional': 'Professional',

  'organizations.membersTitle': 'Members',
  'organizations.membersLoading': 'Loading members.',
  'organizations.membersRetry': 'Try again',
  'organizations.noDisplayName':
    'Members are shown by account ID — this app has no display name for them yet.',
  'organizations.addMemberTitle': 'Add a member',
  'organizations.addMemberProfileIdLabel': 'Profile ID',
  'organizations.addMemberProfileIdHint':
    'There is no invitation flow for organization membership — enter the professional’s own account ID, shared with you directly.',
  'organizations.addMemberProfileIdRequired': 'Enter a profile ID.',
  'organizations.addMemberRoleLabel': 'Role',
  'organizations.addMemberSubmit': 'Add member',
  'organizations.changeRoleLabel': 'Role',
  'organizations.changeRoleSave': 'Save role',
  'organizations.changeRoleConfirm': 'Change this member’s role to {role}?',
  'organizations.remove': 'Remove',
  'organizations.removeConfirm': 'Remove this member from the organization?',

  'assignments.orgSectionTitle': 'Garden assignments',
  'assignments.loading': 'Loading garden assignments.',
  'assignments.retry': 'Try again',
  'assignments.empty': 'No active garden assignments right now.',
  'assignments.createTitle': 'Assign a member to a garden',
  'assignments.memberLabel': 'Member',
  'assignments.memberPlaceholder': 'Choose a member',
  'assignments.noEligibleMembers': 'Add a member before creating a garden assignment.',
  'assignments.gardenIdLabel': 'Garden ID',
  'assignments.gardenIdHint':
    'Paste the identifier of the garden this member will work on — visible in that garden’s own settings page address. There is no directory to browse gardens by name here; the ID must come from the garden’s owner.',
  'assignments.roleLabel': 'Role',
  'assignments.submit': 'Create assignment',
  'assignments.end': 'End',
  'assignments.endConfirm': 'End this garden assignment?',
  'assignments.revoke': 'Revoke',
  'assignments.revokeConfirm': 'Revoke this garden assignment immediately?',
  'assignments.state.active': 'Active',
  'assignments.state.ended': 'Ended',
  'assignments.state.revoked': 'Revoked',

  'assignments.gardenSectionTitle': 'Professional assignments',
  'assignments.gardenSectionDescription':
    'Professionals from a service organization who currently have access to this garden. Once an assignment ends or is revoked, it no longer appears here.',
  'assignments.gardenEmpty':
    'No organization currently has a professional assigned to this garden.',
  'assignments.organizationIdLabel': 'Organization',
  'assignments.profileIdLabel': 'Professional',

  'engagements.orgSectionTitle': 'Client engagements',
  'engagements.loading': 'Loading client engagements.',
  'engagements.retry': 'Try again',
  'engagements.empty': 'No client engagements yet.',
  'engagements.createTitle': 'Create a client engagement',
  'engagements.gardenIdLabel': 'Garden ID',
  'engagements.gardenIdHint': 'Paste the identifier of the garden this engagement covers.',
  'engagements.submit': 'Create engagement',
  'engagements.activate': 'Activate',
  'engagements.activateConfirm':
    'Activate this engagement? It becomes the live service relationship for this garden.',
  'engagements.end': 'End',
  'engagements.endConfirm': 'End this active engagement?',
  'engagements.revoke': 'Revoke',
  'engagements.revokeConfirm': 'Revoke this engagement?',
  'engagements.revokeReasonLabel': 'Reason (optional)',
  'engagements.state.draft': 'Draft',
  'engagements.state.active': 'Active',
  'engagements.state.ended': 'Ended',
  'engagements.state.revoked': 'Revoked',
  'engagements.stewardshipResidential': 'Residential stewardship',
  'engagements.notificationsEnabled': 'Client notifications on',
  'engagements.notificationsDisabled': 'Client notifications off',
  'engagements.openUpdates': 'Client updates',

  'engagements.gardenSectionTitle': 'Client engagements',
  'engagements.gardenSectionDescription':
    'Every service relationship this garden has had, in any state — visible to its owner only.',
  'engagements.gardenEmpty': 'No client engagement has been created for this garden yet.',
} as const;
