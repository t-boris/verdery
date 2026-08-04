/**
 * English messages for media upload, preview, and the garden property plan
 * upload flow.
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-today.ts`, `en-accessibility.ts`, and
 * `en-collaboration.ts` already document.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const englishMediaMessages = {
  'media.selectFile': 'Choose a photo',
  'media.chooseAction': 'Browse…',
  'media.noFileChosen': 'No file chosen',
  'media.tooLarge': 'This file is larger than the {max} limit. Choose a smaller photo.',
  'media.progressLabel': 'Uploading {filename}: {uploaded} of {total}',
  'media.pause': 'Pause',
  'media.resume': 'Resume upload',
  'media.retry': 'Retry',
  'media.cancel': 'Cancel upload',
  'media.recoverableDescription':
    'An interrupted upload was found: {filename}, {percent}% already sent. Resume it, or discard it and start over.',
  'media.resumeRecovered': 'Resume interrupted upload',
  'media.discardRecovered': 'Discard',
  'media.previewLoading': 'Loading preview.',
  'media.previewAlt': 'Uploaded photo: {filename}',
  'media.rejectedDescription':
    'This file could not be verified — what actually arrived did not match what was declared when the upload started. Choose the file again and retry.',
  'media.processingFailedDescription':
    'This file uploaded and was verified, but could not be processed. You can try uploading it again.',

  'media.plan.title': 'Property plan',
  'media.plan.description':
    'Upload a plan of your property — a scan, a photo, or a PDF — to use as a private map background. Up to 50 MiB.',
  'media.plan.selectFile': 'Choose a plan document',
  'media.plan.unsupportedType':
    'This file type is not supported. Choose a JPEG, PNG, WebP, HEIC/HEIF image, or a PDF.',
  'media.plan.pdfNoPreview':
    'This PDF uploaded and passed validation, but PDF pages cannot be previewed yet. It can still be placed on the map as a background placeholder.',
  'media.plan.previewUnavailable': 'No preview is available for this plan yet.',
  'media.plan.previewAlt': 'Plan preview: {filename}',
  'media.plan.readyForMap':
    'The plan is uploaded and validated. Add it to the map from the map editor’s “Plan backgrounds” panel.',

  'media.phase.idle': '',
  'media.phase.recoverable': 'An interrupted upload was found.',
  'media.phase.registering': 'Preparing the upload.',
  'media.phase.uploading': 'Uploading.',
  'media.phase.paused': 'Upload paused.',
  'media.phase.completing': 'Finishing the upload.',
  'media.phase.processing': 'Verifying and processing the upload. This can take a moment.',
  'media.phase.processed': 'Ready.',
  'media.phase.rejected': 'This file was rejected.',
  'media.phase.processingFailed': 'Processing failed for this file.',
  'media.phase.sessionExpired':
    'The upload session expired before it finished. Retry to start again.',
  'media.phase.uploadFailed': 'The upload did not finish.',
  'media.phase.apiFailed': 'The request did not succeed.',

  'media.failureReason.networkError':
    'The upload was interrupted by a network problem. It can be retried from where it left off.',
  'media.failureReason.unexpectedStatus':
    'Cloud Storage rejected the upload with an unexpected response. Retrying will start a new upload session.',
} as const;
