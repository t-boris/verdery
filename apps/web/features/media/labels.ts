import { formatFixed, type Locale, type MessageKey } from '@/shared/localization/public';

import type { MediaUploadFailureReason, MediaUploadPhase } from './media-upload-controller';

/**
 * Message-key mapping for the media-upload state machine.
 *
 * Source: `media-upload-controller.ts`'s own `MediaUploadPhase`/
 * `MediaUploadFailureReason`.
 */
export function uploadPhaseLabel(phase: MediaUploadPhase): MessageKey {
  switch (phase) {
    case 'idle':
      return 'media.phase.idle';
    case 'recoverable':
      return 'media.phase.recoverable';
    case 'registering':
      return 'media.phase.registering';
    case 'uploading':
      return 'media.phase.uploading';
    case 'paused':
      return 'media.phase.paused';
    case 'completing':
      return 'media.phase.completing';
    case 'processing':
      return 'media.phase.processing';
    case 'processed':
      return 'media.phase.processed';
    case 'rejected':
      return 'media.phase.rejected';
    case 'processingFailed':
      return 'media.phase.processingFailed';
    case 'sessionExpired':
      return 'media.phase.sessionExpired';
    case 'uploadFailed':
      return 'media.phase.uploadFailed';
    case 'apiFailed':
      return 'media.phase.apiFailed';
  }
}

export function uploadFailureReasonLabel(reason: MediaUploadFailureReason): MessageKey {
  switch (reason) {
    case 'networkError':
      return 'media.failureReason.networkError';
    case 'unexpectedStatus':
      return 'media.failureReason.unexpectedStatus';
  }
}

/**
 * A byte count as a short, readable size in the reader's locale.
 *
 * One implementation for both upload widgets, which each carried their own
 * identical copy. The separator follows the locale (`1,5 MiB` in Russian);
 * the IEC symbols B/KiB/MiB deliberately do not — they are international
 * symbols, not words, and are written the same way in both catalogues.
 */
export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes < 1024) {
    return `${formatFixed(bytes, 0, locale)} B`;
  }

  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${formatFixed(kibibytes, 0, locale)} KiB`;
  }

  return `${formatFixed(kibibytes / 1024, 1, locale)} MiB`;
}
