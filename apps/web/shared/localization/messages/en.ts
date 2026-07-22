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
  'error.unknown': 'The request failed for an unrecognized reason.',
} as const;
