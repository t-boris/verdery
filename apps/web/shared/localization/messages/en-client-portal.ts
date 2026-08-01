/**
 * English messages for the client-portal domain (P9C-WEB-01): the `/client`
 * route group's own shell, garden switcher, overview, publications,
 * factual timeline, and client-invitation acceptance.
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-organizations.ts` already documents. Also carries the
 * `ClientAccessGrantErrorCode`/`ClientPortalErrorCode` message keys
 * `error-message.ts` maps to, for the identical reason.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, tags `ClientPortal`, `ClientAccess`.
 */
export const englishClientPortalMessages = {
  'error.clientAccessGrantNotFound': 'This invitation could not be found.',
  'error.clientAccessGrantAlreadyOutstanding':
    'An invitation for this email is already outstanding on this engagement.',
  'error.clientAccessGrantExpired': 'This invitation has expired.',
  'error.clientAccessGrantRevoked': 'This invitation was revoked.',
  'error.clientAccessGrantAlreadyAccepted': 'This invitation was already accepted.',
  'error.clientAccessGrantEmailMismatch':
    'This invitation was sent to a different email address than the one you signed in with.',
  'error.clientAccessGrantEngagementNotInvitable':
    'This engagement is not currently accepting invitations.',
  'error.clientAccessGrantEngagementNotActive': 'This engagement is not currently active.',
  'error.clientAccessGrantInvalidTransition':
    'This invitation already reached a different final state.',
  'error.clientGardenNotFound': 'This garden could not be found.',

  'clientPortal.shellPrimaryNavLabel': 'Client portal',
  'clientPortal.myGardens': 'My gardens',
  'clientPortal.gardenNavLabel': 'Garden sections',
  'clientPortal.overviewTab': 'Overview',
  'clientPortal.publicationsTab': 'Updates',
  'clientPortal.timelineTab': 'Timeline',

  'clientPortal.gardensTitle': 'My gardens',
  'clientPortal.gardensDescription': 'Every garden you have an active connection to.',
  'clientPortal.gardensLoading': 'Loading your gardens.',
  'clientPortal.gardensRetry': 'Try again',
  'clientPortal.gardensEmpty': 'You have no active garden connections yet.',

  'clientPortal.overviewTitle': 'Garden overview',
  'clientPortal.overviewLoading': 'Loading the garden overview.',
  'clientPortal.overviewRetry': 'Try again',
  'clientPortal.overviewEmpty': 'Nothing has been published for this garden yet.',
  'clientPortal.overviewAsOf': 'As of {date}',
  'clientPortal.overviewPublishedAt': 'Published {date}',

  'clientPortal.publicationsTitle': 'Updates',
  'clientPortal.publicationsDescription':
    'Every update published for this garden, most recent first.',
  'clientPortal.publicationsLoading': 'Loading updates.',
  'clientPortal.publicationsRetry': 'Try again',
  'clientPortal.publicationsEmpty': 'No updates have been published for this garden yet.',
  'clientPortal.publicationVersionLabel': 'Update {version}',
  'clientPortal.publicationPublishedAt': 'Published {date}',
  'clientPortal.staffAttributionsTitle': 'Team',

  'clientPortal.timelineTitle': 'Garden timeline',
  'clientPortal.timelineDescription':
    'A factual, chronological record of what happened in this garden, oldest first.',
  'clientPortal.timelineLoading': 'Loading the garden timeline.',
  'clientPortal.timelineRetry': 'Try again',
  'clientPortal.timelineEmpty': 'This garden has no recorded history yet.',

  'clientPortal.kindWorkLog': 'Completed work',
  'clientPortal.kindMedia': 'Photo',
  'clientPortal.kindGardenSnapshot': 'Garden overview',
  'clientPortal.kindTimelineEntry': 'Note',
  'clientPortal.kindObservation': 'Progress note',

  'clientPortal.mediaRoleBefore': 'Before',
  'clientPortal.mediaRoleAfter': 'After',
  'clientPortal.mediaRoleGeneral': 'Photo',
  'clientPortal.mediaLoading': 'Loading photo.',
  'clientPortal.mediaAlt': '{role} photo',

  'clientPortal.inviteTitle': 'Accept your invitation',
  'clientPortal.inviteWorking': 'Checking your invitation.',
  'clientPortal.inviteMissingToken': 'This invitation link is missing its token.',
  'clientPortal.inviteSuccessTitle': 'Invitation accepted',
  'clientPortal.inviteSuccessDescription':
    'You now have access to this garden’s published updates.',
  'clientPortal.inviteGoToGardens': 'Go to my gardens',
} as const;
