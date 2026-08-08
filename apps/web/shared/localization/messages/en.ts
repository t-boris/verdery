/**
 * English message catalogue.
 *
 * This catalogue defines the message identifiers; every other language is typed
 * against it and therefore cannot omit or invent a key. Identifiers are shared
 * with the other clients so that a code change never means "find the English
 * sentence and translate it again".
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
import { englishAccessibilityMessages } from './en-accessibility';
import { englishCandidatesMessages } from './en-candidates';
import { englishMapMessages } from './en-map';
import { englishClientPortalMessages } from './en-client-portal';
import { englishCollaborationMessages } from './en-collaboration';
import { englishGardenContextMessages } from './en-garden-context';
import { englishMediaMessages } from './en-media';
import { englishCatalogMessages } from './en-catalog';
import { englishObservationsMessages } from './en-observations';
import { englishOrganizationsMessages } from './en-organizations';
import { englishPlantsMessages } from './en-plants';
import { englishPublicationsMessages } from './en-publications';
import { englishSeasonalPlanMessages } from './en-seasonal-plan';
import { englishSeasonalAcceptanceMessages } from './en-seasonal-acceptance';
import { englishTaskCollaborationMessages } from './en-task-collaboration';
import { englishTodayMessages } from './en-today';
import { englishWeatherMessages } from './en-weather';
import { englishCareRulesMessages } from './en-care-rules';
import { englishPlantCareMessages } from './en-plant-care';

export const englishMessages = {
  ...englishTodayMessages,
  ...englishWeatherMessages,
  ...englishCareRulesMessages,
  ...englishPlantCareMessages,
  ...englishAccessibilityMessages,
  ...englishCollaborationMessages,
  ...englishTaskCollaborationMessages,
  ...englishOrganizationsMessages,
  ...englishClientPortalMessages,
  ...englishSeasonalPlanMessages,
  ...englishSeasonalAcceptanceMessages,
  ...englishGardenContextMessages,
  ...englishCandidatesMessages,
  ...englishMapMessages,
  ...englishCatalogMessages,
  ...englishObservationsMessages,
  ...englishPublicationsMessages,
  'app.name': 'Verdery',
  'app.tagline': 'A living map of a real garden.',
  'app.skipToContent': 'Skip to content',

  'status.title': 'Service status',
  'status.description': 'Live results from the Verdery API health endpoints.',
  'status.refresh': 'Check again',
  'status.checking': 'Checking the API.',
  'status.liveness': 'Liveness',
  'status.readiness': 'Readiness',
  'status.version': 'Version {version}',
  'status.stateAlive': 'Process is running',
  'status.stateReady': 'Ready to serve traffic',
  'status.stateNotReady': 'Not ready to serve traffic',
  'status.dependencies': 'Dependencies',
  'status.dependencyAvailable': 'Available',
  'status.dependencyUnavailable': 'Unavailable',
  'status.dependenciesEmpty': 'The service reported no dependencies.',
  'status.announcementLoading': 'Checking service status.',
  'status.announcementLoaded': 'Service status updated.',

  'notFound.title': 'Page not found',
  'notFound.description': 'The address you opened does not match any page in this application.',
  'notFound.backHome': 'Back to the start page',

  'errorBoundary.title': 'Something went wrong',
  'errorBoundary.description':
    'This part of the application could not be displayed. You can try again without losing the rest of your session.',
  'errorBoundary.retry': 'Try again',
  'errorBoundary.reference': 'Support reference: {reference}',

  'error.title': 'The request did not succeed',
  'error.correlation': 'Support reference: {correlationId}',
  'error.requestInvalid': 'The request was rejected because it did not match the API contract.',
  'error.requestTooLarge': 'The request was larger than the API permits.',
  'error.idempotencyKeyReused': 'This request was already used for a different command.',
  'error.unauthenticated': 'You are not signed in, or the session has expired.',
  'error.forbidden': 'This account is not allowed to perform that action.',
  'error.staleRevision': 'The record changed before this edit was saved.',
  'error.rateLimited': 'Too many requests were sent. Wait a moment and try again.',
  'error.internal': 'The service failed unexpectedly.',
  'error.dependencyUnavailable': 'A service the API depends on is temporarily unavailable.',
  'error.transportFailure': 'The API could not be reached from this browser.',
  'error.malformedResponse': 'The API returned a response this application cannot interpret.',
  'error.gardenNotFound': 'This garden could not be found.',
  'error.gardenStaleRevision':
    'This garden changed before your edit was saved. Reload and try again.',
  'error.gardenLifecycleConflict': 'This action does not apply to the garden in its current state.',
  'error.mapObjectNotFound': 'This object could not be found.',
  'error.mapObjectStaleRevision':
    'This object changed before your edit was saved. Reload and try again.',
  'error.mapObjectLifecycleConflict':
    'This action does not apply to the object in its current state.',
  'error.mapObjectLocked': 'Unlock this object before changing it.',
  'error.deletionRecentAuthenticationRequired':
    'Deleting a garden needs a recent sign-in. Sign out, sign in again, and retry.',
  'error.deletionNotFound': 'There is no deletion waiting to be undone.',
  'error.deletionAlreadyRequested': 'A deletion has already been requested for this.',
  'error.deletionNotRecoverable':
    'The recovery window has closed, so this deletion can no longer be undone.',
  'error.mediaNotFound': 'That file is not here.',
  'error.mediaStaleRevision': 'This file changed while you were working. Reload and try again.',
  'error.mediaUploadStateConflict': 'This upload is not at a stage where that can be done.',
  'error.mediaNotAvailable': 'This file is still being processed. Try again shortly.',
  'error.mediaViewerAccessRestricted': 'Your access to this garden does not include this file.',
  'error.mediaProcessingJobNotFound': 'That processing job is not here.',
  'error.mediaReferenced': 'This file is still used elsewhere, so it cannot be deleted.',
  'error.mediaDerivativeNotDeletable':
    'Generated versions are removed with their original, not on their own.',
  'error.planPageNotReady':
    'The plan page is still being prepared. Wait a moment, then recognise it again.',
  'error.platReadingUnavailable': 'Plan recognition is not enabled in this environment.',
  'error.platReadingFailed':
    'The plan could not be read reliably. Try again or trace the lot manually.',
  'error.aerialTracingUnavailable': 'Automatic aerial tracing is not enabled in this environment.',
  'error.aerialTracingNeedsLocation': 'Save this garden’s address before detecting the property.',
  'error.aerialTracingFailed':
    'The property and its objects could not be detected from this aerial image.',
  'error.aerialTracingNeedsLot':
    'Align and save exactly one lot from the plat before detecting aerial objects.',
  'error.aerialTracingLotTooLarge': 'The saved lot is too large for automatic aerial tracing.',
  'error.candidateIdentificationSourceNotReady':
    'The full-size photo is still being prepared for identification. This retries automatically.',
  'error.candidateIdentificationPhotoMissing': 'Add a photo before identifying this candidate.',
  'error.candidateIdentificationNoConfidentMatch':
    'The plant could not be identified confidently from this photo. Try another clear photo.',
  'error.notificationNotFound': 'That notification is not here.',
  'error.notificationPreferencesStaleRevision':
    'Your notification settings changed elsewhere. Reload and try again.',
  'error.exportNotFound': 'That export is not here.',
  'error.exportActiveExportExists':
    'An export is already running. Wait for it to finish, then start another.',
  'error.exportRecentAuthenticationRequired':
    'Exporting your data needs a recent sign-in. Sign out, sign in again, and retry.',
  'error.exportNotDownloadable': 'This export is not ready to download, or its link has expired.',
  'error.unknown': 'The request failed for an unrecognized reason.',

  'connectivity.staleTitle': 'You are offline',
  'connectivity.staleDescription':
    'Showing what was already loaded. New changes cannot be saved until the connection returns.',

  'drafts.recoveredTitle': 'Unsaved work recovered',
  'drafts.recoveredDescription':
    'This was restored from a draft saved on this device. It has not been sent to the server.',
  'drafts.discard': 'Discard recovered draft',

  'shell.signOut': 'Sign out',
  'shell.languageLabel': 'Interface language',
  'shell.languageEnglish': 'Use English',
  'shell.languageRussian': 'Use Russian',
  'shell.primaryNavLabel': 'Application',
  'shell.gardenNavLabel': 'Garden sections',
  'shell.overviewTab': 'Overview',
  'shell.mapTab': 'Map',
  'shell.fieldConsole': 'Field console',
  'shell.gardenWorkspace': 'Garden workspace',
  'shell.operationsGroup': 'Operations',
  'shell.planGroup': 'Plan and map',
  'shell.recordsGroup': 'Records',
  'shell.administrationGroup': 'Administration',

  'auth.orSeparator': 'or',
  'auth.signInTitle': 'Sign in to Verdery',
  'auth.signInDescription': 'Sign in to see and manage your gardens.',
  'auth.signInWithGoogle': 'Continue with Google',
  'auth.signInWithApple': 'Continue with Apple',
  'auth.signInFailed': 'Sign-in did not succeed. Try again.',
  'auth.sessionExpired': 'Your session ended. Sign in again to continue where you left off.',
  'auth.emailLabel': 'Email address',
  'auth.emailSubmit': 'Send me a sign-in link',
  'auth.emailLinkSent': 'Check your email',
  'auth.emailLinkSentDescription': 'Open the link we sent to finish signing in.',
  'auth.completingSignIn': 'Completing sign-in.',
  'auth.emailLinkConfirmDescription': 'Confirm your email address to finish signing in.',
  'auth.emailLinkInvalid': 'This sign-in link is invalid or has expired. Request a new one.',

  'gardens.title': 'Gardens',
  'gardens.description': 'Every garden you own or collaborate on.',
  'gardens.loading': 'Loading gardens.',
  'gardens.retry': 'Try again',
  'gardens.empty': 'You have no gardens yet. Create your first one below.',
  'gardens.createTitle': 'Create a garden',
  'gardens.createNameLabel': 'Garden name',
  'gardens.createNamePlaceholder': 'Name your garden…',
  'gardens.createSubmit': 'Create garden',
  'gardens.nameSuggestions': 'Suggestions',
  'gardens.nameSuggestionHome': 'Home garden',
  'gardens.nameSuggestionBackyard': 'Backyard',
  'gardens.nameSuggestionCommunity': 'Community plot',
  'gardens.nameRequired': 'Enter a name up to 120 characters.',
  'gardens.lifecycleActive': 'Active',
  'gardens.lifecycleArchived': 'Archived',
  'gardens.restoreDeletion': 'Cancel deletion',
  'gardens.recoveryDeadline': 'Deletes on {date} unless cancelled',
  'gardens.lifecycleDeletionRequested': 'Deletion requested',
  'gardens.lifecyclePurging': 'Being deleted',
  'gardens.roleOwner': 'Owner',
  'gardens.roleEditor': 'Editor',
  'gardens.roleViewer': 'Viewer',
  'gardens.settingsTitle': 'Garden settings',
  'gardens.backToList': 'Back to gardens',
  'gardens.renameTitle': 'Name',
  'gardens.rename': 'Save name',
  'gardens.manageTitle': 'Manage garden',
  'gardens.archive': 'Archive garden',
  'gardens.archiveConfirm': 'Archive this garden? You can still view it afterward.',
  'gardens.requestDeletion': 'Delete garden',
  'gardens.requestDeletionConfirm':
    'Request deletion of this garden? This starts a recovery-window deletion process.',
  'gardens.photosTitle': 'Photos',
  'gardens.photosDescription':
    'Upload a photo of this garden. Uploading happens directly to storage, with real progress, pause, and resume.',

  'statusBar.disclosure': 'Planning only — not a survey',

  'tasks.pageTitle': 'Tasks',
  'tasks.pageDescription': "This garden's manual tasks.",
  'tasks.createTitle': 'Create a task',
  'tasks.createSubmit': 'Create task',
  'tasks.titleLabel': 'Title',
  'tasks.titleRequired': 'Enter a title up to 200 characters.',
  'tasks.notesLabel': 'Notes',
  'tasks.targetKindLabel': 'Target',
  'tasks.targetGardenAreaIdLabel': 'Garden area (map object ID)',
  'tasks.targetPlantIdLabel': 'Plant ID',
  'tasks.targetIdRequired': 'Enter an ID for this target.',
  'tasks.mapObjectIdHint': 'Paste the identifier of an object from this garden\u2019s map.',
  'tasks.dueDateLabel': 'Due date',
  'tasks.urgencyLabel': 'Urgency',
  'tasks.timeWindowStartLabel': 'Time window start',
  'tasks.timeWindowEndLabel': 'Time window end',
  'tasks.originObservationIdLabel': 'Origin observation ID (optional)',
  'tasks.recurrenceRuleLabel': 'Recurrence rule',
  'tasks.filterLegend': 'Filter by status',
  'tasks.loading': 'Loading tasks.',
  'tasks.retry': 'Try again',
  'tasks.empty': 'No tasks match the current filter.',
  'tasks.dueDateDisplay': 'Due {date}',
  'tasks.completedAtDisplay': 'Completed {date}',
  'tasks.edit': 'Edit',
  'tasks.reschedule': 'Reschedule',
  'tasks.skip': 'Skip',
  'tasks.delete': 'Delete',
  'tasks.deleteConfirm': 'Delete this task?',
  'tasks.saveEdit': 'Save changes',
  'tasks.cancelEdit': 'Cancel',
  'tasks.saveReschedule': 'Save schedule',
  'tasks.completionNoteLabel': 'Completion note (optional)',
  'tasks.complete': 'Complete',
  'tasks.dismissReasonLabel': 'Reason (optional)',
  'tasks.dismiss': 'Dismiss',

  'tasks.enum.targetKind.garden': 'Whole garden',
  'tasks.enum.targetKind.gardenArea': 'Garden area',
  'tasks.enum.targetKind.plant': 'Plant',
  'tasks.enum.status.planned': 'Planned',
  'tasks.enum.status.suggested': 'Suggested',
  'tasks.enum.status.completed': 'Completed',
  'tasks.enum.status.skipped': 'Skipped',
  'tasks.enum.status.dismissed': 'Dismissed',
  'tasks.enum.status.deleted': 'Deleted',
  'tasks.enum.urgency.low': 'Low',
  'tasks.enum.urgency.normal': 'Normal',
  'tasks.enum.urgency.high': 'High',
  'tasks.enum.urgency.urgent': 'Urgent',
  'gardenLocation.addressLabel': 'Address',
  'gardenLocation.addressSearch': 'Find',
  'gardenLocation.addressNoMatches':
    'No address matched. Check the spelling, or place the point yourself.',
  'gardenLocation.addressProviderUnavailable':
    'The address service did not answer. Enter the coordinates instead, or try again.',
  'gardenLocation.addressUsOnly':
    'Address search covers the whole world. Address data © OpenStreetMap contributors.',
  'gardenLocation.precisionStreetAddress': 'House number',
  'gardenLocation.precisionStreet': 'Street only',
  'gardenLocation.precisionArea': 'Area only',
  'gardenLocation.title': 'Location and north',
  'gardenLocation.description':
    'Where this garden sits on the Earth, and which way its map faces. Weather, hemisphere, and the seasonal plan all read this — without it they have nothing to work from.',
  'gardenLocation.loading': 'Loading this garden’s location.',
  'gardenLocation.empty': 'This garden has no location yet.',
  'gardenLocation.currentCoordinates': 'Latitude, longitude',
  'gardenLocation.currentRotation': 'North',
  'gardenLocation.currentAccuracy': 'Reported accuracy',
  'gardenLocation.accuracyUnknown': 'Not stated',
  'gardenLocation.degrees': '{degrees}° clockwise from the map’s up',
  'gardenLocation.metres': '±{metres} m',
  'gardenLocation.useMyLocation': 'Use my current location',
  'gardenLocation.geolocationUnavailable': 'This browser cannot report a location.',
  'gardenLocation.geolocationRefused':
    'The browser did not report a location. Enter the coordinates instead.',
  'gardenLocation.latitudeLabel': 'Latitude',
  'gardenLocation.longitudeLabel': 'Longitude',
  'gardenLocation.rotationLabel': 'North, in degrees',
  'gardenLocation.advanced': 'Coordinates and north',
  'gardenLocation.rotationHint':
    'How far to turn the map clockwise so its up points north. Leave 0 if the map is already drawn north-up.',
  'gardenLocation.coordinatesInvalid':
    'Latitude must be between -90 and 90, and longitude between -180 and 180.',
  'gardenLocation.rotationInvalid': 'North must be at least 0 and less than 360 degrees.',
  'gardenLocation.saved': 'Location saved.',
  'gardenLocation.submit': 'Save location',

  ...englishMediaMessages,
  ...englishPlantsMessages,
} as const;
