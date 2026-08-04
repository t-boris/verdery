/**
 * English UI copy used to locate elements in the E2E specs.
 *
 * A small, deliberate duplicate of the relevant entries in
 * `shared/localization/messages/en.ts`, not an import of that module: the
 * Playwright config runs specs outside the Next.js build, and pinning
 * exact strings here makes a locale-catalogue rename fail LOUDLY here (a
 * broken selector) rather than silently, which is the property this file
 * exists for. Keep in sync by hand when the referenced keys change.
 */
export const copy = {
  emailLabel: 'Email address',
  emailSubmit: 'Send me a sign-in link',
  emailLinkSent: 'Check your email',
  signInWithGoogle: 'Continue with Google',
  signInFailed: 'Sign-in did not succeed. Try again.',
  sessionExpired: 'Your session ended. Sign in again to continue where you left off.',
  gardensTitle: 'Gardens',
  gardensEmpty: 'You have no gardens yet. Create your first one below.',
  gardensCreateNameLabel: 'Garden name',
  gardensCreateSubmit: 'Create garden',
  signOut: 'Sign out',
  plantDisplayNameLabel: 'Display name',
  plantAddSubmit: 'Add plant',
  todayNavLink: 'Today',
  todayEmpty: 'Nothing needs attention right now.',
  todayElevatedRiskNote:
    'This suggestion carries elevated risk. Review it carefully before acting.',
  todayStaleWeatherBasis: 'using cached weather data that may be out of date',
  todayDetailsShow: 'Show evidence and factors',
  todayComplete: 'Complete',
  todayPostpone: 'Postpone',
  todayPostponeUntilLabel: 'Show again after (optional)',
  todayDismiss: 'Dismiss',
  todayMarkIrrelevant: 'Not relevant',
  todayMarkIrrelevantRecorded: 'Thanks — this feedback was recorded.',
  todayConvertToTask: 'Add to tasks',
  taskFromRecommendation: 'Created from a recommendation',
  taskStatusPlanned: 'Planned',
  taskTitleLabel: 'Title',
  taskCreateSubmit: 'Create task',
  observationNoteLabel: 'Note',
  observationSubmit: 'Record observation',
  mapPageTitle: 'Garden map',
  mapSelectTool: 'Select',
  mapDrawBedTool: 'Draw bed',
  mapDrawLotTool: 'Draw lot boundary',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',
  saveLocation: 'Save location',
  locationSaved: 'Location saved.',
  backdropNeedsLocation:
    'Give this garden a location on its Overview page to draw over a map of the real place.',
  mapEmptyTraceAction: 'Trace the lot',
  mapEmptyLocateAction: 'Set the location',
  mapObjectListTitle: 'Objects',
  skipToContent: 'Skip to content',
  signInTitle: 'Sign in to Verdery',
  todayDetailsHide: 'Hide evidence and factors',
} as const;
