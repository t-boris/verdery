'use client';

import type { MediaProcessingState } from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert } from '@/shared/ui/public';

import styles from './media-preview.module.css';
import { useMediaAccess } from './queries';

export interface MediaPreviewProps {
  readonly gardenId: string;
  readonly mediaId: string;
  readonly processingState: MediaProcessingState | null;
  readonly displayFilename: string;
}

/**
 * Renders whatever object `GetMediaAccess` actually returns for `mediaId` —
 * nothing more. Section 12 step 3 ("Selects an appropriate original or
 * derivative") has no real implementation to call into yet:
 * `get-media-access.ts` always signs and returns the exact record it was
 * asked for; there is no server-side derivative-selection or thumbnail-
 * preference mechanism, and no endpoint exposes a derivative's own media id
 * to a client that only knows the original's — re-verified directly against
 * current code for this work package rather than trusted from an older
 * report. This component does not invent one: it shows the original, full-
 * resolution image, exactly as served.
 *
 * Renders nothing before `processingState === 'processed'` — the caller
 * already shows its own "still processing" state for every phase before
 * that (`garden-photo-upload.tsx`).
 *
 * HEIC/HEIF rendering is a real, known, and deliberately out-of-scope gap:
 * `image_class: 'garden_photo'` accepts HEIC/HEIF (media-storage-and-
 * processing.md section 8.1), but a plain `<img>` cannot decode that codec
 * in most non-Safari browsers — Chrome and Firefox have no native HEIC
 * decoder. No client-side transcoding workaround is built here; a garden
 * photo derivative (already JPEG, per section 9.1) would sidestep this once
 * a processing worker is deployed and `GetMediaAccess` ever has more than
 * one object to choose from for the same media id (see this component's own
 * derivative-selection note above).
 *
 * Source: architecture/media-storage-and-processing.md, section "12.
 * Download Flow"; implementation-plan.md work package P6-WEB-01.
 */
export function MediaPreview({
  gardenId,
  mediaId,
  processingState,
  displayFilename,
}: MediaPreviewProps) {
  const { t } = useLocalization();
  const query = useMediaAccess(gardenId, mediaId, processingState === 'processed');

  if (processingState !== 'processed') {
    return null;
  }

  if (query.isPending) {
    return <p role="status">{t('media.previewLoading')}</p>;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  // A plain `<img>`, not `next/image`: the source is a short-lived signed
  // Cloud Storage URL, re-issued on every fetch — not a build-time-
  // optimizable static asset, and `next/image`'s remote-pattern allowlist
  // would need to match a per-request signed URL, not a stable host path.
  return (
    <img
      className={styles['preview']}
      src={query.data.url}
      alt={t('media.previewAlt', { filename: displayFilename })}
    />
  );
}
