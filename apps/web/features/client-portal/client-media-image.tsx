'use client';

import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert, PhotoLightbox } from '@/shared/ui/public';

import styles from './client-media-image.module.css';
import { useClientMediaAccess } from './queries';

export interface ClientMediaImageProps {
  readonly publicationId: string;
  readonly mediaId: string;
  readonly alt: string;
}

/**
 * One published before/after or general-work photo (`getClientMediaAccess`).
 *
 * The same convention `features/media/media-preview.tsx` established for
 * the operational side: a plain `<img>`, not `next/image`, because the
 * source is a fresh short-lived signed URL re-issued on every fetch, never
 * a build-time-optimizable static asset. `useClientMediaAccess` is the one
 * difference from that precedent — see its own doc comment for why this
 * component's data is never cached beyond its own mounted lifetime.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getClientMediaAccess`.
 */
export function ClientMediaImage({ publicationId, mediaId, alt }: ClientMediaImageProps) {
  const { t } = useLocalization();
  const query = useClientMediaAccess(publicationId, mediaId);
  const [open, setOpen] = useState(false);

  if (query.isPending) {
    return <p role="status">{t('clientPortal.mediaLoading')}</p>;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  return (
    <>
      <button type="button" className={styles['imageButton']} onClick={() => setOpen(true)}>
        <img className={styles['image']} src={query.data.url} alt={alt} />
      </button>
      <PhotoLightbox
        photos={[{ id: mediaId, src: query.data.url, alt, caption: alt }]}
        activeIndex={open ? 0 : null}
        dialogLabel={alt}
        closeLabel={t('media.previewCloseFullscreen')}
        previousLabel={t('media.previewPrevious')}
        nextLabel={t('media.previewNext')}
        onSelect={() => undefined}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
