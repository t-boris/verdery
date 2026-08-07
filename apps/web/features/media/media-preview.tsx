'use client';

import type { MediaDerivativeSummary, MediaProcessingState } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert, PhotoLightbox } from '@/shared/ui/public';

import styles from './media-preview.module.css';
import { useMediaAccess } from './queries';

export interface MediaPreviewProps {
  readonly gardenId: string;
  readonly mediaId: string;
  readonly processingState: MediaProcessingState | null;
  readonly displayFilename: string;
  /** The original's `Media.derivatives` (GetMediaStatus/ListGardenMedia). Empty/omitted falls back to the original object itself. */
  readonly derivatives?: readonly MediaDerivativeSummary[];
}

/**
 * Section 12 step 3 ("Selects an appropriate original or derivative"),
 * client-side — the same convention `features/map/use-background-image.ts`
 * established in P6-PLAN-01: the server exposes each derivative's own media
 * id through `Media.derivatives`, the client picks. This preview prefers
 * the JPEG `screen_preview` (1600px, section 9.1), falls back to
 * `thumbnail`, and only serves the original itself when no derivative
 * exists yet (a record processed before P6-WORKER-02, or a class that gets
 * none).
 *
 * Preferring the derivative also closes the HEIC/HEIF gap this component
 * used to document as unavoidable: a `garden_photo` original may be HEIC,
 * which Chrome/Firefox cannot decode natively, but every derivative is
 * JPEG by construction (section 9.1), so any browser renders it. A
 * HEIC-original photo with no derivatives yet still falls back to the
 * original and hits that codec gap — that residual case disappears as soon
 * as processing produces derivatives, which is also the only state this
 * component renders in.
 *
 * Renders nothing before `processingState === 'processed'` — the caller
 * already shows its own "still processing" state for every phase before
 * that (`garden-photo-upload.tsx`).
 *
 * Source: architecture/media-storage-and-processing.md, sections "9.1",
 * "12. Download Flow"; implementation-plan.md work packages P6-WEB-01,
 * P6-PLAN-01.
 */
export function MediaPreview({
  gardenId,
  mediaId,
  processingState,
  displayFilename,
  derivatives = [],
}: MediaPreviewProps) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const preferred =
    derivatives.find((entry) => entry.derivativeKind === 'screen_preview') ??
    derivatives.find((entry) => entry.derivativeKind === 'thumbnail');
  const accessMediaId = preferred?.mediaId ?? mediaId;
  const query = useMediaAccess(gardenId, accessMediaId, processingState === 'processed');

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
    <>
      <button
        type="button"
        className={styles['previewButton']}
        onClick={() => setOpen(true)}
        aria-label={t('media.previewOpenFullscreen')}
      >
        <img
          className={styles['preview']}
          src={query.data.url}
          alt={t('media.previewAlt', { filename: displayFilename })}
        />
      </button>
      <PhotoLightbox
        photos={[
          {
            id: accessMediaId,
            src: query.data.url,
            alt: t('media.previewAlt', { filename: displayFilename }),
            caption: displayFilename,
          },
        ]}
        activeIndex={open ? 0 : null}
        dialogLabel={displayFilename}
        closeLabel={t('media.previewCloseFullscreen')}
        previousLabel={t('media.previewPrevious')}
        nextLabel={t('media.previewNext')}
        onSelect={() => undefined}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
