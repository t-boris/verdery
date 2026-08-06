export const englishAerialTraceMessages = {
  'map.aerialTrace.title': 'Trace this aerial image',
  'map.aerialTrace.description':
    'Centers a bounded image on the saved address, isolates the property containing that point, and proposes visible objects for review.',
  'map.aerialTrace.legalWarning':
    'Aerial tracing is approximate and cannot establish a legal property boundary.',
  'map.aerialTrace.action': 'Trace aerial image',
  'map.aerialTrace.running': 'Finding this property…',
  'map.aerialTrace.needsLocation': 'Save a precise address before tracing.',
  'map.aerialTrace.disabled': 'Aerial tracing is not configured in this environment.',
  'map.aerialTrace.outsideCoverage': 'Supported aerial imagery is not available here.',
  'map.aerialTrace.unusableImagery':
    'The imagery or location fit is not accurate enough to trace safely.',
  'map.aerialTrace.quotaExceeded': 'The tracing limit has been reached. Try again later.',
  'map.aerialTrace.timedOut': 'The imagery or vision provider timed out.',
  'map.aerialTrace.providerFailure': 'The imagery or vision provider could not complete the trace.',
  'map.aerialTrace.noVisibleGeometry':
    'The target property could not be isolated, or no geometry was visible enough to propose.',
  'map.aerialTrace.dateUnknown': 'imagery date not supplied',
  'map.aerialTrace.editHint':
    'Select a proposal to move it or edit its vertices on the image. Category choices stay compatible with its geometry.',
  'map.aerialTrace.label': 'Label',
  'map.aerialTrace.category': 'Category',
  'map.aerialTrace.reject': 'Reject proposal',
  'map.aerialTrace.include': 'Include in selected proposals',
  'map.aerialTrace.acceptOne': 'Accept this proposal',
  'map.aerialTrace.acceptSelected': 'Accept selected proposals: {count}',
  'map.aerialTrace.accepted': 'Accepted aerial proposals: {count}.',
  'map.aerialTrace.stale':
    'The saved location changed after this trace. Trace the aerial image again before accepting.',
} as const;
