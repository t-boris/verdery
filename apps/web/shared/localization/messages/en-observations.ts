/**
 * English messages for the observations feature: the timeline, recording
 * and correction forms, and photo health-suggestion review
 * (P11-HEALTH-01's disposition control).
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-plants.ts` already documents. Extracted out of `en.ts`
 * at the point this file's own P11-HEALTH-01 keys were added, the same
 * "split once a block grows" posture `en-today.ts`/`en-accessibility.ts`
 * already established.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const englishObservationsMessages = {
  'observations.pageTitle': 'Observations',
  'observations.pageDescription': "This garden's chronological observation history.",
  'observations.recordTitle': 'Record an observation',
  'observations.recordSubmit': 'Record observation',
  'observations.noteTextLabel': 'Note',
  'observations.conditionSummaryLabel': 'Condition summary',
  'observations.noteOrSummaryRequired': 'Enter a note or a condition summary.',
  'observations.plantIdLabel': 'Plant ID (optional)',
  'observations.gardenObjectIdLabel': 'Garden area (map object ID, optional)',
  'observations.observedAtLabel': 'Observed at',
  'observations.mediaGapHint':
    'Photo attachments are not connected to observations yet, though uploading itself now works elsewhere in this application (a garden photo, from the garden settings page). A note and/or a condition summary is enough to record an observation.',
  'observations.historyTitle': 'History',
  'observations.loading': 'Loading the observation history.',
  'observations.retry': 'Try again',
  'observations.empty': 'No observations recorded yet.',
  'observations.isCorrectedBadge': 'Corrected',
  'observations.correctionOf': '{kind} of observation {id}',
  'observations.photoLabel': 'Photo',
  'observations.analysisSuggestion': 'Possible {label} ({confidence} confidence)',
  'observations.analysisRequiresConfirmation':
    'This is an automated suggestion, not a confirmed diagnosis — it requires your confirmation.',
  'observations.analysisRequestsMoreEvidence': 'More evidence was requested for this suggestion.',
  'observations.correctAction': 'Correct this observation',
  'observations.correctionExplanation':
    'A correction adds a new entry to the timeline; it never edits or removes the original.',
  'observations.correctionKindLabel': 'Correction type',
  'observations.correctionSubmit': 'Record correction',
  'observations.correctionCancel': 'Cancel',

  'observations.analysisEvidenceSummary': 'What supports this: {summary}',
  'observations.analysisAlternativeExplanationsLabel': 'Other possible explanations',
  'observations.analysisModelUnavailable':
    'No AI model could be reached for this photo — this is a placeholder, not a suggestion to act on.',
  'observations.analysisDispositionLabel': 'Your review',
  'observations.analysisSaveDisposition': 'Save review',
  'observations.analysisDispositionSaved': 'Review saved.',
  'observations.analysisDispositionSetBy': 'Reviewed {date}',

  'observations.journalTitle': 'Photo journal',
  'observations.journalPurposeLabel': 'Compare shots of',
  'observations.journalPurposeAll': 'Everything, in order',
  'observations.journalEmpty': 'No photographs have been attached to this plant yet.',
  'observations.journalEmptyForPurpose': 'No photographs of this kind yet. Try another shot type.',
  'observations.journalFrameAlt': 'Photograph observed {observed}',
  'observations.journalFramePurposeAlt': '{purpose}, observed {observed}',

  'observations.enum.photoPurpose.wholePlant': 'Whole plant',
  'observations.enum.photoPurpose.leafFront': 'Leaf, front',
  'observations.enum.photoPurpose.leafBack': 'Leaf, back',
  'observations.enum.photoPurpose.stemOrBark': 'Stem or bark',
  'observations.enum.photoPurpose.flower': 'Flower',
  'observations.enum.photoPurpose.fruit': 'Fruit',
  'observations.enum.photoPurpose.symptomCloseUp': 'Symptom close-up',
  'observations.enum.photoPurpose.contextOrFreeForm': 'Context or free-form',

  'observations.enum.analysisKind.stress': 'Stress',
  'observations.enum.analysisKind.disease': 'Disease',
  'observations.enum.analysisKind.pest': 'Pest',
  'observations.enum.analysisKind.other': 'Other',
  'observations.enum.correctionKind.amendment': 'Amendment',
  'observations.enum.correctionKind.supersede': 'Supersede',
  'observations.enum.actorType.user': 'User',
  'observations.enum.actorType.system': 'System',

  'observations.enum.safetyClass.informational': 'Informational',
  'observations.enum.safetyClass.monitor': 'Worth monitoring',
  'observations.enum.safetyClass.expertReviewRecommended': 'Expert review recommended',

  'observations.enum.disposition.unresolved': 'Not reviewed yet',
  'observations.enum.disposition.confirmedExternally': 'Confirmed elsewhere',
  'observations.enum.disposition.acceptedAsObservation': 'Accepted as an observation',
  'observations.enum.disposition.rejected': 'Rejected',
};
