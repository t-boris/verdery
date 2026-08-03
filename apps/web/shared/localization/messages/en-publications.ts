/**
 * English messages for the client-publication domain (P9C-PUBLISH-01):
 * the `internal_draft -> ready_for_client -> published -> withdrawn`
 * client-update workflow, item staging, and the publisher-grant admin
 * panel — a separate module spread into `en.ts`, the same "the main
 * catalogue sits at the repository's 600-line source-file limit" reasoning
 * `en-organizations.ts` documents for itself. Also carries the
 * `ClientUpdateErrorCode`/`PublisherGrantErrorCode` message keys
 * `error-message.ts` maps to, for the identical reason.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * packages/api-contracts/openapi.yaml, tag `Publications`.
 */
export const englishPublicationsMessages = {
  'error.clientUpdateNotFound': 'This client update could not be found.',
  'error.clientUpdatePublisherAccessRequired':
    'You need publisher access on this engagement to do that. Ask an engagement administrator to grant it.',
  'error.clientUpdateEngagementNotActive': 'This engagement is not active.',
  'error.clientUpdateInvalidTransition':
    'This client update does not allow that change from its current state.',
  'error.clientUpdateSummaryRequired': 'Add a summary before submitting this update.',
  'error.clientUpdateItemNotFound': 'This item could not be found on this update.',
  'error.clientUpdateSelectedItemInvalid': 'This item is no longer available to select.',
  'error.clientUpdateStaffProfileNotFound': 'No account exists at that profile ID.',
  'error.clientUpdateStaleRevision': 'This client update changed since you last loaded it.',
  'error.publisherGrantNotFound': 'This publisher grant could not be found.',
  'error.publisherGrantAlreadyActive': 'This person already holds an active publisher grant.',
  'error.publisherGrantGranteeNotOrganizationMember':
    'Only an active member of the organization behind this engagement can be granted publisher access.',
  'error.publisherGrantGranteeNotGardenMember':
    'Only an active member of this garden can be granted publisher access.',

  'publications.pageTitle': 'Client updates',
  'publications.backToList': 'Back',
  'publications.loading': 'Loading client updates.',
  'publications.retry': 'Try again',
  'publications.empty': 'No client updates yet.',
  'publications.createTitle': 'Start a client update',
  'publications.createTitleLabel': 'Title',
  'publications.createSubmit': 'Start draft',
  'publications.titleRequired': 'Enter a title.',
  'publications.open': 'Open',

  'publications.state.internal_draft': 'Internal draft',
  'publications.state.ready_for_client': 'Ready to publish',
  'publications.state.published': 'Published',
  'publications.state.withdrawn': 'Withdrawn',

  'publications.editTitle': 'Content',
  'publications.editTitleLabel': 'Title',
  'publications.editSummaryLabel': 'Summary',
  'publications.editSummaryHint':
    'What the client will read — required before this can be submitted.',
  'publications.editSave': 'Save',
  'publications.editSaved': 'Saved.',

  'publications.lifecycleTitle': 'Status',
  'publications.submit': 'Submit for publishing',
  'publications.submitConfirm': 'Submit this draft? It moves out of internal editing.',
  'publications.submitDisabledNoSummary': 'Add a summary above before submitting.',
  'publications.publish': 'Publish',
  'publications.publishConfirm':
    'Publish this update to the client now? This creates a new, permanent published version.',
  'publications.publishNoteLabel': 'Note for the timeline (optional)',
  'publications.publishNoteHint':
    'A short free-text entry attached to this published version, in addition to the staged items below.',
  'publications.withdraw': 'Withdraw',
  'publications.withdrawConfirm': 'Withdraw this published update? This cannot be undone.',
  'publications.withdrawReasonLabel': 'Reason (optional)',
  'publications.publishedAs': 'Published as version {versionNumber}.',

  'publications.itemsTitle': 'Staged items',
  'publications.itemsEmpty': 'No items staged yet.',
  'publications.itemKind.work_log': 'Work log',
  'publications.itemKind.media': 'Photo',
  'publications.itemKind.observation': 'Observation',
  'publications.mediaRole.before': 'Before',
  'publications.mediaRole.after': 'After',
  'publications.mediaRole.general': 'General',

  'publications.addItemTitle': 'Stage an item',
  'publications.addItemKindLabel': 'Kind',
  'publications.addItemWorkLogLabel': 'Completed work',
  'publications.addItemWorkLogPlaceholder': 'Choose completed work',
  'publications.addItemNoEligibleWorkLogs': 'No completed work is logged on this engagement yet.',
  'publications.addItemDescriptionLabel': 'Description',
  'publications.addItemMediaRoleLabel': 'Role',
  'publications.addItemCaptionLabel': 'Caption (optional)',
  'publications.addItemObservationLabel': 'Observation',
  'publications.addItemObservationPlaceholder': 'Choose an observation',
  'publications.addItemNoEligibleObservations':
    'This garden has no observations to publish from yet.',
  'publications.addItemMediaLabel': 'Photograph',
  'publications.addItemMediaPlaceholder': 'Choose a photograph',
  'publications.addItemNoEligibleMedia':
    'No photograph is ready to publish yet. A photo becomes available once its processed copy exists — an original is never published, because its file can carry location data.',
  'publications.addItemMediaDerivativeHint':
    'Clients see a processed copy, never the original file.',
  'publications.addItemOccurredAtLabel': 'When',
  'publications.addItemSubmit': 'Stage item',
  'publications.removeItem': 'Remove',
  'publications.removeItemConfirm': 'Remove this item from the draft?',

  'publications.accessTitle': 'Publisher access',
  'publications.accessDescription':
    'Publisher access is separate from administering this engagement — grant it explicitly to draft or publish client updates.',
  'publications.accessLoading': 'Loading publisher access.',
  'publications.accessRetry': 'Try again',
  'publications.accessEmpty': 'Nobody has publisher access on this engagement yet.',
  'publications.accessGrantTitle': 'Grant publisher access',
  'publications.accessGrantProfileIdLabel': 'Profile ID',
  'publications.accessGrantProfileIdHint':
    'Enter the account ID of the person who will draft and publish client updates.',
  'publications.accessGrantSubmit': 'Grant access',
  'publications.accessRevoke': 'Revoke',
  'publications.accessRevokeConfirm': 'Revoke this person’s publisher access?',
  'publications.accessState.active': 'Active',
  'publications.accessState.revoked': 'Revoked',
} as const;
