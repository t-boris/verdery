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
export const englishMessages = {
  'app.name': 'Verdery',
  'app.tagline': 'A living map of a real garden.',
  'app.skipToContent': 'Skip to content',

  'home.title': 'Verdery web application',
  'home.description':
    'This is the application shell. Garden mapping and care features arrive in later phases.',
  'home.openStatus': 'Open service status',

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
  'error.unknown': 'The request failed for an unrecognized reason.',

  'shell.signOut': 'Sign out',

  'auth.signInTitle': 'Sign in to Verdery',
  'auth.signInDescription': 'Sign in to see and manage your gardens.',
  'auth.signInWithGoogle': 'Continue with Google',
  'auth.signInWithApple': 'Continue with Apple',
  'auth.signInFailed': 'Sign-in did not succeed. Try again.',
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
  'gardens.createSubmit': 'Create garden',
  'gardens.nameRequired': 'Enter a name up to 120 characters.',
  'gardens.lifecycleActive': 'Active',
  'gardens.lifecycleArchived': 'Archived',
  'gardens.lifecycleDeletionRequested': 'Deletion requested',
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

  'map.page.title': 'Garden map',
  'map.page.backToSettings': 'Garden settings',
  'map.page.openMap': 'Open map',
  'map.loading': 'Loading the garden map.',

  'map.toolbar.groupLabel': 'Editing tools',
  'map.toolbar.select': 'Select',
  'map.toolbar.createLot': 'Draw lot boundary',
  'map.toolbar.createStructure': 'Draw structure',
  'map.toolbar.createFence': 'Draw fence',
  'map.toolbar.createTree': 'Place tree',
  'map.toolbar.createPlant': 'Place plant',
  'map.toolbar.finish': 'Finish shape',
  'map.toolbar.cancel': 'Cancel drawing',
  'map.toolbar.undo': 'Undo',
  'map.toolbar.redo': 'Redo',

  'map.canvas.ariaLabel': 'Garden map canvas',
  'map.canvas.hintPoint': 'Click the map to place the new {category}.',
  'map.canvas.hintPath':
    'Click to add points. Double-click, press Enter, or choose "Finish shape" to complete it. Press Escape to cancel.',
  'map.canvas.draftTooSmall':
    'Add more points, or space them further apart, before finishing this shape.',

  'map.objectList.title': 'Objects',
  'map.objectList.empty': 'This garden has no objects yet. Use the toolbar to add one.',
  'map.objectList.untitled': 'Untitled {category}',
  'map.objectList.delete': 'Delete',
  'map.objectList.deleteAriaLabel': 'Delete {label}',
  'map.objectList.selectAriaLabel': 'Select {label}, {category}',

  'map.properties.title': 'Properties',
  'map.properties.emptyState':
    'Select an object on the map or in the list to see and edit its properties.',
  'map.properties.label': 'Label',
  'map.properties.category': 'Category',
  'map.properties.revision': 'Revision {revision}',
  'map.properties.save': 'Save changes',
  'map.properties.saved': 'Changes saved.',
  'map.properties.delete': 'Delete object',
  'map.properties.deleteConfirm': 'Delete this object? You can undo this from the toolbar.',
  'map.properties.deletedStatus': '{label} deleted. Choose Undo in the toolbar to bring it back.',
  'map.properties.detailsNotEditable':
    'Detailed fields for this category are not editable in this pass — only the label can be changed here.',
  'map.properties.structureKind': 'Structure type',
  'map.properties.fenceKind': 'Fence type',
  'map.properties.heightMetres': 'Height (metres)',
  'map.properties.commonName': 'Common name',
  'map.properties.estimatedHeightMetres': 'Estimated height (metres)',
  'map.properties.estimatedSpreadMetres': 'Estimated spread (metres)',
  'map.properties.quantity': 'Quantity',
  'map.properties.spacingMetres': 'Spacing (metres)',
  'map.properties.assignedToObjectId': 'Assigned bed or zone ID',

  'map.enum.structureKind.house': 'House',
  'map.enum.structureKind.shed': 'Shed',
  'map.enum.structureKind.greenhouse': 'Greenhouse',
  'map.enum.structureKind.deck': 'Deck',
  'map.enum.structureKind.garage': 'Garage',
  'map.enum.structureKind.other': 'Other',
  'map.enum.fenceKind.wood': 'Wood',
  'map.enum.fenceKind.chainLink': 'Chain link',
  'map.enum.fenceKind.vinyl': 'Vinyl',
  'map.enum.fenceKind.metal': 'Metal',
  'map.enum.fenceKind.hedge': 'Hedge',
  'map.enum.fenceKind.other': 'Other',

  'map.category.lot': 'Lot boundary',
  'map.category.structure': 'Structure',
  'map.category.fence': 'Fence',
  'map.category.gate': 'Gate',
  'map.category.path': 'Path',
  'map.category.zone': 'Zone',
  'map.category.bed': 'Bed',
  'map.category.waterFeature': 'Water feature',
  'map.category.utilityExclusion': 'Utility exclusion',
  'map.category.tree': 'Tree',
  'map.category.plant': 'Plant',
  'map.category.annotation': 'Annotation',
  'map.category.importedBackground': 'Imported background',

  'map.status.created': '{label} created.',
  'map.status.moved': '{label} moved.',
  'map.status.moveFailed':
    'The move could not be saved. The object was returned to its last saved position.',
  'map.status.commandFailed': 'The change could not be saved.',
  'map.status.undoApplied': 'Undo applied.',
  'map.status.redoApplied': 'Redo applied.',
  'map.status.undoUnavailable':
    'This change cannot be undone automatically in this pass. See the history entry for why.',
  'map.status.nothingToUndo': 'Nothing to undo.',
  'map.status.nothingToRedo': 'Nothing to redo.',

  'map.history.title': 'History',
  'map.history.notUndoable': 'not undoable in this pass',
} as const;
